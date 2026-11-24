import type { Anime_Entry } from "@/api/generated/types"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { useTorrentStreamController } from "@/components/features/torrentstream/use-torrent-stream-controller"
import {
    activeStreamSessionAtom,
    debridStreamStateAtom,
    directStreamLoadingMessageAtom,
    getTorrentStreamLoadingLabel,
    playerOpenAtom,
    streamStartErrorAtom,
    torrentStreamIsPreparingAtom,
    torrentStreamLoadingStateAtom,
    torrentStreamLoadingTorrentNameAtom,
} from "@/lib/player"
import { streamStarts } from "@/lib/player/stream-start"
import { logger } from "@/lib/utils/logger"
import { useAtomValue, useSetAtom } from "jotai"
import * as React from "react"
import { ownsPreparing, startOutcome, type StartOutcome, startStatusLabel } from "./tv-continue-start"

const log = logger("tv-stream-start")

export type ContinueStartResult = Exclude<StartOutcome, { kind: "wait" }>

/** The stream start in flight (`streamStarts`), or null. */
export function useCurrentStreamStartId() {
    return React.useSyncExternalStore(streamStarts.subscribe, streamStarts.current, streamStarts.current)
}

/**
 * What the stream being started is doing, from the server's own status
 * events, while a start is in flight; an earlier session's messages aren't shown.
 */
export function useStreamStartStatus() {
    const startId = useCurrentStreamStartId()
    const loadingState = useAtomValue(torrentStreamLoadingStateAtom)
    const torrentName = useAtomValue(torrentStreamLoadingTorrentNameAtom)
    const directMessage = useAtomValue(directStreamLoadingMessageAtom)
    const debridMessage = useAtomValue(debridStreamStateAtom)?.message
    const sessionMessage = useAtomValue(activeStreamSessionAtom)?.message
    return startStatusLabel({
        startInFlight: startId !== null,
        directMessage,
        debridMessage,
        torrentLabel: loadingState ? getTorrentStreamLoadingLabel(loadingState, torrentName) : null,
        sessionMessage,
    })
}

type Props = {
    mediaId: number
    episodeNumber: number
    onResult: (result: ContinueStartResult) => void
    /** Set to a function that cancels the start (Back on the start screen). */
    cancelRef: React.MutableRefObject<(() => void) | null>
}

/**
 * webOS: starts a torrent/debrid episode from the start screen without
 * opening the show. It loads the show and runs the show page's own stream
 * controller, pressing the episode as its episode list would, so auto-select,
 * a stream the player left, the TV's audio checks and resume all apply. It
 * renders nothing; the card shows `useStreamStartStatus()`.
 */
export function TVContinueStreamStarter(props: Props) {
    const { data: entry, isError } = useGetAnimeEntry(props.mediaId)
    const onResultRef = React.useRef(props.onResult)
    onResultRef.current = props.onResult

    React.useEffect(() => {
        if (isError) onResultRef.current({ kind: "failed", message: "Couldn't load the show from the server" })
    }, [isError])

    if (!entry?.media) return null
    return <Starter {...props} entry={entry} />
}

function Starter({ entry, ...props }: Props & { entry: Anime_Entry }) {
    const torrentStream = useTorrentStreamController({ entry })
    return <TVStreamStartWatch {...props} torrentStream={torrentStream} />
}

export type TorrentStreamController = ReturnType<typeof useTorrentStreamController>

type WatchProps = Omit<Props, "mediaId"> & {
    /** The controller that presses the episode: the start screen's own, or the show page's. */
    torrentStream: TorrentStreamController
}

/**
 * Presses `episodeNumber` once through `torrentStream` and reports how the
 * start ends (playing, the release list opened, failed, stalled). The start
 * screen's cards and the show page's episode cards both follow a start with
 * it. Renders nothing.
 */
