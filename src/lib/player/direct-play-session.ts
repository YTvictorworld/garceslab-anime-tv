/**
 * Direct play (phase 1.5 spike, default since phase 2): the TV plays the
 * debrid link itself and reads the subtitles from the MKV with Range
 * requests (mkv/), instead of the server's direct stream reading them while
 * it relays the video.
 *
 * Per episode this reads the file's header (tracks, Cues, fonts), hands the
 * player streamed subtitle tracks that fill in as lines are read (the same
 * shape the server's direct stream gives, so JASSUB/libass draws ASS and
 * SRT shows as text), and records what worked and what didn't for the
 * diagnostics panel ("Playback stats") and the log. A failure is recorded
 * with its kind; the player then falls back to the server quietly, or opens
 * the diagnostics dialog in the test build (direct-play-policy.ts).
 */
import type { MpvFontData, MpvMediaEvent, MpvStreamedSubtitleLine, MpvStreamedSubtitles } from "expo-mpv-player"
import { logger } from "@/lib/utils/logger"
import { toast } from "@/lib/utils/toast"
import { canUseRelayRanges, createRelayRangeReader } from "@/lib/webos/luna-range"
import React from "react"
import { describeStreamCodecs, directStreamChapters } from "./direct-stream"
import { describeRanges, directPlayDiagnostics, summarizeDiagnostics } from "./direct-play-diagnostics"
import { DIRECT_PLAY_LOUD } from "./direct-play-mode"
import { type DirectPlayFailureKind, mediaErrorCause, readFailureCause } from "./direct-play-policy"
import { isFontAttachment, isTextSubtitle, type MkvIndex, MkvError, readAttachedFiles, readMkvIndex, type RangeReader, toMkvMetadata } from "./mkv/mkv-demux"
import { chunkedReader, createFetchRangeReader, createPacedReader, isFatalRangeError, RangeFetchError, type ReaderEvent } from "./mkv/range-reader"
import { createSubtitleExtractor, type SubtitleExtractor } from "./mkv/subtitle-extractor"
import type { MobilePlaybackSource, WebPlaybackPlan } from "./types"

const log = logger("direct-play")

/** Past this the video starts without the file's subtitles (and says so); reads are paced and may back off. */
const HEADER_TIMEOUT_MS = 25_000
/** Attachments bigger than this are not read (all fonts come in one go). */
const MAX_ATTACHMENTS_BYTES = 40 * 1024 * 1024
/** Fonts wait this long, so the first subtitle reads go out before them. */
const FONTS_DELAY_MS = 4000
/**
 * Least time between two subtitle/header/font requests to the CDN, which
 * throttles a client whose <video> also streams from it. Build-time
 * override: EXPO_PUBLIC_DIRECT_PLAY_MIN_GAP_MS.
 */
const MIN_GAP_MS = Number(process.env.EXPO_PUBLIC_DIRECT_PLAY_MIN_GAP_MS) || 1000
/** The relay service takes at most this per call. */
const RELAY_CALL_BYTES = 1024 * 1024
const SUMMARY_INTERVAL_MS = 60_000
const POLL_MS = 1000

export type DirectPlayPlan = Pick<WebPlaybackPlan,
    "externalSubtitles" | "streamedSubtitles" | "onMediaEvent" | "subtitleFontData" | "audioTracks" | "chapters" | "mediaInfoSummary">

type Session = { id: string; plan: DirectPlayPlan; dispose: () => void }

function describeError(error: unknown): string {
    if (error instanceof RangeFetchError) {
        switch (error.kind) {
            case "cors": return "CORS on subtitle fetch (the CDN doesn't allow this app to read the file)"
            case "no-range": return "the CDN ignored HTTP Range requests"
            case "http": return `the CDN answered ${error.message}${error.status === 403 || error.status === 410 ? " (link expired?)" : ""}`
            case "timeout": return `the CDN did not answer (${error.message})`
            case "relay": return `the app's relay service failed (${error.message})`
            case "rate-limit": return `the CDN kept rate-limiting the reads (${error.message})`
            default: return `network error (${error.message})`
        }
    }
    if (error instanceof MkvError) return `the file could not be parsed (${error.message})`
    return error instanceof Error ? error.message : String(error)
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms)
        promise.then(value => {
            clearTimeout(timer)
            resolve(value)
        }, error => {
            clearTimeout(timer)
            reject(error)
        })
    })
}

