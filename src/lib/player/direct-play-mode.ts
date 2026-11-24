import type { Anime_Episode, HibikeTorrent_AnimeTorrent, HibikeTorrent_BatchEpisodeFiles } from "@/api/generated/types"
import { Platform } from "react-native"

/**
 * Direct-play spike (phase 1.5). In the test build, a debrid stream asks
 * the server for the debrid link only (the "externalPlayerLink" playback
 * type, which the server already supports for external players) and the
 * TV's <video> plays that link itself; subtitles are read from the MKV on
 * the TV (direct-play-session.ts). The server still gets progress per
 * profile through manual tracking and continuity, as the native apps do.
 *
 * On in the side-by-side build whose app id contains "directtest"
 * (`WEBOS_APP_ID=app.garceslab.anime.directtest npm run build:webos`), or
 * with EXPO_PUBLIC_DIRECT_PLAY_TEST=1. Torrent streams are unchanged.
 */
export const DIRECT_PLAY_TEST = Platform.OS === "web" && (
    process.env.EXPO_PUBLIC_DIRECT_PLAY_TEST === "1"
    || /directtest/.test(process.env.EXPO_PUBLIC_WEBOS_APP_ID ?? "")
)

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
    if (!DIRECT_PLAY_TEST) return false
    const relay = relayNext
    relayNext = false
    return !relay
}
