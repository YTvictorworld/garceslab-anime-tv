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
import { atom, useAtomValue, useSetAtom } from "jotai"
import * as React from "react"
import { startOutcome, type StartOutcome, startStatusLabel } from "./tv-continue-start"

export type ContinueStartResult = Exclude<StartOutcome, { kind: "wait" }>

/** What the stream being started is doing, from the server's own status events. */
export const streamStartStatusAtom = atom((get) => {
    const loadingState = get(torrentStreamLoadingStateAtom)
    return startStatusLabel({
        directMessage: get(directStreamLoadingMessageAtom),
        debridMessage: get(debridStreamStateAtom)?.message,
        torrentLabel: loadingState ? getTorrentStreamLoadingLabel(loadingState, get(torrentStreamLoadingTorrentNameAtom)) : null,
        sessionMessage: get(activeStreamSessionAtom)?.message,
    })
})

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
 * renders nothing; the card shows `streamStartStatusAtom`.
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
    const preparing = useAtomValue(torrentStreamIsPreparingAtom)
    const playerOpen = useAtomValue(playerOpenAtom)
    const error = useAtomValue(streamStartErrorAtom)
    const setError = useSetAtom(streamStartErrorAtom)
    const status = useAtomValue(streamStartStatusAtom)
    const [now, setNow] = React.useState(() => Date.now())
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

    React.useEffect(() => {
        if (pressedAtRef.current !== null || torrentStream.isLoadingEpisodeCollection) return
        const episode = torrentStream.episodes.find(item => item.episodeNumber === episodeNumber)
        if (!episode) {
            finish({ kind: "failed", message: `Episode ${episodeNumber} isn't available to stream yet` })
            return
        }
        pressedAtRef.current = Date.now()
        lastProgressAtRef.current = pressedAtRef.current
        torrentStream.handleEpisodePress(episode)
    }, [episodeNumber, finish, torrentStream.episodes, torrentStream.handleEpisodePress, torrentStream.isLoadingEpisodeCollection])

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
        })
        if (outcome.kind === "wait") return
        if (outcome.kind === "failed" && sawPreparingRef.current) clearPendingStreamState()
        finish(outcome)
    }, [clearPendingStreamState, error, finish, now, playerOpen, preparing, torrentStream.pickerOpen])

    return null
}