/** A reader whose reads are counted in the diagnostics. */
function countingRead(event: ReaderEvent) {
    directPlayDiagnostics.update(d => ({
        reads: {
            count: d.reads.count + 1,
            failed: d.reads.failed + (event.error ? 1 : 0),
            bytes: d.reads.bytes + event.bytes,
            totalMs: d.reads.totalMs + event.ms,
            maxMs: Math.max(d.reads.maxMs, event.ms),
        },
    }))
}

/** The streamed tracks the web player shows; lines are kept for players that subscribe later. */
function createLineStore(tracks: MpvStreamedSubtitles["tracks"]) {
    const lines: MpvStreamedSubtitleLine[] = []
    const listeners = new Set<(lines: MpvStreamedSubtitleLine[]) => void>()
    return {
        streamed: {
            tracks,
            subscribe: (listener) => {
                if (lines.length > 0) listener(lines.slice())
                listeners.add(listener)
                return () => {
                    listeners.delete(listener)
                }
            },
        } satisfies MpvStreamedSubtitles,
        push: (received: MpvStreamedSubtitleLine[]) => {
            lines.push(...received)
            for (const listener of listeners) listener(received)
        },
        clear: () => {
            listeners.clear()
            lines.length = 0
        },
    }
}

function createFontStore(): MpvFontData & { add: (font: Uint8Array) => void; clear: () => void } {
    const fonts: Uint8Array[] = []
    const listeners = new Set<(fonts: Uint8Array[]) => void>()
    return {
        current: () => fonts.slice(),
        subscribe: (listener) => {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        add: (font) => {
            fonts.push(font)
            for (const listener of listeners) listener([font])
        },
        clear: () => {
            listeners.clear()
            fonts.length = 0
        },
    }
}

/**
 * The session's one reader: paced (one request at a time, MIN_GAP_MS apart,
 * backing off on 429/503), on the page's fetch, or on the relay service
 * once CORS turned out to block fetch.
 */
function createSessionReader(url: string) {
    let relay: RangeReader | null = null
    const fetchReader = createFetchRangeReader(url, { onRead: countingRead })
    const paced = createPacedReader({
        read: (start, length) => (relay ?? fetchReader).read(start, length),
        size: () => (relay ?? fetchReader).size(),
    }, {
        minGapMs: MIN_GAP_MS,
        onStats: network => directPlayDiagnostics.update({ network }),
    })
    // Over the relay, each call is at most 1 MiB, and each one is paced.
    const relayChunks = chunkedReader(paced, RELAY_CALL_BYTES)
    const reader: RangeReader = {
        read: (start, length) => (relay ? relayChunks : paced).read(start, length),
        size: paced.size,
    }
    return {
        reader,
        useRelay: () => {
            relay = createRelayRangeReader(url, countingRead)
        },
    }
}

/** Reads the header with the page's fetch, or through the relay service when CORS blocks that. */
async function openFile(url: string): Promise<{ reader: RangeReader; index: MkvIndex; path: "fetch" | "relay" }> {
    const began = Date.now()
    const session = createSessionReader(url)
    try {
        const index = await withTimeout(readMkvIndex(session.reader), HEADER_TIMEOUT_MS, "Reading the file's header")
        directPlayDiagnostics.update(d => ({
            headerMs: Date.now() - began,
            headerRequests: d.reads.count,
            headerBytes: d.reads.bytes,
            cors: [...d.cors, "fetch with Range from the app works (the CDN allows this origin)"],
        }))
        return { reader: session.reader, index, path: "fetch" }
    } catch (error) {
        if (!(error instanceof RangeFetchError && error.kind === "cors")) throw error
        directPlayDiagnostics.update(d => ({ cors: [...d.cors, "fetch with Range is blocked by CORS"] }))
        if (!canUseRelayRanges()) throw error
        log.warning("CORS blocks the subtitle reads; using the app's relay service for them")
        if (DIRECT_PLAY_LOUD) toast.warning("Direct play: CORS blocks reading subtitles from the CDN, so they go through the app's service (video still direct).", { visibilityTime: 6000 })
        const relayBegan = Date.now()
        session.useRelay()
        const index = await withTimeout(readMkvIndex(session.reader), HEADER_TIMEOUT_MS * 2, "Reading the file's header through the service")
        directPlayDiagnostics.update(d => ({
            headerMs: Date.now() - relayBegan,
            headerRequests: d.reads.count,
            headerBytes: d.reads.bytes,
            cors: [...d.cors, "the relay service reads the ranges fine"],
        }))
        return { reader: session.reader, index, path: "relay" }
    }
}

/** Fonts the file carries: the Attachments element in a few large reads, handed to libass as they come. */
async function loadFonts(reader: RangeReader, index: MkvIndex, store: ReturnType<typeof createFontStore>, cancelled: () => boolean) {
    if (!index.attachmentsElement) return
    try {
        const files = await readAttachedFiles(reader, index, { maxBytes: MAX_ATTACHMENTS_BYTES, chunkBytes: 6 * 1024 * 1024 })
        if (cancelled()) return
        if (files === null) {
            directPlayDiagnostics.update(d => ({ fonts: { ...d.fonts, error: `attachments over ${MAX_ATTACHMENTS_BYTES / 1048576} MiB, not read` } }))
            return
        }
        const fonts = files.filter(isFontAttachment)
        directPlayDiagnostics.update(d => ({ fonts: { ...d.fonts, listed: fonts.length } }))
        for (const font of fonts) {
            store.add(font.data)
            directPlayDiagnostics.update(d => ({ fonts: { ...d.fonts, loaded: d.fonts.loaded + 1, bytes: d.fonts.bytes + font.data.length } }))
        }
    } catch (error) {
        directPlayDiagnostics.update(d => ({ fonts: { ...d.fonts, error: describeError(error) } }))
    }
}

type BrowserAudioTrackList = { length: number; [index: number]: { enabled: boolean; label?: string; language?: string }; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void }

/** Follows the page's <video> for the diagnostics: buffering, seeks, errors, audio tracks. */
function watchVideo(cancelled: () => boolean, onBuffering: (buffering: boolean) => void): () => void {
    let video: HTMLVideoElement | null = null
    let seekStarted = 0
    let lastTime = 0
    let awaitingPlaying = false
    const detach: Array<() => void> = []

    const audioList = () => (video as (HTMLVideoElement & { audioTracks?: BrowserAudioTrackList }) | null)?.audioTracks ?? null
    const enabledAudio = (list: BrowserAudioTrackList) => {
        for (let i = 0; i < list.length; i++) if (list[i].enabled) return i
        return -1
    }

    const attach = (element: HTMLVideoElement) => {
        video = element
        const on = (type: string, listener: () => void) => {
            element.addEventListener(type, listener)
            detach.push(() => element.removeEventListener(type, listener))
        }
        // The background subtitle reads give the video the line while it buffers or seeks.
        on("waiting", () => onBuffering(true))
        on("seeking", () => {
            onBuffering(true)
            seekStarted = Date.now()
            awaitingPlaying = true
            directPlayDiagnostics.update(d => ({ seeks: d.seeks + 1, lastSeek: { from: lastTime, to: element.currentTime, seekedMs: null, playingMs: null } }))
        })
        on("seeked", () => {
            const ms = Date.now() - seekStarted
            directPlayDiagnostics.update(d => d.lastSeek ? { lastSeek: { ...d.lastSeek, seekedMs: ms } } : {})
        })
        on("playing", () => {
            onBuffering(false)
            if (!awaitingPlaying) return
            awaitingPlaying = false
            const ms = Date.now() - seekStarted
            directPlayDiagnostics.update((d) => {
                if (!d.lastSeek) return {}
                const seek = { ...d.lastSeek, playingMs: ms }
                log.info("Seek", { from: Math.round(seek.from), to: Math.round(seek.to), seekedMs: seek.seekedMs, playingMs: ms })
                return { lastSeek: seek }
            })
        })
        on("timeupdate", () => {
            if (!element.seeking) lastTime = element.currentTime
        })
        on("error", () => {
            const error = element.error
            if (!error) return
            const mediaError = { code: error.code, message: error.message || "" }
            directPlayDiagnostics.update({ mediaError })
            log.error("MediaError on direct play", mediaError)
        })
        const list = audioList()
        if (list?.addEventListener) {
            const onChange = () => {
                const enabled = enabledAudio(list)
                const track = list[enabled]
                const label = track ? `#${enabled} ${track.language || ""} ${track.label || ""}`.trim() : "none"
                log.info("Audio track changed", { enabled, count: list.length })
                directPlayDiagnostics.update(d => ({ audioApi: { ...d.audioApi, enabled, count: list.length, changes: d.audioApi.changes + 1, lastChange: label } }))
            }
            list.addEventListener("change", onChange)
            detach.push(() => list.removeEventListener?.("change", onChange))
        }
    }

    const poll = setInterval(() => {
        if (cancelled()) return
        if (!video || !video.isConnected) {
            const element = typeof document !== "undefined" ? document.querySelector("video") : null
            if (element) attach(element)
            else return
        }
        const element = video!
        const list = audioList()
        directPlayDiagnostics.update(d => ({
            buffered: describeRanges(element.buffered),
            readyState: element.readyState,
            networkState: element.networkState,
            videoSize: element.videoWidth ? `${element.videoWidth}×${element.videoHeight}` : null,
            audioApi: { ...d.audioApi, available: !!list, count: list?.length ?? 0, enabled: list ? enabledAudio(list) : -1 },
        }))
    }, POLL_MS)

    return () => {
        clearInterval(poll)
        for (const off of detach) off()
    }
}

function logSummary(reason: string) {
    const lines = summarizeDiagnostics(directPlayDiagnostics.get())
    log.info(`Direct play summary (${reason})\n${lines.join("\n")}`)
}

/**
 * Starts the direct-play session for `source`: resolves the plan once the
 * header is read (or failed, then without the file's subtitles).
 */
async function startSession(source: MobilePlaybackSource, isCurrent: () => boolean): Promise<Session> {
    directPlayDiagnostics.reset(source.id)
    if (source.directRetryAttempt) directPlayDiagnostics.update({ directRetries: source.directRetryAttempt })
    log.info("Direct play: reading the file's header", { sourceId: source.id, mediaId: source.mediaId, episodeNumber: source.episodeNumber })

    let disposed = false
    const cancelled = () => disposed || !isCurrent()
    let pauseBackground: (buffering: boolean) => void = () => {}
    const stopWatching = watchVideo(cancelled, buffering => pauseBackground(buffering))
    const summaryTimer = setInterval(() => logSummary("periodic"), SUMMARY_INTERVAL_MS)
    const fonts = createFontStore()
    let extractor: SubtitleExtractor | null = null
    let lineStore: ReturnType<typeof createLineStore> | null = null

    const fail = (what: string, error: unknown, kind: DirectPlayFailureKind) => {
        const failure = `Direct play failed: ${what}: ${describeError(error)}`
        log.error(failure)
        directPlayDiagnostics.error(failure)
        directPlayDiagnostics.update({ failure, failureKind: kind, failurePositionSec: currentVideoTime(), failureCause: readFailureCause(error) })
    }

    const dispose = () => {
        if (disposed) return
        logSummary("episode closed")
        disposed = true
        extractor?.stop()
        lineStore?.clear()
        fonts.clear()
        stopWatching()
        clearInterval(summaryTimer)
    }

    const plan: DirectPlayPlan = {
        externalSubtitles: [],
        subtitleFontData: fonts,
        mediaInfoSummary: { mode: "direct", reasons: ["direct play: debrid link on the TV"] },
    }

    let opened: Awaited<ReturnType<typeof openFile>>
    try {
        opened = await openFile(source.url)
    } catch (error) {
        if (error instanceof MkvError) {
            // Not a Matroska file we can read (an MP4, say): it plays as it is, without the file's subtitles.
            log.info("Direct play: not a readable MKV, playing without the file's subtitles", { error: describeError(error) })
            directPlayDiagnostics.error(`not a readable MKV: ${describeError(error)}`)
        } else {
            fail("reading the file's header", error, "header")
        }
        return { id: source.id, plan, dispose }
    }
    const { reader, index, path } = opened
    const metadata = toMkvMetadata(index)
    const codecs = describeStreamCodecs(metadata)
    const subtitleTracks = index.tracks.filter(track => track.kind === "subtitle")
    directPlayDiagnostics.update({
        readerPath: path,
        container: { docType: index.docType, muxingApp: index.muxingApp, writingApp: index.writingApp, durationSec: index.durationSec, hasCues: index.hasCues },
        video: { codec: codecs.video, resolution: codecs.resolution, problems: codecs.videoProblems },
        subtitleTracks: subtitleTracks.map(track => ({
            number: track.number,
            codec: track.codecId,
            language: track.languageIETF || track.language,
            title: track.name,
            supported: isTextSubtitle(track) && !track.unsupportedEncoding,
        })),
        audioTracks: index.tracks.filter(track => track.kind === "audio").map(track => ({
            number: track.number,
            codec: track.codecId,
            language: track.languageIETF || track.language,
            title: track.name,
            default: track.default,
        })),
    })
    log.info("Direct play: header read", {
        path,
        docType: index.docType,
        writingApp: index.writingApp,
        hasCues: index.hasCues,
        cues: index.cues.length,
        video: codecs.video,
        resolution: codecs.resolution,
        audio: codecs.audio,
        subtitles: subtitleTracks.map(track => `${track.number}:${track.codecId}:${track.language ?? ""}`),
        attachments: index.attachments.length,
        headerMs: directPlayDiagnostics.get().headerMs,
    })

    const readable = subtitleTracks.filter(track => isTextSubtitle(track) && !track.unsupportedEncoding)
    lineStore = createLineStore(readable.map(track => ({
        number: track.number,
        title: track.name || undefined,
        lang: track.languageIETF || track.language || undefined,
        codec: track.codecId,
        // CodecPrivate is the script header; muxers often end it with a NUL.
        header: metadata.subtitleTracks?.find(item => item.number === track.number)?.codecPrivate?.replace(/\u0000+$/, "") || undefined,
    })))
    const store = lineStore

    extractor = createSubtitleExtractor({
        reader,
        index,
        isFatal: isFatalRangeError,
        onLines: lines => {
            if (!cancelled()) store.push(lines)
        },
        onStats: stats => directPlayDiagnostics.update({ extractor: stats }),
        onFatal: error => fail("reading subtitles", error, "subtitles"),
    })
    const subtitleReader = extractor
    subtitleReader.seek(source.resumePositionSec ?? 0)
    pauseBackground = buffering => subtitleReader.setBackgroundPaused(buffering)
    // After the first subtitle reads: they share one paced queue.
    setTimeout(() => {
        if (!cancelled()) void loadFonts(reader, index, fonts, cancelled)
    }, FONTS_DELAY_MS)

    plan.streamedSubtitles = store.streamed
    plan.audioTracks = codecs.audioTracks
    plan.chapters = directStreamChapters(metadata)
    plan.mediaInfoSummary = {
        mode: "direct",
        reasons: ["direct play: debrid link on the TV", ...codecs.videoProblems],
        videoCodec: codecs.video,
        audioCodec: codecs.audio.join(", ") || undefined,
        resolution: codecs.resolution,
    }
    plan.onMediaEvent = (event: MpvMediaEvent) => {
        if (cancelled()) return
        if (event.type === "loadedmetadata" || event.type === "seeked") subtitleReader.seek(event.currentTime)
        else subtitleReader.update(event.currentTime)
    }
    if (subtitleTracks.length > readable.length) {
        directPlayDiagnostics.error(`${subtitleTracks.length - readable.length} subtitle track(s) are image-based or encoded and not read on the TV`)
    }
    return { id: source.id, plan, dispose }
}

/**
 * The direct-play plan for a `directPlay` source, or null while its header
 * is read (and for other sources).
 */
export function useDirectPlaySession(source: MobilePlaybackSource | null): Session | null {
    const [session, setSession] = React.useState<Session | null>(null)
    const latest = React.useRef(source)
    latest.current = source
    const id = source?.directPlay ? source.id : null

    React.useEffect(() => {
        const current = latest.current
        if (!id || !current) {
            setSession(null)
            return
        }
        let active = true
        let started: Session | null = null
        void startSession(current, () => active).then((created) => {
            if (!active) {
                created.dispose()
                return
            }
            started = created
            setSession(created)
        })
        return () => {
            active = false
            started?.dispose()
            directPlayDiagnostics.reset(null)
        }
    }, [id])

    return session?.id === id ? session : null
}

/**
 * For the player's error handler: a MediaError on direct play. The test build
 * shows it plainly; the normal build reports it handled (`true`), as the
 * player starts the episode again through the server (or shows its error
 * screen when it can't).
 */
export function directPlayErrorMessage(error: { message: string; code?: number; position?: number }): true | string {
    const failure = `Direct play failed: the TV's player reported ${error.code !== undefined ? `MediaError ${error.code}` : "an error"}${error.message ? ` (${error.message})` : ""}`
    directPlayDiagnostics.update({
        failure,
        failureKind: "video",
        failureCause: mediaErrorCause(error.code),
        failurePositionSec: error.position ?? currentVideoTime(),
        mediaError: { code: error.code ?? 0, message: error.message },
    })
    log.error(failure)
    logSummary("playback error")
    return DIRECT_PLAY_LOUD ? failure : true
}

function currentVideoTime(): number {
    const video = typeof document !== "undefined" ? document.querySelector("video") : null
    return video && Number.isFinite(video.currentTime) ? video.currentTime : 0
}
