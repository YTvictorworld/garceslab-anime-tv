import type { Continuity_WatchHistory } from "@/api/generated/types"

/**
 * When an episode resumes: from `minSeconds` (or `minRatio` of the episode)
 * in, and before `maxRatio`. Earlier or later, it starts from the beginning.
 */
export type ResumeRule = { minSeconds?: number; minRatio?: number; maxRatio: number }

/** Phones, Android TV and tvOS: 2 % to 90 % in. */
export const DEFAULT_RESUME_RULE: ResumeRule = { minRatio: 0.02, maxRatio: 0.9 }
/** webOS (and the other web TV builds): from 10 seconds in, to 90 %. */
export const WEB_TV_RESUME_RULE: ResumeRule = { minSeconds: 10, maxRatio: 0.9 }

/**
 * Where "continue watching" picks up an episode: the watch history's
 * position when it is for this episode and within `rule`; otherwise null
 * (start from the beginning).
 */
export function getWatchHistoryResumePosition(
    watchHistory: Continuity_WatchHistory | null | undefined,
    source: { mediaId: number; episodeNumber: number },
    rule: ResumeRule = DEFAULT_RESUME_RULE,
): number | null {
    const item = watchHistory?.[source.mediaId]
    if (!item || item.episodeNumber !== source.episodeNumber || !(item.duration > 0)) return null
    const ratio = item.currentTime / item.duration
    if (ratio >= rule.maxRatio) return null
    if (rule.minSeconds !== undefined && item.currentTime < rule.minSeconds) return null
    if (rule.minRatio !== undefined && ratio < rule.minRatio) return null
    return item.currentTime
}

/**
 * How far into the episode the resume position is, in percent (at least 1 so
 * the bar shows), or 0 when there is nothing to resume. A card's progress bar
 * uses it so the bar appears exactly when playing the card resumes.
 */
export function getWatchHistoryResumePercent(
    watchHistory: Continuity_WatchHistory | null | undefined,
    source: { mediaId: number; episodeNumber: number },
    rule: ResumeRule = DEFAULT_RESUME_RULE,
): number {
    const position = getWatchHistoryResumePosition(watchHistory, source, rule)
    const duration = watchHistory?.[source.mediaId]?.duration ?? 0
    if (position === null || duration <= 0) return 0
    return Math.max(1, Math.round((position / duration) * 100))
}