export function TVStreamStartWatch({ torrentStream, episodeNumber, onResult, cancelRef }: WatchProps) {
    const anyPreparing = useAtomValue(torrentStreamIsPreparingAtom)
    const currentStartId = useCurrentStreamStartId()
    const playerOpen = useAtomValue(playerOpenAtom)
    const error = useAtomValue(streamStartErrorAtom)
    const setError = useSetAtom(streamStartErrorAtom)
    const status = useStreamStartStatus()
    const [now, setNow] = React.useState(() => Date.now())
    /** Starts begun after the press have larger ids; set when pressed. */
    const issuedBeforePressRef = React.useRef<number | null>(null)
    const preparing = issuedBeforePressRef.current !== null
        && ownsPreparing({ preparing: anyPreparing, currentStartId, issuedBeforePress: issuedBeforePressRef.current })
    const [blocked, setBlocked] = React.useState<string | null>(null)
    const pressedAtRef = React.useRef<number | null>(null)
    const lastProgressAtRef = React.useRef(0)
    const sawPreparingRef = React.useRef(false)
    const doneRef = React.useRef(false)
    const onResultRef = React.useRef(onResult)
    onResultRef.current = onResult

    const finish = React.useCallback((result: ContinueStartResult) => {
        if (doneRef.current) return
        doneRef.current = true
        onResultRef.current(result)
    }, [])

    // An error from an earlier start isn't this one's.
    React.useEffect(() => {
        setError(null)
    }, [setError])

    const { clearStaleStartState } = torrentStream
    React.useEffect(() => {
        if (pressedAtRef.current !== null || torrentStream.isLoadingEpisodeCollection) return
        const episode = torrentStream.episodes.find(item => item.episodeNumber === episodeNumber)
        if (!episode) {
            log.warning("Card start: the episode isn't in the stream episode list", { episodeNumber })
            finish({ kind: "failed", message: `Episode ${episodeNumber} isn't available to stream yet` })
            return
        }
        // What an earlier session left (a stuck "preparing", a lock, a status message)
        // must neither block this start nor show on its card.
        clearStaleStartState()
        issuedBeforePressRef.current = streamStarts.lastIssued()
        pressedAtRef.current = Date.now()
        lastProgressAtRef.current = pressedAtRef.current
        const result = torrentStream.handleEpisodePress(episode)
        log.info("Card start: episode pressed", { episodeNumber, result: result.kind, reason: result.kind === "blocked" ? result.reason : undefined })
        if (result.kind === "blocked") setBlocked(result.reason)
    }, [clearStaleStartState, episodeNumber, finish, torrentStream.episodes, torrentStream.handleEpisodePress, torrentStream.isLoadingEpisodeCollection])

    const { stopCurrentStream, clearPendingStreamState } = torrentStream
    React.useEffect(() => {
        cancelRef.current = () => {
            doneRef.current = true
            if (pressedAtRef.current === null) return
            // Cleared at once, not when the server answers: a "ready" arriving
            // meanwhile then finds no pending start and isn't opened.
            if (sawPreparingRef.current) stopCurrentStream()
            clearPendingStreamState()
        }
        return () => {
            cancelRef.current = null
        }
    }, [cancelRef, clearPendingStreamState, stopCurrentStream])

    if (preparing) sawPreparingRef.current = true
    React.useEffect(() => {
        lastProgressAtRef.current = Date.now()
    }, [status])

    // Time-based rules (nothing started, stalled) need a clock.
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [])

    React.useEffect(() => {
        const pressedAt = pressedAtRef.current
        if (pressedAt === null || doneRef.current) return
        const outcome = startOutcome({
            now,
            pressedAt,
            lastProgressAt: lastProgressAtRef.current,
            preparing,
            sawPreparing: sawPreparingRef.current,
            playerOpen,
            pickerOpen: torrentStream.pickerOpen,
            error,
            blocked,
        })
        if (outcome.kind === "wait") return
        if (outcome.kind === "failed") {
            log.warning("Card start failed", { episodeNumber, message: outcome.message, sawPreparing: sawPreparingRef.current })
            if (sawPreparingRef.current) clearPendingStreamState()
        }
        finish(outcome)
    }, [blocked, clearPendingStreamState, episodeNumber, error, finish, now, playerOpen, preparing, torrentStream.pickerOpen])

    return null
}
