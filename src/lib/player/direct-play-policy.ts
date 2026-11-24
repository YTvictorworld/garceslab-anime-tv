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

/**
 * What the player does when direct play fails. The relay is tried once per
 * episode, and only for a failure at the start (a link the TV can't play, or
 * a file whose header can't be read); a video failure later, or once the
 * relay was tried, shows the error screen. Subtitles failing mid-episode only
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
}): DirectPlayFailureAction {
    if (opts.loud) return { type: "dialog" }
    if (kind === "subtitles") return { type: "notice", notice: SUBTITLES_NOTICE }
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
