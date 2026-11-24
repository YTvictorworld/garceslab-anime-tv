import { upNextCountdownSeconds, upNextStage } from "@/lib/player/up-next"
import React from "react"
import { AUTO_NEXT_COUNTDOWN_SECONDS, AUTO_NEXT_TRIGGER_PROGRESS_THRESHOLD, AUTO_NEXT_TRIGGER_REMAINING_SECONDS } from "../constants"

interface UseAutoNextEpisodeParams {
    sourceId: string | undefined
    canAutoAdvance: boolean
    isPiPActive: boolean
    autoNextEnabled: boolean
    paused: boolean
    currentTime: number
    duration: number
    remainingTime: number
    eofReached: boolean
    playNextEpisode: () => void
    /**
     * Garceslab Anime (TV): the Netflix-style "Up next" card, which comes up
     * while the episode still plays (see src/lib/player/up-next.ts). `outroStart`
     * is where the ending starts, when known. Without it the countdown starts
     * at the very end, as on the phone.
     */
    upNext?: { outroStart: number | null }
}

type Countdown = { remaining: number; total: number }

/**
 * Manages auto-next episode countdown logic.
 */
export function useAutoNextEpisode(params: UseAutoNextEpisodeParams) {
    const {
        sourceId, canAutoAdvance, isPiPActive, autoNextEnabled,
        paused, currentTime, duration, remainingTime, eofReached, playNextEpisode, upNext,
    } = params
    const early = !!upNext
    const outroStart = upNext?.outroStart ?? null

    const [countdown, setCountdown] = React.useState<Countdown | null>(null)
    const autoNextTriggeredRef = React.useRef<string | null>(null)
    /** `${sourceId}:early` after "Watch credits" (the card returns at the end), `${sourceId}:end` for good. */
    const autoNextDismissedRef = React.useRef<string | null>(null)

    const cancelAutoNext = () => {
        if (sourceId) autoNextDismissedRef.current = `${sourceId}:${early && !eofReached ? "early" : "end"}`
        setCountdown(null)
    }

    // reset on source change
    React.useEffect(() => {
        setCountdown(null)
        autoNextTriggeredRef.current = null
        autoNextDismissedRef.current = null
    }, [sourceId])

    // start countdown
    React.useEffect(() => {
        // mpv runs with keep-open, so it reports paused once the file ends; don't treat that as a user pause.
        if (!sourceId || !autoNextEnabled || !canAutoAdvance || (paused && !eofReached) || isPiPActive) {
            setCountdown(null)
            return
        }
        if (autoNextTriggeredRef.current === sourceId || autoNextDismissedRef.current === `${sourceId}:end`) return

        let seconds: number | null = null
        if (early) {
            const stage = upNextStage({
                currentTime,
                duration,
                eofReached,
                outroStart,
                dismissedEarly: autoNextDismissedRef.current === `${sourceId}:early`,
            })
            if (stage) seconds = upNextCountdownSeconds(stage)
        } else {
            const progressRatio = duration > 0 ? currentTime / duration : 0
            const isNearEnd = duration > 0
                && currentTime > 0
                && progressRatio >= AUTO_NEXT_TRIGGER_PROGRESS_THRESHOLD
                && remainingTime <= AUTO_NEXT_TRIGGER_REMAINING_SECONDS
            if (isNearEnd || (eofReached && progressRatio >= AUTO_NEXT_TRIGGER_PROGRESS_THRESHOLD)) seconds = AUTO_NEXT_COUNTDOWN_SECONDS
        }
        if (seconds === null) {
            setCountdown(null)
            return
        }

        const total = seconds
        // A countdown already running keeps going (also once the episode ends).
        setCountdown(current => current ?? { remaining: total, total })
    }, [canAutoAdvance, isPiPActive, autoNextEnabled, remainingTime, sourceId, duration, eofReached, paused, currentTime, early, outroStart])

    // tick down
    const remaining = countdown?.remaining ?? null
    React.useEffect(() => {
        if (!sourceId || remaining === null) return
        if (autoNextTriggeredRef.current === sourceId) return

        if (remaining <= 0) {
            autoNextTriggeredRef.current = sourceId
            setCountdown(null)
            playNextEpisode()
            return
        }

        const timeout = setTimeout(() => {
            setCountdown(current => current === null ? null : { ...current, remaining: current.remaining - 1 })
        }, 1000)

        return () => clearTimeout(timeout)
    }, [remaining, playNextEpisode, sourceId])

    const triggerAutoNext = () => {
        if (sourceId) autoNextTriggeredRef.current = sourceId
        setCountdown(null)
        playNextEpisode()
    }

    return {
        autoNextCountdown: remaining,
        /** The countdown's full length, for the card's filling button. */
        autoNextTotal: countdown?.total ?? null,
        cancelAutoNext,
        triggerAutoNext,
        autoNextTriggeredRef,
    }
}
