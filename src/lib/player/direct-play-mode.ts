import { Platform } from "react-native"
import { directPlayFlags } from "./direct-play-policy"

/**
 * Direct play of debrid streams (phase 2): a debrid stream asks the server
 * for the debrid link only (the "externalPlayerLink" playback type) and the
 * TV's <video> plays that link itself; subtitles are read from the MKV on
 * the TV (direct-play-session.ts). The server keeps a viewer session for the
 * TV (up to 3 at a time) and gets progress per profile through manual
 * tracking and continuity. Torrent streams, library files and online
 * streams are unchanged.
 *
 * On by default on webOS; `EXPO_PUBLIC_DIRECT_PLAY=0` builds turn it off.
 * The side-by-side test build (`WEBOS_APP_ID=app.garceslab.anime.directtest
 * npm run build:webos`, or EXPO_PUBLIC_DIRECT_PLAY_TEST=1) keeps the
 * spike's loud failure dialog; the normal build falls back to the server
 * quietly (direct-play-policy.ts).
 */
const flags = directPlayFlags({
    platform: Platform.OS,
    directPlay: process.env.EXPO_PUBLIC_DIRECT_PLAY,
    directPlayTest: process.env.EXPO_PUBLIC_DIRECT_PLAY_TEST,
    appId: process.env.EXPO_PUBLIC_WEBOS_APP_ID,
})

/** Debrid streams play the link on the TV. */
export const DIRECT_PLAY = flags.enabled
/** The side-by-side test build: loud failures with the diagnostics. */
export const DIRECT_PLAY_LOUD = flags.loud

export {
    clearDirectRetry,
    type DebridStartRecord,
    directRetrySelection,
    type DirectRetryRequest,
    lastDebridStartFor,
    rememberDebridStart,
    rememberResolvedDebridRelease,
    requestDirectRetry,
    takeDirectRetry,
} from "./direct-play-starts"

let relayNext = false

/** The next debrid start goes through the server's direct stream (the normal path). */
export function requestRelayForNextStart() {
    relayNext = true
}

/** Whether this debrid start plays the link directly; consumes a pending "via server". */
export function takeDirectPlayForDebridStart(): boolean {
    if (!DIRECT_PLAY) return false
    const relay = relayNext
    relayNext = false
    return !relay
}
