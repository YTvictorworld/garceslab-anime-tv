/**
 * Reads the subtitle lines of a Matroska file over HTTP Range requests while
 * the TV's <video> plays it, for direct play.
 *
 * The debrid CDN throttles a client that sends many requests while its
 * <video> streams from the same host (HTTP 429), so reads are few and large:
 * the subtitle blocks' byte ranges are merged into one read when they are
 * close (gap under `mergeGapBytes`, read at most `maxReadBytes`), the lines
 * around the playhead come first, the rest of the file follows slowly in the
 * background, and that background stops while the video buffers or seeks.
 * The reader underneath (createPacedReader) sends one request at a time and
 * backs off on 429.
 *
 * Two ways, picked per file:
 * - "cues": the muxer indexed every subtitle block (mkvmerge and ffmpeg do,
 *   with CueRelativePosition), so the reads hold subtitle blocks and what lies
 *   between close ones, never whole stretches of video for nothing.
 * - "scan": no index for the subtitle blocks. The file is read in large
 *   chunks a little ahead of the playhead and only its subtitle blocks parsed.
 *   This downloads the file a second time (paced to playback): a fallback.
 * Kept free of React Native (and of `@/` imports) so the tests load it.
 */
import type { MpvStreamedSubtitleLine } from "expo-mpv-player"
import { type ByteWindow, children, dataOf, type ElementHeader, hasData, ID, readElementHeader, readUint, readVint } from "./ebml.ts"
import {
    decodeFrame,
    isTextSubtitle,
    type MkvCue,
    type MkvIndex,
    type MkvTrack,
    parseBlock,
    type RangeReader,
    subtitleLine,
} from "./mkv-demux.ts"

export type ExtractorStrategy = "cues" | "scan"

export type ExtractorStats = {
    strategy: ExtractorStrategy | "none"
    /** Why that strategy (or none). */
    reason: string
    /** Reads this extractor asked for (each one request, or a few for the relay's 1 MiB limit). */
    requests: number
    bytes: number
    /** Size of the last read, in bytes. */
    lastReadBytes: number
    /** Lines found per track number. */
    lines: Record<number, number>
    /** Milliseconds from the first seek to the first line, when one came. */
    firstLineMs: number | null
    /** cues: subtitle blocks indexed and read so far. scan: clusters read. */
    total: number
    done: number
    /** Up to where (seconds) lines are known past the playhead; Infinity when all are. */
    readAhead: number
    /** The video buffers or seeks: only lines at the playhead are read. */
    backgroundPaused: boolean
    /** Reads that failed in a row (rate limits included, after the reader's own retries). */
    consecutiveFailures: number
    errors: string[]
    /** Reading stopped for good (a fatal error, or stop()). */
    stopped: boolean
    finished: boolean
}

export type ExtractorOptions = {
    reader: RangeReader
    index: MkvIndex
    onLines: (lines: MpvStreamedSubtitleLine[]) => void
    /** Reading failed in a way the user must hear about: it has stopped. */
    onFatal?: (error: unknown) => void
    onStats?: (stats: ExtractorStats) => void
    strategy?: "auto" | ExtractorStrategy
    /** Merge two subtitle blocks into one read when less than this lies between them. */
    mergeGapBytes?: number
    /** The largest read. */
    maxReadBytes?: number
    /** Lines from the playhead up to this far ahead are read first. */
    foregroundSec?: number
    /** Pause between background reads (the playhead's lines are read). */
    backgroundGapMs?: number
    /** scan: how far past the playhead to read, and the chunk size. */
    lookaheadSec?: number
    scanChunkBytes?: number
    /** Failed reads in a row, with no lines at the playhead, before giving up. */
    failureThreshold?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    /** Whether a read error is worth no retry (CORS, no Range support, expired link). */
    isFatal?: (error: unknown) => boolean
}

export type SubtitleExtractor = {
    /** Starts (or moves) reading around `timeSec`. */
    seek: (timeSec: number) => void
    /** The playhead moved during playback. */
    update: (timeSec: number) => void
    /** Pauses the background while the video buffers or seeks. */
    setBackgroundPaused: (paused: boolean) => void
    stop: () => void
    stats: () => ExtractorStats
    /** Resolves when nothing is being read (tests). */
    idle: () => Promise<void>
}

