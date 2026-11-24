/**
 * Direct play of debrid streams (phase 2, docs/phase2-direct-play.md in the
 * server repository): the decisions, kept free of React Native so they can be
 * unit tested. direct-play-mode.ts applies them to the running app.
 */

/** Which failure the direct-play session ran into. */
export type DirectPlayFailureKind =
    /** The <video> couldn't play the link (MediaError). */
    | "video"
    /** The file's header couldn't be read (network, CDN, timeout): no subtitles, no tracks. */
    | "header"
    /** Subtitles stopped loading part way (the video keeps playing). */
    | "subtitles"

export type DirectPlayFlags = {
    /** Debrid streams play the link on the TV (default on webOS). */
    enabled: boolean
    /** The side-by-side test build: failures open the diagnostics dialog instead of falling back quietly. */
    loud: boolean
}

/**
 * Direct play is the default on webOS (the "web" platform of this app).
 * `EXPO_PUBLIC_DIRECT_PLAY=0` turns it off (every debrid stream goes through
 * the server, as before phase 2). The side-by-side test build (app id with
 * "directtest", or `EXPO_PUBLIC_DIRECT_PLAY_TEST=1`) keeps the spike's loud
 * failure dialog.
 */
export function directPlayFlags(env: { platform: string; directPlay?: string; directPlayTest?: string; appId?: string }): DirectPlayFlags {
    const web = env.platform === "web"
    const loud = web && (env.directPlayTest === "1" || /directtest/.test(env.appId ?? ""))
    const enabled = web && (loud || env.directPlay !== "0")
    return { enabled, loud }
}

export type DirectPlayFailureAction =
    /** Test build: the dialog with the diagnostics and "Retry via server". */
    | { type: "dialog" }
    /**
     * Ask the server for a fresh link to the same release and file and play it
     * directly again, after `delayMs`, from `resumeAtSec`. `attempt` of `of`.
     */
    | { type: "retry-direct"; attempt: number; of: number; delayMs: number; resumeAtSec: number; notice: string }
    /** Start the same release again through the server, with a short notice. */
    | { type: "retry-relay"; notice: string }
    /** Keep watching; tell the viewer once. */
    | { type: "notice"; notice: string }
    /** No quiet way out: the error screen (with its "Retry via server" button). */
    | { type: "error"; message: string }
    | { type: "none" }

export const RELAY_NOTICE = "Playing through the server instead."
export const SUBTITLES_NOTICE = "Subtitles couldn't be loaded for this episode."
export const VIDEO_FAILED_MESSAGE = "This episode couldn't play directly on the TV. Try playing it through the server."

/** Direct attempts after the first one fails, before the relay (or the error screen). */
export const DIRECT_PLAY_RETRIES = 3
/** The wait before each direct retry: 2 s, 4 s, 8 s. */
export const DIRECT_RETRY_BACKOFF_MS: readonly number[] = [2000, 4000, 8000]
/** Played this long since the last retry, a new failure counts from the first retry again. */
export const DIRECT_RETRY_RESET_AFTER_SEC = 60

export function directRetryNotice(attempt: number, of: number = DIRECT_PLAY_RETRIES) {
    return `Retrying direct play (${attempt}/${of})…`
}

/**
 * Why a direct-play failure happened, as far as the TV can tell.
 * - rate-limit: the CDN kept answering 429/503 (after the paced reader's own Retry-After backoff).
 * - link: the CDN refused the link (HTTP 4xx: expired, revoked, not found).
 * - network, timeout: the request failed or took too long.
 * - blocked: CORS keeps the TV from reading the file (and the app's relay service can't either).
 * - aborted, decode, unsupported: the <video>'s MediaError 1, 3 and 4.
 */
export type DirectPlayFailureCause = "rate-limit" | "link" | "network" | "timeout" | "blocked" | "aborted" | "decode" | "unsupported" | "unknown"

/** The cause of a failed header or subtitle read (a RangeFetchError, or the header timeout). */
export function readFailureCause(error: unknown): DirectPlayFailureCause {
    const { kind, status } = (typeof error === "object" && error !== null ? error : {}) as { kind?: unknown; status?: unknown }
    if (kind === "rate-limit" || status === 429 || status === 503) return "rate-limit"
    if (kind === "http" && typeof status === "number" && status >= 400 && status < 500) return "link"
    if (kind === "cors") return "blocked"
    if (kind === "timeout" || (error instanceof Error && /took longer than/.test(error.message))) return "timeout"
    if (kind === "network" || kind === "relay" || kind === "no-range" || kind === "http") return "network"
    return "unknown"
}

/** The cause of a MediaError (HTMLMediaElement.error.code). */
export function mediaErrorCause(code: number | undefined): DirectPlayFailureCause {
    switch (code) {
        case 1: return "aborted"
        case 2: return "network"
        case 3: return "decode"
        case 4: return "unsupported"
        default: return "unknown"
    }
}

/**
 * Whether a fresh link to the same file can fix the failure.
 *
 * Retryable: links expire and CDN nodes fail, so anything that looks like
 * the link or the network (a header read that failed with HTTP 4xx, a
 * network error or a timeout; MediaError 1 "aborted" and 2 "network"; an
 * unknown error) gets a fresh link. MediaError 4 counts as the link too
 * while the TV never read the file: Chromium reports a failed load (403,
 * 404, a dead CDN node) as "source not supported".
 *
 * Not retryable, so the relay comes at once: MediaError 3 "decode" (the
 * same bytes decode the same way), and MediaError 4 on a link that served
 * the file's header or whose codecs the TV is known not to play (the format,
 * not the link). Subtitle failures, and a header read the CDN rate-limited,
 * are never retried and never send the episode through the server: the video
 * keeps playing and the subtitles lag or are missing. A header the CDN won't
 * let the TV read (CORS) goes through the server at once, as before.
 */
