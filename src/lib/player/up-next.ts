/**
 * Garceslab Anime: when the TV player shows its "Up next" card, Netflix-style.
 * The card comes up while the episode still plays: when the ending starts
 * (the ED from chapters or AniSkip, when it sits at the end of the episode) or
 * in the last seconds, and its countdown plays the next episode. "Watch
 * credits" hides it until the episode ends, when it comes back once more.
 * Pure, so tests load it directly.
 */

/** The card shows this long before the end at the latest. */
export const UP_NEXT_LEAD_SECONDS = 20
/** Countdown when the card comes up before the end. */
export const UP_NEXT_COUNTDOWN_SECONDS = 15
/** Countdown when it comes up at the end (after "Watch credits"). */
export const UP_NEXT_END_COUNTDOWN_SECONDS = 10
/** An ED that starts earlier than this before the end isn't "the end" (a long post-credits part). */
export const UP_NEXT_MAX_OUTRO_LEAD_SECONDS = 180
/** The card never comes up in the first half (short files, bad durations). */
const MIN_PROGRESS = 0.5
/** At the end, as the player has always required. */
const END_PROGRESS = 0.97

export type UpNextStage = "early" | "end"

export function upNextStage(options: {
    currentTime: number
    duration: number
    eofReached: boolean
    /** Where the ending starts, in seconds; null without skip data. */
    outroStart?: number | null
    /** "Watch credits" was chosen: nothing until the end. */
    dismissedEarly?: boolean
}): UpNextStage | null {
    const { currentTime, duration, eofReached, outroStart, dismissedEarly } = options
    if (!(duration > 0)) return null
    const progress = currentTime / duration
    if (eofReached && progress >= END_PROGRESS) return "end"
    if (dismissedEarly || currentTime <= 0 || progress < MIN_PROGRESS) return null
    if (duration - currentTime <= UP_NEXT_LEAD_SECONDS) return "early"
    if (
        outroStart != null
        && Number.isFinite(outroStart)
        && outroStart >= duration * MIN_PROGRESS
        && duration - outroStart <= UP_NEXT_MAX_OUTRO_LEAD_SECONDS
        && currentTime >= outroStart
    ) return "early"
    return null
}

export function upNextCountdownSeconds(stage: UpNextStage): number {
    return stage === "early" ? UP_NEXT_COUNTDOWN_SECONDS : UP_NEXT_END_COUNTDOWN_SECONDS
}
