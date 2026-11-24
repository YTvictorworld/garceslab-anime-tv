/**
 * What direct play found out about the current episode, for the
 * on-screen diagnostics panel (Info key) and the log summary. Never holds
 * the debrid URL: it carries the account's access token.
 * Kept free of React Native (and of `@/` imports) so the tests load it.
 */
import type { PacedReaderStats } from "./mkv/range-reader.ts"
import type { ExtractorStats } from "./mkv/subtitle-extractor.ts"

import type { DirectPlayFailureKind } from "./direct-play-policy"

export type DirectPlaySubtitleTrack = {
    number: number
    codec: string
    language?: string
    title?: string
    /** Text tracks are read; image ones (PGS, VobSub) are not read on the TV. */
    supported: boolean
}

export type DirectPlayAudioTrack = { number: number; codec: string; language?: string; title?: string; default: boolean }

export type DirectPlayDiagnostics = {
    active: boolean
    sourceId: string | null
    startedAt: number
    /** "fetch": the page reads the CDN itself. "relay": through the app's JS service (CORS). */
    readerPath: "fetch" | "relay" | null
    /** CORS findings, as plain sentences. */
    cors: string[]
    container: { docType: string; muxingApp?: string; writingApp?: string; durationSec: number; hasCues: boolean } | null
    video: { codec?: string; resolution?: string; problems: string[] } | null
    headerMs: number | null
    headerRequests: number
    headerBytes: number
    subtitleTracks: DirectPlaySubtitleTrack[]
    audioTracks: DirectPlayAudioTrack[]
    extractor: ExtractorStats | null
    /** The paced reader's counts: every subtitle, header and font request to the CDN. */
    network: PacedReaderStats | null
    fonts: { listed: number; loaded: number; bytes: number; error?: string }
    /** The <video>'s audioTracks API. */
    audioApi: { available: boolean; count: number; enabled: number; changes: number; lastChange: string | null }
    buffered: string
    readyState: number
    networkState: number
    videoSize: string | null
    seeks: number
    lastSeek: { from: number; to: number; seekedMs: number | null; playingMs: number | null } | null
    mediaError: { code: number; message: string } | null
    /** Range reads: count, failures, slowest and average time. */
    reads: { count: number; failed: number; bytes: number; totalMs: number; maxMs: number }
    errors: string[]
    /** The failure, as logged and shown by the test build ("Direct play failed: …"). */
    failure: string | null
    /** What failed, for the player's fallback (direct-play-policy.ts). */
    failureKind: DirectPlayFailureKind | null
    /** Seconds the video had played when it failed. */
    failurePositionSec: number
}

function fresh(sourceId: string | null): DirectPlayDiagnostics {
    return {
        active: sourceId !== null,
        sourceId,
        startedAt: Date.now(),
        readerPath: null,
        cors: [],
        container: null,
        video: null,
        headerMs: null,
        headerRequests: 0,
        headerBytes: 0,
        subtitleTracks: [],
        audioTracks: [],
        extractor: null,
        network: null,
        fonts: { listed: 0, loaded: 0, bytes: 0 },
        audioApi: { available: false, count: 0, enabled: -1, changes: 0, lastChange: null },
        buffered: "",
        readyState: 0,
        networkState: 0,
        videoSize: null,
        seeks: 0,
        lastSeek: null,
        mediaError: null,
        reads: { count: 0, failed: 0, bytes: 0, totalMs: 0, maxMs: 0 },
        errors: [],
        failure: null,
        failureKind: null,
        failurePositionSec: 0,
    }
}

let state = fresh(null)
const listeners = new Set<() => void>()
let notifyQueued = false

function notify() {
    // Video events come in bursts; one re-render per tick is plenty.
    if (notifyQueued) return
    notifyQueued = true
    setTimeout(() => {
        notifyQueued = false
        for (const listener of listeners) listener()
    }, 0)
}

export const directPlayDiagnostics = {
    get: () => state,
    subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    },
    reset: (sourceId: string | null) => {
        state = fresh(sourceId)
        notify()
    },
    update: (change: Partial<DirectPlayDiagnostics> | ((current: DirectPlayDiagnostics) => Partial<DirectPlayDiagnostics>)) => {
        const patch = typeof change === "function" ? change(state) : change
        state = { ...state, ...patch }
        notify()
    },
    error: (message: string) => {
        const stamp = ((Date.now() - state.startedAt) / 1000).toFixed(1)
        state = { ...state, errors: [...state.errors.slice(-19), `+${stamp}s ${message}`] }
        notify()
    },
}

/** "0.0–35.2, 120.0–130.5" */
export function describeRanges(ranges: { length: number; start: (i: number) => number; end: (i: number) => number } | null | undefined): string {
    if (!ranges || ranges.length === 0) return "none"
    const parts: string[] = []
    for (let i = 0; i < ranges.length; i++) parts.push(`${ranges.start(i).toFixed(1)}–${ranges.end(i).toFixed(1)}`)
    return parts.join(", ")
}