type CueBlock = {
    cue: MkvCue
    /** Earliest and latest byte the block can occupy (the cluster's header length is unknown until read). */
    minStart: number
    maxEnd: number
}

/** A block element is at least this long; more is read after its header when it isn't. */
const BLOCK_GUESS = 2048
/** Cluster ID (4 bytes) plus a size of 1 to 8 bytes. */
const CLUSTER_HEADER_MIN = 5
const CLUSTER_HEADER_MAX = 12
const MAX_BLOCK_BYTES = 1024 * 1024
const MAX_CLUSTER_BYTES = 64 * 1024 * 1024
/** How far back from the playhead a line is still read first. */
const BEHIND_SEC = 10
/** Lines this close to the playhead count as "lines for the current position". */
const COVER_SEC = 10

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

/** Chooses how to read the file's subtitles. */
export function chooseStrategy(index: MkvIndex, tracks: MkvTrack[]): { strategy: ExtractorStrategy | "none"; reason: string } {
    if (tracks.length === 0) return { strategy: "none", reason: "no text subtitle tracks" }
    const indexed = new Set(index.cues.filter(cue => cue.relativePosition !== undefined).map(cue => cue.track))
    if (tracks.every(track => indexed.has(track.number))) {
        return { strategy: "cues", reason: "every subtitle block is in the Cues" }
    }
    if (!index.hasCues) return { strategy: "scan", reason: "the file has no Cues; reading the file ahead of playback" }
    return { strategy: "scan", reason: "the Cues don't index the subtitle blocks; reading the file ahead of playback" }
}

/**
 * Groups byte ranges (sorted by start) into reads: a range joins the read
 * before it when the gap is under `mergeGap` and the read stays within `maxRead`.
 */
export function coalesceRanges<T extends { minStart: number; maxEnd: number }>(ranges: readonly T[], mergeGap: number, maxRead: number): Array<{ start: number; end: number; items: T[] }> {
    const reads: Array<{ start: number; end: number; items: T[] }> = []
    for (const range of ranges) {
        const last = reads[reads.length - 1]
        if (last && range.minStart - last.end < mergeGap && Math.max(last.end, range.maxEnd) - last.start <= maxRead) {
            last.end = Math.max(last.end, range.maxEnd)
            last.items.push(range)
        } else {
            reads.push({ start: range.minStart, end: range.maxEnd, items: [range] })
        }
    }
    return reads
}

