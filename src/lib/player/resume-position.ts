import type { Continuity_WatchHistory } from "@/api/generated/types"

/**
 * Where "continue watching" picks up an episode: the watch history's
 * position when it is for this episode and between 2 % and 90 % in;
 * otherwise null (start from the beginning).
 */
export function getWatchHistoryResumePosition(
    watchHistory: Continuity_WatchHistory | null | undefined,
    source: { mediaId: number; episodeNumber: number },
): number | null {
    const item = watchHistory?.[source.mediaId]
    if (!item || item.episodeNumber !== source.episodeNumber) return null
    const ratio = item.duration > 0 ? item.currentTime / item.duration : 0
    return ratio < 0.9 && ratio >= 0.02 ? item.currentTime : null
}

/**
 * How far into the episode the resume position is, in percent (at least 1 so
 * the bar shows), or 0 when there is nothing to resume. A card's progress bar
 * uses it so the bar appears exactly when playing the card resumes.
 */
export function getWatchHistoryResumePercent(
    watchHistory: Continuity_WatchHistory | null | undefined,
    source: { mediaId: number; episodeNumber: number },
): number {
    const position = getWatchHistoryResumePosition(watchHistory, source)
    const duration = watchHistory?.[source.mediaId]?.duration ?? 0
    if (position === null || duration <= 0) return 0
    return Math.max(1, Math.round((position / duration) * 100))
}
