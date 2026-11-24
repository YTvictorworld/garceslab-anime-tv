/**
 * Reads the subtitle lines of a Matroska file over HTTP Range requests while
 * the TV's <video> plays it, for the direct-play spike.
 *
 * Two ways, picked per file:
 * - "cues": the muxer indexed every subtitle block (mkvmerge and ffmpeg do,
 *   with CueRelativePosition), so each line is one small read at a known
 *   offset. Lines near the playhead come first, then the rest of the file in
 *   the background, so a seek far ahead finds them already there.
 * - "scan": no index for the subtitle blocks. Whole clusters are read a
 *   little ahead of the playhead and only their subtitle blocks parsed. This
 *   downloads the file a second time (paced to playback), so it is a
 *   fallback; a seek jumps to the cluster the Cues (or a byte estimate) give.
 * Kept free of React Native (and of `@/` imports) so the tests load it.
 */
import type { MpvStreamedSubtitleLine } from "expo-mpv-player"
import { type ByteWindow, children, dataOf, type ElementHeader, hasData, ID, readElementHeader, readUint } from "./ebml.ts"
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
    requests: number
    bytes: number
    /** Lines found per track number. */
    lines: Record<number, number>
    /** Milliseconds from start() to the first line, when one came. */
    firstLineMs: number | null
    /** cues: subtitle blocks indexed and read so far. scan: clusters read. */
    total: number
    done: number
    /** Up to where (seconds) lines are known past the playhead. */
    readAhead: number
    errors: string[]
    /** Reading stopped for good (a fatal error, or stop()). */
    stopped: boolean
    finished: boolean
}

export type ExtractorOptions = {
    reader: RangeReader
    index: MkvIndex
    onLines: (lines: MpvStreamedSubtitleLine[]) => void
    /** A fatal read error: reading has stopped. */
    onFatal?: (error: unknown) => void
    onStats?: (stats: ExtractorStats) => void
    strategy?: "auto" | ExtractorStrategy
    /** scan: how far past the playhead to read. */
    lookaheadSec?: number
    /** cues: parallel reads. */
    concurrency?: number
    now?: () => number
    /** Whether a read error is worth no retry (CORS, no Range support). */
    isFatal?: (error: unknown) => boolean
}

export type SubtitleExtractor = {
    /** Starts (or moves) reading around `timeSec`. */
    seek: (timeSec: number) => void
    /** The playhead moved during playback. */
    update: (timeSec: number) => void
    stop: () => void
    stats: () => ExtractorStats
    /** Resolves when nothing is being read (tests). */
    idle: () => Promise<void>
}

type CueGroup = { clusterPosition: number; time: number; cues: MkvCue[] }

const SPAN_GAP = 32 * 1024
const BLOCK_GUESS = 4096
const MAX_CLUSTER_BYTES = 64 * 1024 * 1024
const RETRIES = 2
const MAX_FAILED_GROUPS = 8
/** How far back from the playhead a line is still worth reading first. */
const BEHIND_SEC = 10

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
    if (!index.hasCues) return { strategy: "scan", reason: "the file has no Cues; reading clusters ahead of playback" }
    return { strategy: "scan", reason: "the Cues don't index the subtitle blocks; reading clusters ahead of playback" }
}