export function createSubtitleExtractor(options: ExtractorOptions): SubtitleExtractor {
    const { index, onLines } = options
    const now = options.now ?? (() => Date.now())
    const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
    const isFatal = options.isFatal ?? (() => false)
    const mergeGap = options.mergeGapBytes ?? 2 * 1024 * 1024
    const maxRead = options.maxReadBytes ?? 6 * 1024 * 1024
    const foregroundSec = options.foregroundSec ?? 90
    const backgroundGapMs = options.backgroundGapMs ?? 2000
    const failureThreshold = options.failureThreshold ?? 3
    const scale = index.timestampScale / 1e9
    const tracks = index.tracks.filter(track => track.kind === "subtitle" && isTextSubtitle(track))
    const byNumber = new Map(tracks.map(track => [track.number, track]))
    const chosen = chooseStrategy(index, tracks)
    const strategy = options.strategy && options.strategy !== "auto" && tracks.length > 0 ? options.strategy : chosen.strategy

    const stats: ExtractorStats = {
        strategy,
        reason: strategy === chosen.strategy ? chosen.reason : `forced ${strategy}`,
        requests: 0,
        bytes: 0,
        lastReadBytes: 0,
        lines: {},
        firstLineMs: null,
        total: 0,
        done: 0,
        readAhead: 0,
        backgroundPaused: false,
        consecutiveFailures: 0,
        errors: [],
        stopped: false,
        finished: strategy === "none",
    }
    let startedAt: number | null = null
    const seenLines = new Set<string>()
    let playhead = 0
    let stopped = false
    let running = false
    let idleWaiters: Array<() => void> = []
    /** Bumped on every seek and resume, so a waiting background pause ends early. */
    let wake: (() => void) | null = null

    const report = () => options.onStats?.({ ...stats, lines: { ...stats.lines }, errors: stats.errors.slice() })

    const read = async (start: number, length: number) => {
        stats.requests++
        stats.lastReadBytes = length
        const bytes = await options.reader.read(start, length)
        stats.bytes += bytes.length
        return bytes
    }

    const emit = (lines: MpvStreamedSubtitleLine[]) => {
        const fresh = lines.filter((line) => {
            const key = `${line.trackNumber}:${line.start}:${line.text}`
            if (seenLines.has(key)) return false
            seenLines.add(key)
            stats.lines[line.trackNumber] = (stats.lines[line.trackNumber] ?? 0) + 1
            return true
        })
        if (fresh.length === 0 || stopped) return
        if (stats.firstLineMs === null) stats.firstLineMs = now() - (startedAt ?? now())
        onLines(fresh)
    }

    const noteError = (error: unknown) => {
        stats.errors.push(errorText(error))
        if (stats.errors.length > 20) stats.errors.splice(0, stats.errors.length - 20)
    }

    const fail = (error: unknown) => {
        if (stopped) return
        noteError(error)
        stopped = true
        stats.stopped = true
        report()
        options.onFatal?.(error)
    }

    /**
     * A read failed. Fatal ones stop at once. Others (rate limits that
     * outlasted the reader's backoff, network trouble) only stop reading when
     * they keep happening and the playhead has no lines to show.
     */
    const readFailed = (error: unknown, covered: boolean): boolean => {
        if (isFatal(error)) {
            fail(error)
            return true
        }
        stats.consecutiveFailures++
        noteError(error)
        if (stats.consecutiveFailures >= failureThreshold && !covered) {
            fail(error)
            return true
        }
        report()
        return false
    }

    const settle = () => {
        if (running) return
        const waiters = idleWaiters
        idleWaiters = []
        for (const resolve of waiters) resolve()
    }

    /** Waits `ms`, or less when a seek or resume comes first. */
    const pause = (ms: number) => new Promise<void>((resolve) => {
        let done = false
        const finish = () => {
            if (done) return
            done = true
            wake = null
            resolve()
        }
        wake = finish
        void sleep(ms).then(finish)
    })

    /** Lines of a BlockGroup or SimpleBlock element whose data is in `window`. */
    const linesOfBlock = (window: ByteWindow, element: ElementHeader, clusterTime: number | null, cue?: MkvCue): MpvStreamedSubtitleLine[] => {
        let blockData: Uint8Array | null = null
        let durationTicks = cue?.duration ?? 0
        if (element.id === ID.SimpleBlock) {
            blockData = dataOf(window, element)
        } else if (element.id === ID.BlockGroup) {
            for (const child of children(window, element)) {
                if (child.id === ID.Block) blockData = dataOf(window, child)
                if (child.id === ID.BlockDuration) durationTicks = readUint(dataOf(window, child))
            }
        }
        if (!blockData) return []
        const block = parseBlock(blockData)
        const track = byNumber.get(block.track)
        if (!track) return []
        const time = cue && clusterTime === null ? cue.time : (clusterTime ?? 0) + block.relativeTime
        const out: MpvStreamedSubtitleLine[] = []
        for (const frame of block.frames) {
            try {
                const line = subtitleLine(track, decodeFrame(track, frame), time * scale, durationTicks * scale)
                if (line) out.push(line)
            } catch (error) {
                noteError(error)
            }
        }
        return out
    }

    ///////////////////////////////////////////////////////////////////////////
    // cues
    ///////////////////////////////////////////////////////////////////////////

    /** Pending subtitle blocks, by file position. */
    let pending: CueBlock[] = []
    /** Cluster start → length of its header (ID and size), once seen. */
    const clusterHeaderLength = new Map<number, number>()

    if (strategy === "cues") {
        for (const cue of index.cues) {
            if (!byNumber.has(cue.track) || cue.relativePosition === undefined) continue
            pending.push({
                cue,
                minStart: cue.clusterPosition + CLUSTER_HEADER_MIN + cue.relativePosition,
                maxEnd: cue.clusterPosition + CLUSTER_HEADER_MAX + cue.relativePosition + BLOCK_GUESS,
            })
        }
        pending.sort((a, b) => a.minStart - b.minStart)
        stats.total = pending.length
    }

    const timeOf = (block: CueBlock) => block.cue.time * scale

    /** Times (s) of the blocks read. */
    const readTimes: number[] = []
    /** Whether the player has lines around the playhead (or there are none to read there). */
    const coveredByCues = () => readTimes.some(time => Math.abs(time - playhead) <= COVER_SEC)
        || !pending.some(block => Math.abs(timeOf(block) - playhead) <= COVER_SEC)

    /**
     * Where a cue's block is: its cluster's header length is known once the
     * cluster's start was read; otherwise every length is tried and the one
     * that gives a block of the cue's track wins.
     */
    const locateBlock = (window: ByteWindow, cue: MkvCue): ElementHeader | null => {
        const windowEnd = window.offset + window.bytes.length
        let lengths: number[]
        const known = clusterHeaderLength.get(cue.clusterPosition)
        if (known !== undefined) {
            lengths = [known]
        } else if (cue.clusterPosition >= window.offset && cue.clusterPosition + CLUSTER_HEADER_MAX <= windowEnd) {
            const cluster = readElementHeader(window, cue.clusterPosition)
            if (!cluster || cluster.id !== ID.Cluster) return null
            lengths = [cluster.dataStart - cluster.start]
        } else {
            lengths = [12, 9, 8, 5, 6, 7, 10, 11]
        }
        for (const length of lengths) {
            const at = cue.clusterPosition + length + cue.relativePosition!
            if (at < window.offset || at >= windowEnd) continue
            let header: ElementHeader | null
            try {
                header = readElementHeader(window, at)
            } catch {
                continue
            }
            if (!header || header.size === null || header.size > MAX_BLOCK_BYTES) continue
            if (header.id !== ID.SimpleBlock && header.id !== ID.BlockGroup) continue
            // The block's track number must be the cue's.
            let trackAt = header.dataStart
            if (header.id === ID.BlockGroup) {
                const first = readElementHeader(window, header.dataStart)
                if (!first || (first.id !== ID.Block && first.id !== ID.BlockDuration && first.id !== 0xfb && first.id !== 0x75a1)) continue
                const block = children(window, header).find(child => child.id === ID.Block)
                if (!block) {
                    if (lengths.length === 1) return header
                    continue
                }
                trackAt = block.dataStart
            }
            if (trackAt >= windowEnd) {
                if (lengths.length === 1) return header
                continue
            }
            try {
                if (readVint(window.bytes, trackAt - window.offset).value !== cue.track) continue
            } catch {
                continue
            }
            clusterHeaderLength.set(cue.clusterPosition, length)
            return header
        }
        return null
    }

    /** The next read: the earliest unread line from the playhead on, merged with the blocks close to it. */
    const planCueRead = (): { start: number; end: number; items: CueBlock[]; background: boolean } | null => {
        if (pending.length === 0) return null
        const from = playhead - BEHIND_SEC
        let seed: CueBlock | null = null
        for (const block of pending) {
            const time = timeOf(block)
            if (time >= from && (!seed || time < timeOf(seed))) seed = block
        }
        const foreground = !!seed && timeOf(seed) <= playhead + foregroundSec
        if (!foreground && stats.backgroundPaused) return null
        // Everything ahead is read: go back from the playhead.
        if (!seed) seed = pending.reduce((latest, block) => timeOf(block) > timeOf(latest) ? block : latest)
        const startIndex = pending.indexOf(seed)
        const reads = coalesceRanges(pending.slice(startIndex), mergeGap, maxRead)
        return { ...reads[0], background: !foreground }
    }

    const readCueSpan = async (span: { start: number; end: number; items: CueBlock[] }) => {
        const window: ByteWindow = { offset: span.start, bytes: await read(span.start, span.end - span.start) }
        const lines: MpvStreamedSubtitleLine[] = []
        const done = new Set<CueBlock>()
        for (const item of span.items) {
            const header = locateBlock(window, item.cue)
            if (!header) {
                noteError(`No subtitle block for the cue at ${item.cue.clusterPosition}+${item.cue.relativePosition}`)
                done.add(item)
                continue
            }
            if (hasData(window, header)) {
                lines.push(...linesOfBlock(window, header, null, item.cue))
                done.add(item)
            } else {
                // A big line (typesetting): read exactly this block next time.
                item.minStart = header.start
                item.maxEnd = header.dataStart + header.size!
            }
        }
        // A block that would never fit is dropped rather than read forever.
        for (const item of span.items) {
            if (!done.has(item) && item.maxEnd - item.minStart > MAX_BLOCK_BYTES + CLUSTER_HEADER_MAX) done.add(item)
        }
        for (const item of done) readTimes.push(timeOf(item))
        pending = pending.filter(item => !done.has(item))
        pending.sort((a, b) => a.minStart - b.minStart)
        stats.done = stats.total - pending.length
        emit(lines)
    }

    const updateReadAhead = () => {
        if (strategy !== "cues") return
        let next = Infinity
        for (const block of pending) {
            const time = timeOf(block)
            if (time >= playhead && time < next) next = time
        }
        stats.readAhead = Number.isFinite(next) ? Math.max(0, next - playhead) : Infinity
    }

    const runCues = async () => {
        while (!stopped) {
            const span = planCueRead()
            if (!span) break
            if (span.background) await pause(backgroundGapMs)
            if (stopped) break
            // A seek during the pause wants another read first.
            const current = planCueRead()
            if (!current) break
            try {
                await readCueSpan(current)
                stats.consecutiveFailures = 0
            } catch (error) {
                if (stopped || readFailed(error, coveredByCues())) break
            }
            updateReadAhead()
            report()
        }
        if (pending.length === 0) stats.finished = true
        updateReadAhead()
        report()
    }

    ///////////////////////////////////////////////////////////////////////////
    // scan
    ///////////////////////////////////////////////////////////////////////////

    const clusterCues = [...new Map(index.cues.map(cue => [cue.clusterPosition, cue.time])).entries()]
        .map(([position, time]) => ({ position, time }))
        .sort((a, b) => a.time - b.time)
    const scanChunk = options.scanChunkBytes ?? 4 * 1024 * 1024
    /** Cluster start → its end, for every cluster read. */
    const scanned = new Map<number, number>()
    let scanPos: number | null = null
    /** Time (s) of the last cluster read, and where this run of reading began. */
    let scanTime = 0
    let scanStartTime = 0
    let scanTarget: number | null = 0
    const fileEnd = () => index.segmentEnd ?? options.reader.size() ?? Infinity
    const coveredByScan = () => scanPos !== null && playhead >= scanStartTime && scanTime > playhead + COVER_SEC

    /** A cluster near byte `offset`, for a file with no Cues: looks for the Cluster ID. */
    const findClusterNear = async (offset: number): Promise<number | null> => {
        const start = Math.max(index.segmentDataStart, Math.floor(offset))
        const bytes = await read(start, 1024 * 1024)
        const window = { offset: start, bytes }
        for (let i = 0; i + 4 <= bytes.length; i++) {
            if (bytes[i] !== 0x1f || bytes[i + 1] !== 0x43 || bytes[i + 2] !== 0xb6 || bytes[i + 3] !== 0x75) continue
            try {
                const header = readElementHeader(window, start + i)
                if (!header || header.size === null || header.size > MAX_CLUSTER_BYTES) continue
                const first = readElementHeader(window, header.dataStart)
                if (first?.id === ID.Timestamp) return start + i
            } catch {
                // Not a cluster after all.
            }
        }
        return null
    }

    const positionFor = async (timeSec: number): Promise<number | null> => {
        const ticks = timeSec / scale
        if (clusterCues.length > 0) {
            let pick = clusterCues[0]
            for (const cue of clusterCues) {
                if (cue.time > ticks) break
                pick = cue
            }
            return pick.position
        }
        if (timeSec <= 1 || !index.durationSec) return index.firstClusterPosition
        const end = fileEnd()
        if (!Number.isFinite(end)) return index.firstClusterPosition
        // Land a little before the estimate: the scan then reads up to the playhead.
        const estimate = index.segmentDataStart + (end - index.segmentDataStart) * Math.max(0, timeSec - 15) / index.durationSec
        return await findClusterNear(estimate) ?? index.firstClusterPosition
    }

    /** Parses the clusters wholly inside `window` from `at` on; returns where reading should go on. */
    const scanWindow = (window: ByteWindow, at: number): { next: number; parsed: number } => {
        const windowEnd = window.offset + window.bytes.length
        let parsed = 0
        const lines: MpvStreamedSubtitleLine[] = []
        while (at < windowEnd) {
            const header = readElementHeader(window, at)
            if (!header) break
            if (header.size === null) throw new Error(`Element at ${at} has an unknown size`)
            const end = header.dataStart + header.size
            if (header.id === ID.Cluster) {
                if (end > windowEnd) break
                let clusterTime = 0
                for (const child of children(window, header)) {
                    if (child.id === ID.Timestamp) {
                        clusterTime = readUint(dataOf(window, child))
                    } else if (child.id === ID.SimpleBlock || child.id === ID.BlockGroup) {
                        // Only subtitle blocks: a SimpleBlock's track number is its first byte(s).
                        if (child.id === ID.SimpleBlock) {
                            const first = window.bytes[child.dataStart - window.offset]
                            if (first !== undefined && (first & 0x80) && !byNumber.has(first & 0x7f)) continue
                        }
                        lines.push(...linesOfBlock(window, child, clusterTime))
                    }
                }
                scanned.set(header.start, end)
                scanTime = clusterTime * scale
                stats.done++
                parsed++
            }
            at = end
        }
        emit(lines)
        return { next: at, parsed }
    }

    const runScan = async () => {
        while (!stopped) {
            if (scanTarget !== null) {
                const target = scanTarget
                scanTarget = null
                // Still inside what is being read: carry on from there.
                if (!(scanPos !== null && target >= scanStartTime && target <= scanTime + 5)) {
                    try {
                        scanPos = await positionFor(target)
                    } catch (error) {
                        if (readFailed(error, false)) break
                        scanTarget = target
                        continue
                    }
                    const cue = clusterCues.find(item => item.position === scanPos)
                    scanTime = cue ? cue.time * scale : target
                    scanStartTime = scanTime
                }
            }
            if (scanPos === null) break
            const limit = playhead + (stats.backgroundPaused ? COVER_SEC : (options.lookaheadSec ?? 60))
            if (scanTime > limit) break
            const end = fileEnd()
            if (scanPos >= end) {
                stats.finished = true
                break
            }
            const known = scanned.get(scanPos)
            if (known !== undefined) {
                scanPos = known
                continue
            }
            try {
                const length = Math.min(scanChunk, end - scanPos)
                let window: ByteWindow = { offset: scanPos, bytes: await read(scanPos, length) }
                let result = scanWindow(window, scanPos)
                if (result.parsed === 0 && result.next === scanPos) {
                    // One cluster bigger than a chunk: read it whole.
                    const header = readElementHeader(window, scanPos)
                    if (!header || header.size === null) throw new Error(`Unreadable element at ${scanPos}`)
                    const size = header.dataStart - header.start + header.size
                    if (size > MAX_CLUSTER_BYTES) throw new Error(`Cluster at ${scanPos} is too big (${size} bytes)`)
                    window = { offset: scanPos, bytes: await read(scanPos, size) }
                    result = scanWindow(window, scanPos)
                    if (result.next === scanPos) throw new Error(`Could not read the cluster at ${scanPos}`)
                }
                scanPos = result.next
                stats.consecutiveFailures = 0
            } catch (error) {
                if (stopped || readFailed(error, coveredByScan())) break
            }
            stats.readAhead = Math.max(0, scanTime - playhead)
            report()
        }
        report()
    }

    ///////////////////////////////////////////////////////////////////////////

    const kick = () => {
        if (stopped || strategy === "none") return
        wake?.()
        if (running) return
        running = true
        const work = strategy === "cues" ? runCues() : runScan()
        void work.finally(() => {
            running = false
            settle()
            // A seek while finishing up: go again.
            if (!stopped && (strategy === "cues" ? planCueRead() !== null : scanTarget !== null)) kick()
        })
    }

    report()

    return {
        seek: (timeSec) => {
            if (stopped || strategy === "none") return
            startedAt ??= now()
            playhead = Math.max(0, timeSec)
            if (strategy === "scan") scanTarget = playhead
            updateReadAhead()
            kick()
        },
        update: (timeSec) => {
            if (stopped || strategy === "none") return
            playhead = Math.max(0, timeSec)
            updateReadAhead()
            kick()
        },
        setBackgroundPaused: (paused) => {
            if (stats.backgroundPaused === paused) return
            stats.backgroundPaused = paused
            report()
            if (!paused) kick()
        },
        stop: () => {
            stopped = true
            stats.stopped = true
            wake?.()
        },
        stats: () => ({ ...stats, lines: { ...stats.lines }, errors: stats.errors.slice() }),
        idle: () => !running ? Promise.resolve() : new Promise(resolve => idleWaiters.push(resolve)),
    }
}