export function isRetryableDirectFailure(kind: DirectPlayFailureKind, cause: DirectPlayFailureCause, opts: {
    /** The TV read the file's header from this link. */
    headerRead: boolean
    /** Codec problems found in the header (video codecs the TV can't play). */
    videoProblems: number
}): boolean {
    if (kind === "subtitles") return false
    // A CDN that forbids reading the file does so for a fresh link too.
    if (kind === "header") return cause !== "rate-limit" && cause !== "blocked"
    switch (cause) {
        case "decode":
            return false
        case "unsupported":
            return !opts.headerRead && opts.videoProblems === 0
        default:
            return true
    }
}

/** Direct retries made for this episode, counting again from zero after it played a while. */
export function directRetriesSoFar(record: { count: number; resumedAtSec: number } | undefined, failurePositionSec: number): number {
    if (!record) return 0
    return failurePositionSec - record.resumedAtSec >= DIRECT_RETRY_RESET_AFTER_SEC ? 0 : record.count
}

/**
 * What the player does when direct play fails. A retryable failure (see
 * isRetryableDirectFailure) first asks for a fresh link to the same file up
 * to DIRECT_PLAY_RETRIES times, waiting 2 s, 4 s and 8 s (longer while the
 * CDN asked to back off), at the position it failed. After that, or for a
 * failure retrying can't fix: a failure at the start (a link the TV can't
 * play, a file whose header can't be read) goes through the server once
 * per episode; a video failure later, or once the relay was tried, shows the
 * error screen (with "Retry via server"). Subtitles failing mid-episode only
 * says so.
 */
export function directPlayFailureAction(kind: DirectPlayFailureKind, opts: {
    loud: boolean
    /** The relay was already tried for this episode. */
    relayTried: boolean
    /** The player knows how this stream was started (needed to start it again). */
    canRetry: boolean
    /** Seconds the video had played when it failed. */
    playedSec: number
    cause?: DirectPlayFailureCause
    /** isRetryableDirectFailure for this failure (default: retryable unless subtitles). */
    retryable?: boolean
    /** Direct retries already made (directRetriesSoFar). */
    directRetries?: number
    /** The release and file are known, so a fresh link can be asked for without auto-select. */
    canRetryDirect?: boolean
    /** The CDN asked to wait this long (429 Retry-After or the paced reader's backoff). */
    cdnBackoffMs?: number
}): DirectPlayFailureAction {
    if (opts.loud) return { type: "dialog" }
    if (kind === "subtitles") return { type: "notice", notice: SUBTITLES_NOTICE }
    const retryable = opts.retryable ?? true
    // A rate-limited header: the video plays on, without the file's subtitles for now.
    if (kind === "header" && opts.cause === "rate-limit") return { type: "notice", notice: SUBTITLES_NOTICE }
    const done = opts.directRetries ?? 0
    if (retryable && opts.canRetryDirect && done < DIRECT_PLAY_RETRIES) {
        const attempt = done + 1
        const backoff = DIRECT_RETRY_BACKOFF_MS[Math.min(done, DIRECT_RETRY_BACKOFF_MS.length - 1)]
        return {
            type: "retry-direct",
            attempt,
            of: DIRECT_PLAY_RETRIES,
            delayMs: Math.max(backoff, opts.cdnBackoffMs ?? 0),
            resumeAtSec: Math.max(0, opts.playedSec),
            notice: directRetryNotice(attempt),
        }
    }
    const early = kind === "header" || opts.playedSec < 30
    if (early && opts.canRetry && !opts.relayTried) return { type: "retry-relay", notice: RELAY_NOTICE }
    if (kind === "header") return { type: "notice", notice: SUBTITLES_NOTICE }
    return { type: "error", message: VIDEO_FAILED_MESSAGE }
}

/** Sent by a server with viewer sessions to the device whose session it ended. */
export const VIEWER_SESSION_ENDED_EVENT = "viewer-session-ended"

/** The `viewer-session-ended` event of a server with viewer sessions. */
export type ViewerSessionEnded = {
    sessionId: string
    reason: "replaced" | "disconnected" | "idle" | "admin" | "failed" | "profile-gone" | string
    mediaId: number
    episodeNumber: number
}

export type ViewerSessionEndedAction =
    /** Leave the player and say why. */
    | { type: "leave"; message: string }
    /** The slot lapsed while the player stayed open: take one again (quietly). */
    | { type: "reclaim" }
    | { type: "none" }

/**
 * What the TV does when the server ends its viewer session while the player
 * shows `playing` (null when the player is closed or shows another episode).
 */
export function viewerSessionEndedAction(event: ViewerSessionEnded, playing: { mediaId: number; episodeNumber: number } | null): ViewerSessionEndedAction {
    if (!playing || event.mediaId !== playing.mediaId || (event.episodeNumber > 0 && event.episodeNumber !== playing.episodeNumber)) {
        return { type: "none" }
    }
    switch (event.reason) {
        case "admin":
            return { type: "leave", message: "Playback was stopped from Settings on another device." }
        case "replaced":
            return { type: "leave", message: "This profile started watching on another device." }
        case "profile-gone":
            return { type: "leave", message: "This profile was deleted." }
        case "idle":
        case "disconnected":
            return { type: "reclaim" }
        default:
            return { type: "none" }
    }
}