const kib = (bytes: number) => (bytes / 1024).toFixed(0)
const mib = (bytes: number) => (bytes / 1048576).toFixed(1)

/** One line per finding, for the log and for reading off a screenshot. */
export function summarizeDiagnostics(d: DirectPlayDiagnostics): string[] {
    const lines: string[] = []
    const x = d.extractor
    lines.push(`mode: direct (debrid link on the TV's <video>); bytes for subtitles via ${d.readerPath ?? "—"}`)
    if (d.failure) lines.push(`FAILURE: ${d.failure}`)
    if (d.container) {
        const c = d.container
        lines.push(`container: ${c.docType}, ${c.durationSec.toFixed(0)} s, muxer ${c.writingApp ?? "?"} / ${c.muxingApp ?? "?"}, cues ${c.hasCues ? "yes" : "no"}`)
    }
    if (d.video) lines.push(`video: ${d.video.codec ?? "?"} ${d.video.resolution ?? ""}${d.video.problems.length ? ` (problems: ${d.video.problems.join(", ")})` : ""}; decoded ${d.videoSize ?? "?"}`)
    if (d.headerMs !== null) lines.push(`header: ${d.headerMs} ms, ${d.headerRequests} reads, ${(d.headerBytes / 1024).toFixed(0)} KiB`)
    for (const cors of d.cors) lines.push(`cors: ${cors}`)
    const subs = d.subtitleTracks.map(track => `#${track.number} ${track.codec}${track.language ? ` ${track.language}` : ""}${track.supported ? `: ${x?.lines[track.number] ?? 0} lines` : " (not read)"}`)
    lines.push(`subtitle tracks: ${subs.length ? subs.join("; ") : "none"}`)
    const n = d.network
    if (n) {
        const backoff = n.backoffUntil !== null ? `BACKING OFF ${Math.max(0, (n.backoffUntil - Date.now()) / 1000).toFixed(0)} s (${n.backoffReason ?? "?"})` : "no backoff"
        lines.push(`CDN requests (subs+header+fonts): ${n.requests}, 429/503: ${n.rateLimited}, retries: ${n.retries}, ${mib(n.bytes)} MiB; reading now: ${n.currentRead !== null ? `${kib(n.currentRead)} KiB` : "—"}; queued ${n.queued}; ${backoff}`)
    }
    if (x) {
        lines.push(`subtitles: ${x.strategy} (${x.reason}); ${x.done}/${x.total || "?"} ${x.strategy === "scan" ? "clusters" : "blocks"} in ${x.requests} reads (last ${kib(x.lastReadBytes)} KiB), ${mib(x.bytes)} MiB, first line after ${x.firstLineMs ?? "—"} ms, ahead ${Number.isFinite(x.readAhead) ? `${x.readAhead.toFixed(0)} s` : "all"}${x.backgroundPaused ? ", background paused (buffering)" : ""}${x.consecutiveFailures ? `, ${x.consecutiveFailures} failed in a row` : ""}${x.finished ? ", finished" : ""}${x.stopped ? ", STOPPED" : ""}`)
    }
    lines.push(`fonts: ${d.fonts.loaded}/${d.fonts.listed} loaded (${(d.fonts.bytes / 1024).toFixed(0)} KiB)${d.fonts.error ? `, ${d.fonts.error}` : ""}`)
    const audio = d.audioTracks.map(track => `#${track.number} ${track.codec}${track.language ? ` ${track.language}` : ""}${track.default ? " (default)" : ""}`)
    lines.push(`audio tracks (file): ${audio.length ? audio.join("; ") : "none"}`)
    const api = d.audioApi
    lines.push(`audioTracks API: ${api.available ? `yes, ${api.count} tracks, enabled #${api.enabled}, ${api.changes} switches${api.lastChange ? ` (last: ${api.lastChange})` : ""}` : "not available"}`)
    lines.push(`buffered: ${d.buffered || "none"}; readyState ${d.readyState}, networkState ${d.networkState}`)
    if (d.lastSeek) {
        const s = d.lastSeek
        lines.push(`last seek: ${s.from.toFixed(0)} → ${s.to.toFixed(0)} s, seeked after ${s.seekedMs ?? "…"} ms, playing after ${s.playingMs ?? "…"} ms (${d.seeks} seeks)`)
    }
    const r = d.reads
    if (r.count) lines.push(`range reads: ${r.count} (${r.failed} failed), avg ${(r.totalMs / r.count).toFixed(0)} ms, max ${r.maxMs} ms`)
    if (d.mediaError) lines.push(`MediaError ${d.mediaError.code}: ${d.mediaError.message}`)
    for (const error of d.errors.slice(-5)) lines.push(`error: ${error}`)
    return lines
}
