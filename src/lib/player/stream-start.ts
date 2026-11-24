/**
 * Which stream start is in flight. Every torrent/debrid start gets an id
 * when it begins; opening the player, a failure or a cancel ends it. A step
 * that finishes later (the TV's release check, a resume probe) only goes on
 * when its start is still the current one, and the TV's start cards only
 * trust "preparing" and status messages while a start they pressed is current.
 *
 * Kept free of React Native and jotai so it can be unit tested.
 */

export type StreamStartRegistry = {
    /** Begins a new start, which replaces any other, and returns its id. */
    begin: () => number
    /** Ends the current start (only `id`, when given). */
    end: (id?: number) => void
    /** The start in flight, or null. */
    current: () => number | null
    isCurrent: (id: number) => boolean
    /** The id of the last start begun (0 before any): starts after a press have a larger id. */
    lastIssued: () => number
    subscribe: (listener: () => void) => () => void
}

export function createStreamStartRegistry(): StreamStartRegistry {
    let current: number | null = null
    let last = 0
    const listeners = new Set<() => void>()
    const notify = () => {
        for (const listener of listeners) listener()
    }
    return {
        begin: () => {
            current = ++last
            notify()
            return current
        },
        end: (id) => {
            if (current === null || (id !== undefined && id !== current)) return
            current = null
            notify()
        },
        current: () => current,
        isCurrent: id => current === id,
        lastIssued: () => last,
        subscribe: (listener) => {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
    }
}

export const streamStarts = createStreamStartRegistry()

export type StartPreconditions = {
    /** This controller's own start for the entry is still running. */
    selectionLocked?: boolean
    /** A stream the player left is being checked (resume). */
    resuming?: boolean
    /** The TV is checking the releases auto-select would pick. */
    checkingRelease?: boolean
    hasAniDBEpisode?: boolean
    mediaId?: number
}

/** Why a stream can't start now, or null. The live connection is checked after these. */
export function startBlockReason(p: StartPreconditions): string | null {
    if (p.selectionLocked) return "Another episode is already starting"
    if (p.resuming) return "The stream the player left is being resumed"
    if (p.checkingRelease) return "Already checking the releases for a start"
    if (p.hasAniDBEpisode === false) return "This episode isn't mapped to AniDB, so it can't be streamed"
    if (p.mediaId !== undefined && !p.mediaId) return "The show isn't loaded"
    return null
}
