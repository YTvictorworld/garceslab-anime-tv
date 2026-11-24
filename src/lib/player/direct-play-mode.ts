import type { Anime_Episode, HibikeTorrent_AnimeTorrent, HibikeTorrent_BatchEpisodeFiles } from "@/api/generated/types"
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

/** How the last debrid stream was started, so "Retry via server" can start it the same way. */
export type DebridStartRecord = {
    mediaId: number
    episodeNumber: number
    episode: Anime_Episode
    kind: "auto-select" | "manual"
    manual?: {
        torrent: HibikeTorrent_AnimeTorrent
        fileId?: string
        fileIndex?: number
        batchEpisodeFiles?: HibikeTorrent_BatchEpisodeFiles
    }
}

let lastDebridStart: DebridStartRecord | null = null
let relayNext = false

export function rememberDebridStart(record: DebridStartRecord) {
    lastDebridStart = record
}

export function lastDebridStartFor(mediaId: number, episodeNumber: number): DebridStartRecord | null {
    const record = lastDebridStart
    return record && record.mediaId === mediaId && record.episodeNumber === episodeNumber ? record : null
}

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
