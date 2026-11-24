import type { Anime_Episode, HibikeTorrent_AnimeTorrent, HibikeTorrent_BatchEpisodeFiles } from "@/api/generated/types"

/**
 * Direct play (webOS): how the last debrid stream was started and which
 * release and file it resolved, so "Retry via server" starts it the same way
 * and a direct retry asks for a fresh link to the same file. Kept free of
 * React Native so the tests load it.
 */

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
    /**
     * The release and file the server resolved (its link event names them,
     * auto-select included): a direct-play retry asks for a fresh link to
     * exactly this file instead of running auto-select again.
     */
    resolved?: { torrent: HibikeTorrent_AnimeTorrent; fileId: string }
}

/** A direct-play retry in flight: the next link for this episode plays from `resumeAtSec`. */
export type DirectRetryRequest = { mediaId: number; episodeNumber: number; attempt: number; resumeAtSec: number }

let lastDebridStart: DebridStartRecord | null = null
// A property, not a module variable: see the Terser note in AGENTS.md (read, then clear).
const retry: { pending: DirectRetryRequest | null } = { pending: null }

export function rememberDebridStart(record: DebridStartRecord) {
    lastDebridStart = record
}

export function lastDebridStartFor(mediaId: number, episodeNumber: number): DebridStartRecord | null {
    const record = lastDebridStart
    return record && record.mediaId === mediaId && record.episodeNumber === episodeNumber ? record : null
}

/** The server's link event named the release and file of this episode's stream. */
export function rememberResolvedDebridRelease(mediaId: number, episodeNumber: number, torrent: HibikeTorrent_AnimeTorrent, fileId: string) {
    const record = lastDebridStartFor(mediaId, episodeNumber)
    if (record) record.resolved = { torrent, fileId }
}

/** The next direct link for the episode is a retry: it plays from where the failed one stopped. */
export function requestDirectRetry(request: DirectRetryRequest) {
    retry.pending = request
}

/** The retry the link for this episode answers, if any; consumes it. */
export function takeDirectRetry(mediaId: number, episodeNumber: number): DirectRetryRequest | null {
    const request = retry.pending
    if (!request || request.mediaId !== mediaId || request.episodeNumber !== episodeNumber) return null
    retry.pending = null
    return request
}

/** A retry that won't come (cancelled, failed to start). */
export function clearDirectRetry() {
    retry.pending = null
}

/**
 * The release and file a direct retry asks a fresh link for: the one the
 * server resolved, or the file picked by hand. Null when only "auto-select"
 * is known (an older server): then there is no direct retry, as running
 * auto-select again could pick another release.
 */
export function directRetrySelection(record: DebridStartRecord | null): { torrent: HibikeTorrent_AnimeTorrent; fileId: string } | null {
    if (!record) return null
    if (record.resolved) return record.resolved
    if (record.manual?.fileId) return { torrent: record.manual.torrent, fileId: record.manual.fileId }
    return null
}