export function createSubtitleExtractor(options: ExtractorOptions): SubtitleExtractor {
    const { index, onLines } = options
    const now = options.now ?? (() => Date.now())
    const isFatal = options.isFatal ?? (() => false)
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
        lines: {},
        firstLineMs: null,
        total: 0,
        done: 0,
        readAhead: 0,
        errors: [],
        stopped: false,
        finished: strategy === "none",
    }
    const startedAt = now()
    const seenLines = new Set<string>()
    let playhead = 0
    let stopped = false
    let active = 0
    let idleWaiters: Array<() => void> = []
    let failedGroups = 0

    const report = () => options.onStats?.({ ...stats, lines: { ...stats.lines }, errors: stats.errors.slice() })

    const read = async (start: number, length: number) => {
        stats.requests++
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
        if (stats.firstLineMs === null) stats.firstLineMs = now() - startedAt
        onLines(fresh)
    }

    const fail = (error: unknown) => {
        if (stopped) return
        stats.errors.push(errorText(error))
        stopped = true
        stats.stopped = true
        report()
        options.onFatal?.(error)
    }

    const noteError = (error: unknown) => {
        stats.errors.push(errorText(error))
        if (stats.errors.length > 20) stats.errors.splice(0, stats.errors.length - 20)
    }

    const settle = () => {
        if (active > 0) return
        const waiters = idleWaiters
        idleWaiters = []
        for (const resolve of waiters) resolve()
    }

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

    const groups: CueGroup[] = []
    if (strategy === "cues") {
        const byCluster = new Map<number, CueGroup>()
        for (const cue of index.cues) {
            if (!byNumber.has(cue.track) || cue.relativePosition === undefined) continue
            let group = byCluster.get(cue.clusterPosition)
            if (!group) {
                group = { clusterPosition: cue.clusterPosition, time: cue.time, cues: [] }
                byCluster.set(cue.clusterPosition, group)
            }
            group.time = Math.min(group.time, cue.time)
            group.cues.push(cue)
        }
        for (const group of byCluster.values()) {
            group.cues.sort((a, b) => a.relativePosition! - b.relativePosition!)
            groups.push(group)
        }
        groups.sort((a, b) => a.time - b.time)
        stats.total = groups.reduce((sum, group) => sum + group.cues.length, 0)
    }
    const pending = groups.slice()

    const nextGroup = (): CueGroup | null => {
        if (pending.length === 0) return null
        const from = (playhead - BEHIND_SEC) / scale
        let pick = pending.findIndex(group => group.time >= from)
        // Everything ahead is read: go back from the playhead.
        if (pick < 0) pick = pending.length - 1
        return pending.splice(pick, 1)[0]
    }

    const readGroup = async (group: CueGroup) => {
        const first = group.cues[0].relativePosition!
        // The cluster's header (and, when close, the first blocks) in one read.
        let window: ByteWindow = { offset: group.clusterPosition, bytes: await read(group.clusterPosition, first < SPAN_GAP ? first + 16 + BLOCK_GUESS : 16) }
        const cluster = readElementHeader(window, group.clusterPosition)
        if (!cluster || cluster.id !== ID.Cluster) throw new Error(`No cluster at ${group.clusterPosition}`)
        const lines: MpvStreamedSubtitleLine[] = []
        for (let i = 0; i < group.cues.length; i++) {
            const cue = group.cues[i]
            const at = cluster.dataStart + cue.relativePosition!
            let header = at >= window.offset ? readElementHeader(window, at) : null
            if (!header || !hasData(window, header)) {
                // Read this block and the following close ones together.
                let span = BLOCK_GUESS
                for (let j = i + 1; j < group.cues.length; j++) {
                    const next = cluster.dataStart + group.cues[j].relativePosition!
                    if (next - (at + span) > SPAN_GAP) break
                    span = next - at + BLOCK_GUESS
                }
                window = { offset: at, bytes: await read(at, span) }
                header = readElementHeader(window, at)
                if (header && header.size !== null && !hasData(window, header)) {
                    window = { offset: at, bytes: await read(at, header.dataStart - at + header.size) }
                }
            }
            if (!header || (header.id !== ID.BlockGroup && header.id !== ID.SimpleBlock) || !hasData(window, header)) {
                noteError(`No subtitle block at ${at}`)
                continue
            }
            lines.push(...linesOfBlock(window, header, null, cue))
            stats.done++
        }
        emit(lines)
    }

    const cueWorker = async () => {
        while (!stopped) {
            const group = nextGroup()
            if (!group) break
            let attempt = 0
            for (;;) {
                try {
                    await readGroup(group)
                    break
                } catch (error) {
                    if (stopped) return
                    if (isFatal(error)) {
                        fail(error)
                        return
                    }
                    if (attempt++ >= RETRIES) {
                        noteError(error)
                        if (++failedGroups >= MAX_FAILED_GROUPS) {
                            fail(error)
                            return
                        }
                        break
                    }
                }
            }
            updateReadAhead()
            report()
        }
    }

    const updateReadAhead = () => {
        if (strategy !== "cues") return
        const next = pending.reduce((min, group) => group.time * scale >= playhead ? Math.min(min, group.time * scale) : min, Infinity)
        stats.readAhead = Number.isFinite(next) ? Math.max(0, next - playhead) : Infinity
    }

    const runCues = () => {
        const concurrency = options.concurrency ?? 3
        while (active < concurrency && pending.length > 0 && !stopped) {
            active++
            void cueWorker().finally(() => {
                active--
                if (pending.length === 0 && active === 0) {
                    stats.finished = true
                    report()
                }
                settle()
            })
        }
        settle()
    }

    ///////////////////////////////////////////////////////////////////////////
    // scan
    ///////////////////////////////////////////////////////////////////////////

    const clusterCues = [...new Map(index.cues.map(cue => [cue.clusterPosition, cue.time])).entries()]
        .map(([position, time]) => ({ position, time }))
        .sort((a, b) => a.time - b.time)
    /** Cluster start → its end, for every cluster read. */
    const scanned = new Map<number, number>()
    let scanPos: number | null = null
    let scanTime = 0
    let scanning = false
    let scanGeneration = 0
    let scanStartTime = 0
    const fileEnd = () => index.segmentEnd ?? options.reader.size() ?? Infinity

    /** A cluster near byte `offset`, for a file with no Cues: looks for the Cluster ID. */
    const findClusterNear = async (offset: number): Promise<number | null> => {
        const start = Math.max(index.segmentDataStart, Math.floor(offset))
        const bytes = await read(start, 1024 * 1024)
        for (let i = 0; i + 4 <= bytes.length; i++) {
            if (bytes[i] !== 0x1f || bytes[i + 1] !== 0x43 || bytes[i + 2] !== 0xb6 || bytes[i + 3] !== 0x75) continue
            const window = { offset: start, bytes }
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
        // Overshoot a little less than the estimate: the scan then reads up to the playhead.
        const estimate = index.segmentDataStart + (end - index.segmentDataStart) * Math.max(0, timeSec - 15) / index.durationSec
        return await findClusterNear(estimate) ?? index.firstClusterPosition
    }

    const scanCluster = async (position: number): Promise<{ next: number; time: number } | null> => {
        const headerWindow = { offset: position, bytes: await read(position, 64) }
        const header = readElementHeader(headerWindow, position)
        if (!header || header.size === null) throw new Error(`Unreadable element at ${position}`)
        const next = header.dataStart + header.size
        if (header.id !== ID.Cluster) return { next, time: scanTime / scale }
        if (header.size > MAX_CLUSTER_BYTES) throw new Error(`Cluster at ${position} is too big (${header.size} bytes)`)
        const window = { offset: position, bytes: await read(position, next - position) }
        let clusterTime = 0
        const lines: MpvStreamedSubtitleLine[] = []
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
        scanned.set(position, next)
        stats.done++
        emit(lines)
        return { next, time: clusterTime }
    }

    const runScan = async (generation: number) => {
        if (scanning) return
        scanning = true
        active++
        try {
            while (!stopped && generation === scanGeneration && scanPos !== null) {
                if (scanTime * scale > playhead + (options.lookaheadSec ?? 60)) break
                if (scanPos >= fileEnd()) {
                    stats.finished = true
                    break
                }
                const known = scanned.get(scanPos)
                if (known !== undefined) {
                    scanPos = known
                    continue
                }
                let attempt = 0
                let result: { next: number; time: number } | null = null
                for (;;) {
                    try {
                        result = await scanCluster(scanPos)
                        break
                    } catch (error) {
                        if (isFatal(error) || attempt++ >= RETRIES) {
                            fail(error)
                            return
                        }
                    }
                }
                if (generation !== scanGeneration || !result) break
                scanPos = result.next
                scanTime = result.time
                stats.readAhead = Math.max(0, scanTime * scale - playhead)
                report()
            }
        } finally {
            scanning = false
            active--
            settle()
            // A seek while reading: start again from the new place.
            if (!stopped && generation !== scanGeneration) void runScan(scanGeneration)
        }
    }

    const scanSeek = async (timeSec: number) => {
        const generation = ++scanGeneration
        // Still inside what is being read: carry on.
        if (scanPos !== null && timeSec >= scanStartTime && timeSec <= scanTime * scale + 5) {
            void runScan(generation)
            return
        }
        active++
        try {
            const position = await positionFor(timeSec)
            if (generation !== scanGeneration) return
            scanPos = position
            scanTime = clusterCues.find(cue => cue.position === position)?.time ?? timeSec / scale
            scanStartTime = scanTime * scale
            // Before this read counts as done, so idle() waits for the scan too.
            void runScan(generation)
        } catch (error) {
            if (isFatal(error)) fail(error)
            else noteError(error)
        } finally {
            active--
            settle()
        }
    }

    ///////////////////////////////////////////////////////////////////////////

    report()

    return {
        seek: (timeSec) => {
            if (stopped || strategy === "none") return
            playhead = Math.max(0, timeSec)
            if (strategy === "cues") {
                updateReadAhead()
                runCues()
            } else {
                void scanSeek(playhead)
            }
        },
        update: (timeSec) => {
            if (stopped || strategy === "none") return
            playhead = Math.max(0, timeSec)
            if (strategy === "scan" && !scanning && scanPos !== null) void runScan(scanGeneration)
            if (strategy === "cues") updateReadAhead()
        },
        stop: () => {
            stopped = true
            stats.stopped = true
        },
        stats: () => ({ ...stats, lines: { ...stats.lines }, errors: stats.errors.slice() }),
        idle: () => active === 0 ? Promise.resolve() : new Promise(resolve => idleWaiters.push(resolve)),
    }
}
