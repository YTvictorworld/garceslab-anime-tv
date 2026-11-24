/**
 * webOS start screen: a "Continue watching" card starts its episode's stream
 * in place, and the card shows how the start is going. These rules decide
 * when the start is over. Kept free of React Native so they can be unit tested.
 */

/** Nothing started after this long (no live connection, a resume check that never answered). */
export const NOTHING_STARTED_MS = 12_000
/** No new status from the server for this long while preparing. */
export const STALLED_MS = 120_000

export type StartSignals = {
    now: number
    /** When the episode was pressed for the card. */
    pressedAt: number
    /** When the status last changed (the pressed time at first). */
    lastProgressAt: number
    /**
     * The server prepares the stream this press started: `torrentStreamIsPreparingAtom`
     * while a start begun after the press is in flight (see `ownsPreparing`). A
     * "preparing" an earlier session left behind doesn't count, or a start that
     * never began would look alive until the stall rule.
     */
    preparing: boolean
    /** `preparing` was true at some point since the press. */
    sawPreparing: boolean
    /** The press started nothing, and why (`handleEpisodePress` said "blocked"). */
    blocked?: string | null
    playerOpen: boolean
    /** The release list opened (auto-select is off): only the show's page can show it. */
    pickerOpen: boolean
    /** Why the start failed, when the server or the request said. */
    error: string | null
}

export type StartOutcome =
    | { kind: "wait" }
    | { kind: "playing" }
    | { kind: "needs-page" }
    | { kind: "failed"; message: string }

export function startOutcome(signals: StartSignals): StartOutcome {
    if (signals.playerOpen) return { kind: "playing" }
    if (signals.blocked) return { kind: "failed", message: signals.blocked }
    if (signals.error) return { kind: "failed", message: signals.error }
    if (signals.pickerOpen) return { kind: "needs-page" }
    if (signals.sawPreparing && !signals.preparing) return { kind: "failed", message: "The stream couldn't start" }
    if (!signals.sawPreparing && signals.now - signals.pressedAt > NOTHING_STARTED_MS) {
        return { kind: "failed", message: "The stream didn't start" }
    }
    if (signals.preparing && signals.now - signals.lastProgressAt > STALLED_MS) {
        return { kind: "failed", message: "Timed out waiting for the stream" }
    }
    return { kind: "wait" }
}

/**
 * Whether "preparing" is this press's: a start begun after the press
 * (`streamStarts` ids grow) is the one in flight.
 */
export function ownsPreparing(parts: { preparing: boolean; currentStartId: number | null; issuedBeforePress: number }) {
    return parts.preparing && parts.currentStartId !== null && parts.currentStartId > parts.issuedBeforePress
}

/**
 * The step to show: the server's own step for a direct stream first, then
 * the debrid or torrent status, then the session's.
 */
export function startStatusLabel(parts: {
    /** No start is in flight: the messages are an earlier session's, not this start's. */
    startInFlight?: boolean
    directMessage?: string | null
    debridMessage?: string | null
    torrentLabel?: string | null
    sessionMessage?: string | null
}) {
    if (parts.startInFlight === false) return "Starting stream..."
    return parts.directMessage
        || parts.debridMessage
        || parts.torrentLabel
        || parts.sessionMessage
        || "Starting stream..."
}
