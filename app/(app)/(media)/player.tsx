import { getClientIdentity } from "@/api/client/client-identity"
import { tvKeyAction } from "@/components/tv/tv-native"
import type { Anime_Episode, Onlinestream_VideoSource } from "@/api/generated/types"
import { useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import {
    useGetTorrentstreamSettings,
    useTorrentstreamDropTorrent,
    useTorrentstreamStartStream,
    useTorrentstreamStopStream,
} from "@/api/hooks/torrentstream.hooks"
import {
    animeEntryPlaybackIntentAtom,
    createAnimeEntryPlaybackIntent,
    tvReturnFocusAtom,
} from "@/atoms/anime-entry.atoms"
import { serverStatusAtom, useServerUrl } from "@/atoms/server.atoms"
import { selectedQualityAtom, selectedServerAtom } from "@/components/features/onlinestream/use-onlinestream-controller"
import {
    NEXT_EPISODE_CONFIRM_PROGRESS_THRESHOLD,
    NEXT_EPISODE_CONFIRM_REMAINING_SECONDS,
    TV_CONTROLS_HIDE_DELAY,
} from "@/components/features/player/constants"
import { clamp, formatTime, getBackPanel, getChapterAtTime, getFillZoomScale, getSourceVideoAspectRatio } from "@/components/features/player/helpers"
import { useEpisodeTags } from "@/api/hooks/episode-tags.hooks"
import { useAutoNextEpisode } from "@/components/features/player/hooks/use-auto-next-episode"
import { useControlsVisibility } from "@/components/features/player/hooks/use-controls-visibility"
import { useDoubleTapSeek } from "@/components/features/player/hooks/use-double-tap-seek"
import { useLandscapeOrientationLock } from "@/components/features/player/hooks/use-landscape-orientation-lock"
import { usePlayerGestures } from "@/components/features/player/hooks/use-player-gestures"
import { useSideAdjust } from "@/components/features/player/hooks/use-side-adjust"
import { useSkipData } from "@/components/features/player/hooks/use-skip-data"
import { useSwipeSeek } from "@/components/features/player/hooks/use-swipe-seek"
import { useTVLongSeek } from "@/components/features/player/hooks/use-tv-long-seek"
import { AutoNextCard, NextEpisodeConfirmCard } from "@/components/features/player/player-auto-next"
import { ControlsOverlay, LockModeOverlay } from "@/components/features/player/player-controls"
import { CenterTapFeedback, DoubleTapFlash, FastForwardBadge, PlayerStatsOverlay, SideAdjustHUD, SwipeSeekOverlay } from "@/components/features/player/player-overlays"
import { PlayerPanelOverlay } from "@/components/features/player/player-panel"
import { getBufferedRatio } from "@/components/features/player/progress"
import type { PlayerPanel } from "@/components/features/player/types"
import { createGestureRefs, syncGestureRef } from "@/components/features/player/types"
import { type NextStreamRequest, PlayerNextStream, PlayerNextStreamProgress } from "@/components/features/torrentstream/player-next-stream"
import { TVPlayerControls, TVPlayerDialog, TVPlayerPanel } from "@/components/tv"
import { TVUpNextCard } from "@/components/tv/tv-up-next-card"
import { TVDirectPlayDiagnostics, useDirectPlayDiagnostics } from "@/components/tv/tv-direct-play-diagnostics"
import { clearDirectRetry, DIRECT_PLAY_LOUD, directRetrySelection, lastDebridStartFor, requestDirectRetry } from "@/lib/player/direct-play-mode"
import {
    directPlayFailureAction,
    directRetriesSoFar,
    isRetryableDirectFailure,
    RELAY_NOTICE,
    VIEWER_SESSION_ENDED_EVENT,
    type ViewerSessionEnded,
    viewerSessionEndedAction,
} from "@/lib/player/direct-play-policy"
import { subscribeWsMessage } from "@/api/components/websocket-hub"
import { usePlaybackStartManualTracking } from "@/api/hooks/playback_manager.hooks"
import { getEpisodeSpoilerState, getSpoilerSafeAnimeImage } from "@/lib/anime-spoilers"
import { playPlayerExit } from "@/components/tv/tv-player-exit"
import { tvSize } from "@/components/tv/tv-scale"
import { useTVScrub } from "@/components/tv/use-tv-scrub"
import { isLocalServer } from "@/lib/downloads"
import { useIsServerConnected } from "@/lib/offline"
import {
    currentPlaybackSourceAtom,
    playerErrorAtom,
    playerLoadingMessageAtom,
    switchOnlineSource,
    useActivePlaybackSource,
    useCleanupPlaybackSession,
} from "@/lib/player"
import type { PlayerChapter } from "@/lib/player"
import { getLocalEpisodePlaybackSource } from "@/lib/player"
import { endKeptStream } from "@/lib/player/kept-direct-stream"
import { usePlayerPreferences } from "@/lib/player/player-preferences"
import { logger } from "@/lib/utils/logger"
import { episodeTagFor, type EpisodeTagKind } from "@/lib/episode-tags/episode-tags"
import { describeEpisodeSkip, nextEpisodeLine, planNextEpisode } from "@/lib/episode-tags/next-episode"
import { DEFAULT_RESUME_RULE, getWatchHistoryResumePosition, WEB_TV_RESUME_RULE } from "@/lib/player/resume-position"
import type { MobilePlaybackSource } from "@/lib/player/types"
import { useContinuitySync } from "@/lib/player/use-continuity-sync"
import { useMpvPlayer } from "@/lib/player/use-mpv-player"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/utils/toast"
import { usePointerActivity, usePointerClick } from "@/lib/webos/use-webos-runtime"
import { useKeepAwake } from "expo-keep-awake"
import { MpvPlayerView, type TechnicalInfo } from "expo-mpv-player"
import { NavigationBar } from "expo-navigation-bar"
import { useRouter } from "expo-router"
import { useAtom, useAtomValue } from "jotai/react"
import SkipForward from "lucide-react-native/icons/skip-forward"
import React from "react"
import {
    ActivityIndicator,
    BackHandler,
    Dimensions,
    Platform,
    Pressable as RNPressable,
    StatusBar,
    Text,
    TVEventControl,
    useTVEventHandler,
    useWindowDimensions,
    View,
} from "react-native"
import { Gesture, GestureDetector, GestureHandlerRootView, Pressable } from "react-native-gesture-handler"
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

///////////////////////////////////////////////////////////////////////////////

function capitalize(text: string) {
    return text.charAt(0).toUpperCase() + text.slice(1)
}

type NextEpisodePrompt = {
    title: string
    description: string
    confirmLabel: string
    /** Defaults to playing the next episode. */
    onConfirm?: () => void
    /** Garceslab Anime: the canon/filler pill of the episode it plays. */
    tag?: EpisodeTagKind
    /** TV corner card: "Next episode" / "Previous episode", the episode's name and its art. */
    kicker?: string
    episodeName?: string
    image?: string
}

const log = logger("player")
const DEFAULT_TEXT_SUBTITLE_MARGIN_Y = 34
const SEEK_SNAP_MAX_THRESHOLD = 4
const SEEK_SNAP_DURATION_RATIO = 0.02
const SEEK_SNAP_VERTICAL_DECAY = 15
/** One wheel press may arrive as a click and as OK; the second within this is the same press. */
const WHEEL_TOGGLE_DEBOUNCE_MS = 400


function isAssSubtitleCodec(codec?: string) {
    if (!codec) return false

    const normalizedCodec = codec.trim().toLowerCase()
    return normalizedCodec === "ass" || normalizedCodec === "ssa"
}

function isTorrentSource(source: MobilePlaybackSource | null | undefined) {
    return source?.id.startsWith("torrentstream-")
        || source?.nextEpisodeAction?.startsWith("torrentstream-")
}

type Handlers = Record<string, ((...args: any[]) => unknown) | undefined>

/**
 * Callbacks that keep their identity across renders and call this render's
 * handler, so a memoized child (the TV settings panel) skips the re-render
 * of every progress tick. The React Compiler doesn't optimize this screen.
 */
function useStableHandlers<T extends Handlers>(handlers: T): T {
    const latest = React.useRef(handlers)
    latest.current = handlers
    const stable = React.useRef<Partial<T>>({})
    const result: Partial<T> = {}
    for (const key of Object.keys(handlers) as Array<keyof T>) {
        if (!handlers[key]) continue
        stable.current[key] ??= ((...args: unknown[]) => latest.current[key]?.(...args)) as T[keyof T]
        result[key] = stable.current[key]
    }
    return result as T
}

/** The streams whose next episode the TV player starts itself; a manual pick needs the show page's picker. */
function streamRequestFor(action: MobilePlaybackSource["nextEpisodeAction"], mediaId: number, episodeNumber: number): NextStreamRequest | null {
    switch (action) {
        case "torrentstream-auto-select":
            return { kind: "auto-select", mode: "torrent", mediaId, episodeNumber }
        case "torrentstream-previous-batch":
            return { kind: "previous-batch", mode: "torrent", mediaId, episodeNumber }
        case "debridstream-auto-select":
            return { kind: "auto-select", mode: "debrid", mediaId, episodeNumber }
        case "debridstream-previous-batch":
            return { kind: "previous-batch", mode: "debrid", mediaId, episodeNumber }
        default:
            return null
    }
}

export default function PlayerScreen() {
    return <PlayerScreenInner />
}

function PlayerScreenInner() {
    const DEFAULT_SUBTITLE_POSITION = 100
    const IOS_SUBTITLE_CROP_ADJUSTMENT_FACTOR = 0.7

    const { back, canGoBack, replace } = useRouter()
    const rawInsets = useSafeAreaInsets()
    const insets = React.useMemo(() => {
        if (Platform.OS === "android") {
            return {
                top: 0,
                bottom: 0,
                left: rawInsets.left,
                right: rawInsets.right,
            }
        }
        return rawInsets
    }, [rawInsets])
    const { width: windowWidth, height: windowHeight } = useWindowDimensions()

    const cleanupSession = useCleanupPlaybackSession()
    const serverUrl = useServerUrl()
    const isServerConnected = useIsServerConnected()
    const { mutateAsync: stopTorrentStream } = useTorrentstreamStopStream()
    const { mutateAsync: dropTorrent } = useTorrentstreamDropTorrent()

    useKeepAwake()
    useLandscapeOrientationLock()

    React.useEffect(() => {
        if (Platform.OS === "android" && !Platform.isTV) {
            NavigationBar.setHidden(true)
        }
        return () => {
            if (Platform.OS === "android" && !Platform.isTV) {
                NavigationBar.setHidden(false)
            }
        }
    }, [])

    React.useEffect(() => {
        return () => {
            cleanupSession()
        }
    }, [cleanupSession])

    // atoms
    const source = useActivePlaybackSource()
    const [, setSource] = useAtom(currentPlaybackSourceAtom)
    const [, setPlaybackIntent] = useAtom(animeEntryPlaybackIntentAtom)
    const [, setReturnFocus] = useAtom(tvReturnFocusAtom)
    const [, setOnlineServer] = useAtom(selectedServerAtom)
    const [, setOnlineQuality] = useAtom(selectedQualityAtom)
    const [loadingMessage, setLoadingMessage] = useAtom(playerLoadingMessageAtom)
    const [error, setPlayerError] = useAtom(playerErrorAtom)
    const [nextEpisodePrompt, setNextEpisodePrompt] = React.useState<NextEpisodePrompt | null>(null)
    const [exitPromptOpen, setExitPromptOpen] = React.useState(false)
    /** Direct-play test: the failure dialog ("Retry via server"); it holds the keys like the exit prompt. */
    const [directFailureOpen, setDirectFailureOpen] = React.useState(false)
    const showExitPrompt = exitPromptOpen || directFailureOpen
    const setShowExitPrompt = React.useCallback((open: boolean) => {
        setExitPromptOpen(open)
        if (!open) setDirectFailureOpen(false)
    }, [])
    /** TV: the next stream being started from the player, which shows its loading screen meanwhile. */
    const [nextStream, setNextStream] = React.useState<NextStreamRequest & { label: string; entryView: MobilePlaybackSource["entryView"]; startedAt: number } | null>(null)
    const nextStreamCancelRef = React.useRef<(() => void) | null>(null)

    // player + prefs
    const [prefs, updatePrefs] = usePlayerPreferences()
    const player = useMpvPlayer()
    const { state } = player
    const [stats, setStats] = React.useState<TechnicalInfo | null>(null)
    const playerSeekTo = player.seekTo
    const playerSetVideoZoom = player.setVideoZoom
    const playerSetSubtitlePosition = player.setSubtitlePosition
    const playerSetSubtitleMarginY = player.setSubtitleMarginY

    const { screenWidth, screenHeight } = React.useMemo(() => {
        if (state.isPiPActive) {
            return {
                screenWidth: windowWidth,
                screenHeight: windowHeight,
            }
        }
        if (Platform.OS === "android") {
            const screen = Dimensions.get("screen")
            return {
                screenWidth: Math.max(screen.width, screen.height),
                screenHeight: Math.min(screen.width, screen.height),
            }
        }
        return {
            screenWidth: windowWidth,
            screenHeight: windowHeight,
        }
    }, [windowWidth, windowHeight, state.isPiPActive])

    const { flushContinuity } = useContinuitySync(player.source, state)

    React.useEffect(() => {
        if (!prefs.showStats || state.isPiPActive) {
            setStats(null)
            return
        }

        let stopped = false
        let timer: ReturnType<typeof setTimeout> | null = null

        const read = async () => {
            try {
                const next = await player.viewRef.current?.getTechnicalInfo()
                if (!stopped && next && Object.keys(next).length > 0) setStats(next)
            }
            catch {
                // The player can disappear while this request is crossing the bridge.
            }
            finally {
                if (!stopped) timer = setTimeout(read, 2000)
            }
        }

        setStats(null)
        void read()

        return () => {
            stopped = true
            if (timer) clearTimeout(timer)
        }
    }, [player.viewRef, prefs.showStats, source?.id, state.isPiPActive])

    const { data: watchHistory } = useGetContinuityWatchHistory()
    const resumeAppliedForRef = React.useRef<string | null>(null)

    React.useEffect(() => {
        if (!source) return
        if (resumeAppliedForRef.current === source.id) return
        if (state.status !== "ready" || state.paused) return

        let resumeTarget = source.resumePositionSec != null && source.resumePositionSec > 0
            ? source.resumePositionSec
            : null

        if (resumeTarget === null) {
            resumeTarget = getWatchHistoryResumePosition(watchHistory, source, Platform.OS === "web" ? WEB_TV_RESUME_RULE : DEFAULT_RESUME_RULE)
        }

        if (resumeTarget === null) {
            resumeAppliedForRef.current = source.id
            return
        }

        if (Math.abs(state.currentTime - resumeTarget) <= 1.5) {
            resumeAppliedForRef.current = source.id
            return
        }

        resumeAppliedForRef.current = source.id
        playerSeekTo(resumeTarget)
    }, [playerSeekTo, source, state.currentTime, state.paused, state.status, watchHistory])

    const chapters = React.useMemo<PlayerChapter[]>(() => {
        return state.chapters.length > 0
            ? state.chapters
            : (source?.mkvMetadata?.chapters ?? []).map((chapter, index) => ({
                id: chapter.uid > 0 ? chapter.uid : index,
                start: chapter.start,
                title: chapter.text,
            }))
    }, [state.chapters, source?.mkvMetadata?.chapters])

    const {
        skipData,
        showSkipIntro,
        showSkipOutro,
    } = useSkipData({
        source,
        chapters,
        duration: state.duration,
        currentTime: state.currentTime,
        status: state.status,
        autoSkipOpEd: prefs.autoSkipOpEd,
        playerSeekTo,
    })

    /** Skips the opening or ending being played; false when neither is. */
    const skipCurrentSegment = React.useCallback(() => {
        const interval = showSkipIntro ? skipData.op?.interval : showSkipOutro ? skipData.ed?.interval : undefined
        if (!interval) return false
        playerSeekTo(interval.endTime)
        toast.info(showSkipIntro ? "Skipped opening intro" : "Skipped ending outro")
        return true
    }, [playerSeekTo, showSkipIntro, showSkipOutro, skipData])

    const videoAspectRatio = getSourceVideoAspectRatio(source)
    const fillZoomScale = getFillZoomScale(screenWidth, screenHeight, videoAspectRatio)

    const naturalNextEpisode = !source?.episodes || source.episodes.length === 0
        ? null
        : source.episodes.find(e => e.episodeNumber === source.episodeNumber + 1) ?? null

    const naturalNextEpisodeNumber = naturalNextEpisode
        ? naturalNextEpisode.episodeNumber
        : !source?.media?.episodes || source.episodeNumber >= source.media.episodes
            ? null
            : source.episodeNumber + 1

    // Garceslab Anime: canon/filler tags for the current and next episode, and
    // "Skip filler and recaps" (see planNextEpisode). Without tags, or with the
    // option off, next is the natural next episode as before.
    const episodeTags = useEpisodeTags(source?.mediaId)
    const isMainEpisode = !source?.episode || source.episode.type === "main"
    const currentEpisodeTag = isMainEpisode ? episodeTagFor(episodeTags, source?.episodeNumber) : undefined
    const availableEpisodeNumbers = React.useMemo(() => source?.nextEpisodeAction === "local-file" && source.episodes
        ? new Set(source.episodes.filter(e => e.type === "main").map(e => e.episodeNumber))
        : null, [source?.episodes, source?.nextEpisodeAction])
    const nextEpisodePlan = planNextEpisode({
        current: isMainEpisode ? source?.episodeNumber : null,
        natural: naturalNextEpisodeNumber,
        tags: episodeTags,
        skipFiller: prefs.skipFillerEpisodes,
        lastEpisode: source?.media?.episodes,
        available: availableEpisodeNumbers,
    })
    const nextEpisodeSkip = nextEpisodePlan?.skip ?? null
    const nextEpisode = nextEpisodeSkip
        ? source?.episodes?.find(e => e.episodeNumber === nextEpisodePlan!.episodeNumber && e.type === "main") ?? null
        : naturalNextEpisode
    const nextEpisodeNumber = nextEpisodePlan?.episodeNumber ?? null
    const nextEpisodeTag = isMainEpisode ? episodeTagFor(episodeTags, nextEpisodeNumber) : undefined

    const previousEpisode = !source?.episodes || source.episodes.length === 0
        ? null
        : source.episodes.find(e => e.episodeNumber === source.episodeNumber - 1) ?? null

    const previousEpisodeNumber = previousEpisode
        ? previousEpisode.episodeNumber
        : !source || source.episodeNumber <= 1
            ? null
            : source.episodeNumber - 1
    const canPreloadTorrent = source?.nextEpisodeAction === "torrentstream-auto-select"
    const { data: torrentstreamSettings } = useGetTorrentstreamSettings(canPreloadTorrent)
    const { mutate: preloadTorrentStream } = useTorrentstreamStartStream({ muteError: true })
    const preloadedEpisodeRef = React.useRef<string | null>(null)

    React.useEffect(() => {
        if (!source || !nextEpisode?.aniDBEpisode || !canPreloadTorrent || !isServerConnected) return
        if (!torrentstreamSettings?.preloadNextStream || state.duration <= 0) return
        if (state.currentTime / state.duration < 0.5) return

        const key = `${source.id}:${nextEpisode.episodeNumber}`
        if (preloadedEpisodeRef.current === key) return
        preloadedEpisodeRef.current = key

        preloadTorrentStream({
            mediaId: source.mediaId,
            episodeNumber: nextEpisode.episodeNumber,
            aniDBEpisode: nextEpisode.aniDBEpisode,
            autoSelect: true,
            playbackType: "externalPlayerLink",
            clientId: getClientIdentity().clientId,
            preload: true,
        })
    }, [canPreloadTorrent, isServerConnected, nextEpisode, preloadTorrentStream, source, state.currentTime, state.duration,
        torrentstreamSettings?.preloadNextStream])

    const nextLocalPlaybackSource = React.useMemo(() => {
        if (!source || source.nextEpisodeAction !== "local-file" || !nextEpisode) return null

        const isLocal = serverUrl ? isLocalServer(serverUrl) : false
        const effectiveServerUrl = source.serverLocalServerUrl
            ?? ((isServerConnected || isLocal) ? serverUrl : null)

        return getLocalEpisodePlaybackSource({
            mediaId: source.mediaId,
            episode: nextEpisode,
            media: source.media,
            entryListData: source.entryListData,
            episodes: source.episodes,
            serverUrl: effectiveServerUrl,
            entryView: source.entryView ?? "library",
            serverLocalIdentity: source.serverLocalIdentity,
        })
    }, [isServerConnected, nextEpisode, serverUrl, source])

    const gRef = React.useRef(createGestureRefs())

    const controls = useControlsVisibility(
        gRef,
        Platform.isTV ? TV_CONTROLS_HIDE_DELAY : undefined,
    )

    // Moving or clicking the Magic Remote pointer shows the controls, as a tap does on a phone.
    usePointerActivity(() => {
        if (!state.isPiPActive) controls.showControls()
    })

    // Pressing the Magic Remote's wheel (its OK button) pauses and plays, from
    // the pointer (a click on the video) or from 5-way mode (OK with the
    // controls hidden). If one press arrives both ways, only the first counts.
    const lastWheelToggleRef = React.useRef(0)
    const toggleFromWheel = React.useCallback(() => {
        const now = Date.now()
        if (now - lastWheelToggleRef.current < WHEEL_TOGGLE_DEBOUNCE_MS) return
        lastWheelToggleRef.current = now
        player.togglePlayPause()
        controls.showControls()
    }, [controls.showControls, player.togglePlayPause])

    // settings panel
    const [panel, setPanel] = React.useState<PlayerPanel | null>(null)
    const closeSettings = React.useCallback(() => {
        setPanel(null)
        controls.scheduleHide()
    }, [controls.scheduleHide])

    const touchTVSeek = React.useCallback(() => {
        if (controls.controlsVisible) controls.scheduleHide()
    }, [controls.controlsVisible, controls.scheduleHide])

    const tvLongSeek = useTVLongSeek({
        enabled: Platform.isTV
            && !panel
            && !nextEpisodePrompt
            && !showExitPrompt
            && !state.isPiPActive,
        seek: player.seekRelative,
        touch: touchTVSeek,
    })

    // webOS scrubbing: left/right, the seek buttons and the fast-forward/rewind
    // keys move a target that is seeked once, when the presses stop (see
    // src/lib/player/scrub.ts).
    const scrub = useTVScrub({
        time: state.currentTime,
        duration: state.duration,
        step: prefs.buttonSeekSec,
        seekTo: player.seekTo,
        seekRelative: player.seekRelative,
        onActivity: touchTVSeek,
    })

    // A target picked in one episode doesn't carry over to the next.
    React.useEffect(() => {
        scrub.reset()
    }, [scrub, source?.id])

    // sync gRef every render
    syncGestureRef(gRef, {
        controlsVisible: controls.controlsVisible,
        controlsLocked: controls.controlsLocked,
        panel,
        isPiPActive: state.isPiPActive,
        paused: state.paused,
        currentTime: state.currentTime,
        duration: state.duration,
        speed: state.speed,
        prefs,
    })

    // sync controls visibility with paused state
    React.useEffect(() => {
        controls.syncWithPaused(state.paused)
    }, [state.paused, controls.syncWithPaused])

    // cleanup hide timer on unmount
    React.useEffect(() => controls.clearHideTimer, [controls.clearHideTimer])

    const doubleTap = useDoubleTapSeek()
    // const storeLevel = React.useCallback((value: number) => {
    //     updatePrefs({ playbackBrightness: value })
    // }, [updatePrefs])
    // const sideAdjust = useSideAdjust(prefs.playbackBrightness, storeLevel)
    const sideAdjust = useSideAdjust()
    const swipeSeek = useSwipeSeek()

    // seek bar
    const barWidthRef = React.useRef(300)
    const [seekBarWidth, setSeekBarWidth] = React.useState(0)
    const seekBarWidthValue = useSharedValue(0)
    const seekBarProgress = useSharedValue(0)
    const seekBarThumbScale = useSharedValue(1)
    const seekBarTrackHeight = useSharedValue(6)
    const seekBarGlowOpacity = useSharedValue(0)
    const pendingSeekingDisplayRef = React.useRef<number | null>(null)
    const seekDisplayFrameRef = React.useRef<number | null>(null)
    const [seekingDisplay, setSeekingDisplay] = React.useState<number | null>(null)
    const seekingRef = React.useRef<number | null>(null)

    const onSeekBarLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
        const width = Math.max(1, e.nativeEvent.layout.width)
        barWidthRef.current = width
        setSeekBarWidth(current => current === width ? current : width)
        seekBarWidthValue.set(width)
    }

    const scheduleSeekingDisplayUpdate = React.useCallback((value: number | null) => {
        pendingSeekingDisplayRef.current = value
        if (value === null) {
            if (seekDisplayFrameRef.current !== null) {
                cancelAnimationFrame(seekDisplayFrameRef.current)
                seekDisplayFrameRef.current = null
            }
            setSeekingDisplay(null)
            return
        }
        if (seekDisplayFrameRef.current !== null) return
        seekDisplayFrameRef.current = requestAnimationFrame(() => {
            seekDisplayFrameRef.current = null
            const nextValue = pendingSeekingDisplayRef.current ?? null
            setSeekingDisplay(current => current === nextValue ? current : nextValue)
        })
    }, [])

    // cleanup rAF
    React.useEffect(() => {
        return () => {
            if (seekDisplayFrameRef.current !== null) cancelAnimationFrame(seekDisplayFrameRef.current)
        }
    }, [])

    const getSeekTargetFromBarX = React.useCallback((x: number) => {
        const frac = clamp(x / barWidthRef.current, 0, 1)
        return frac * gRef.current.duration
    }, [])

    const getSeekSnappedTime = React.useCallback((x: number, y: number) => {
        const rawTime = getSeekTargetFromBarX(x)
        const duration = gRef.current.duration
        if (duration <= 0) return rawTime

        const snapPoints = [0]
        if (chapters && chapters.length > 0) {
            for (const c of chapters) {
                if (c.start > 0 && c.start < duration) {
                    snapPoints.push(c.start)
                }
            }
        }
        snapPoints.push(duration)

        const verticalDist = Math.abs(y - 18)
        const maxThreshold = Math.min(SEEK_SNAP_MAX_THRESHOLD, duration * SEEK_SNAP_DURATION_RATIO)
        const threshold = Math.max(0, maxThreshold - (verticalDist / SEEK_SNAP_VERTICAL_DECAY))

        if (threshold <= 0) return rawTime

        let nearest = snapPoints[0]
        let minDiff = Math.abs(rawTime - nearest)

        for (let i = 1; i < snapPoints.length; i++) {
            const diff = Math.abs(rawTime - snapPoints[i])
            if (diff < minDiff) {
                minDiff = diff
                nearest = snapPoints[i]
            }
        }

        if (minDiff <= threshold) {
            return nearest
        }
        return rawTime
    }, [chapters, getSeekTargetFromBarX])

    const seekBarGesture = React.useMemo(() => {
        const tapGesture = Gesture.Tap()
            .maxDuration(250)
            .maxDistance(10)
            .runOnJS(true)
            .onBegin(() => {
                controls.clearHideTimer()
            })
            .onEnd((e, success) => {
                if (!success) return
                player.seekTo(getSeekSnappedTime(e.x, e.y))
                controls.scheduleHide()
            })

        const panGesture = Gesture.Pan()
            .minDistance(2)
            .onBegin((e) => {
                controls.clearHideTimer()
                const target = getSeekSnappedTime(e.x, e.y)
                seekingRef.current = target
                scheduleSeekingDisplayUpdate(target)
            })
            .onUpdate((e) => {
                const target = getSeekSnappedTime(e.x, e.y)
                seekingRef.current = target
                scheduleSeekingDisplayUpdate(target)
            })
            .onEnd(() => {
                const target = seekingRef.current
                seekingRef.current = null
                if (target !== null) player.seekTo(target)
                scheduleSeekingDisplayUpdate(null)
                controls.scheduleHide()
            })
            .onFinalize(() => {
                seekingRef.current = null
                scheduleSeekingDisplayUpdate(null)
            })
            .runOnJS(true)

        return Gesture.Race(tapGesture, panGesture)
    }, [controls.clearHideTimer, controls.scheduleHide, getSeekSnappedTime, player.seekTo, scheduleSeekingDisplayUpdate])

    // zoom
    const [zoomMode, setZoomMode] = React.useState<"fit" | "fill">("fit")
    const zoomScaleRef = React.useRef(1)
    const pinchStartScaleRef = React.useRef(1)

    const syncIosSubtitleCropCompensation = React.useCallback((scale: number) => {
        if (Platform.OS !== "ios") return
        if (screenWidth <= 0 || screenHeight <= 0 || videoAspectRatio <= 0) {
            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
            return
        }

        const selectedSubtitleTrack = state.subtitleTracks.find(track => track.id === state.activeSubtitleTrackId)
            ?? state.subtitleTracks.find(track => track.selected)
        if (!selectedSubtitleTrack) {
            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
            return
        }

        const clampedScale = Math.max(1, scale)
        const containerAspectRatio = screenWidth / screenHeight
        const baseVideoHeight = containerAspectRatio > videoAspectRatio
            ? screenHeight
            : screenWidth / videoAspectRatio
        const scaledVideoHeight = baseVideoHeight * clampedScale

        if (scaledVideoHeight <= screenHeight + 0.5) {
            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
            return
        }

        const croppedBottomPercent = ((scaledVideoHeight - screenHeight) / (2 * scaledVideoHeight)) * 100
        if (!isAssSubtitleCodec(selectedSubtitleTrack.codec)) {
            const croppedBottomPixels = (scaledVideoHeight - screenHeight) / 2
            const extraMargin = Math.round((croppedBottomPixels * 720) / screenHeight)

            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y + extraMargin)
            return
        }

        // ASS subtitles are already positioned within their own script layout, so
        // keep the existing position lift and only reset any text-subtitle margin.
        playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
        const compensatedPosition = Math.round(clamp(
            DEFAULT_SUBTITLE_POSITION - (croppedBottomPercent * IOS_SUBTITLE_CROP_ADJUSTMENT_FACTOR),
            0,
            DEFAULT_SUBTITLE_POSITION,
        ))
        playerSetSubtitlePosition(compensatedPosition)
    }, [
        playerSetSubtitleMarginY,
        playerSetSubtitlePosition,
        screenHeight,
        screenWidth,
        state.activeSubtitleTrackId,
        state.subtitleTracks,
        videoAspectRatio,
    ])

    const applyVideoZoom = React.useCallback((scale: number) => {
        const clampedScale = Math.max(1, scale)
        if (Math.abs(zoomScaleRef.current - clampedScale) < 0.001) return
        zoomScaleRef.current = clampedScale
        setZoomMode(current => {
            const nextMode = clampedScale > 1.001 ? "fill" : "fit"
            return current === nextMode ? current : nextMode
        })
        playerSetVideoZoom(clampedScale)
        syncIosSubtitleCropCompensation(clampedScale)
    }, [playerSetVideoZoom, syncIosSubtitleCropCompensation])

    const applyZoomMode = React.useCallback((mode: "fit" | "fill") => {
        setZoomMode(mode)
        if (mode === "fit") {
            zoomScaleRef.current = 1
            playerSetVideoZoom(1)
            syncIosSubtitleCropCompensation(1)
        }
        controls.showControls()
    }, [controls.showControls, playerSetVideoZoom, syncIosSubtitleCropCompensation])

    React.useEffect(() => {
        setZoomMode("fit")
        zoomScaleRef.current = 1
        pinchStartScaleRef.current = 1
        playerSetVideoZoom(1)
        if (Platform.OS === "ios") {
            playerSetSubtitlePosition(DEFAULT_SUBTITLE_POSITION)
            playerSetSubtitleMarginY(DEFAULT_TEXT_SUBTITLE_MARGIN_Y)
        }
    }, [playerSetSubtitleMarginY, playerSetSubtitlePosition, playerSetVideoZoom, source?.id])

    React.useEffect(() => {
        syncIosSubtitleCropCompensation(zoomScaleRef.current)
    }, [syncIosSubtitleCropCompensation])

    // fast forward
    const [isFastForwarding, setIsFastForwarding] = React.useState(false)
    const savedSpeedRef = React.useRef(1.0)
    const controlsVisibleBeforeLongPressRef = React.useRef(true)

    // center-tap feedback
    const centerTapHideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const [centerTapFeedback, setCenterTapFeedback] = React.useState<"play" | "pause" | null>(null)

    React.useEffect(() => {
        return () => { if (centerTapHideTimerRef.current) clearTimeout(centerTapHideTimerRef.current) }
    }, [])

    React.useEffect(() => {
        if (!state.isPiPActive) return

        controls.clearHideTimer()
        controls.setControlsVisible(false)
        setPanel(null)
        setIsFastForwarding(false)
        setCenterTapFeedback(null)
    }, [state.isPiPActive])

    // player gestures
    const { screenGesture } = usePlayerGestures({
        gRef, screenWidth, screenHeight, fillZoomScale,

        clearHideTimer: controls.clearHideTimer,
        scheduleHide: controls.scheduleHide,
        showControls: controls.showControls,
        toggleControls: controls.toggleControls,
        closeSettings,
        setControlsVisible: controls.setControlsVisible,

        seekTo: player.seekTo,
        seekRelative: player.seekRelative,
        togglePlayPause: player.togglePlayPause,
        setPlayerSpeed: player.setSpeed,

        applyVideoZoom,
        applyZoomMode,
        zoomScaleRef,
        pinchStartScaleRef,

        showDoubleTapIndicator: doubleTap.showDoubleTapIndicator,

        swipeStartTimeRef: swipeSeek.swipeStartTimeRef,
        swipeActivatedRef: swipeSeek.swipeActivatedRef,
        swipeStartXRef: swipeSeek.swipeStartXRef,
        swipeSeekingRef: swipeSeek.swipeSeekingRef,
        panGestureModeRef: swipeSeek.panGestureModeRef,
        scheduleSwipeSeekingUpdate: swipeSeek.scheduleSwipeSeekingUpdate,

        brightnessLevelRef: sideAdjust.brightnessLevelRef,
        volumeLevelRef: sideAdjust.volumeLevelRef,
        sideAdjustKindRef: sideAdjust.sideAdjustKindRef,
        sideAdjustStartYRef: sideAdjust.sideAdjustStartYRef,
        sideAdjustStartValueRef: sideAdjust.sideAdjustStartValueRef,
        sideAdjustActivatedRef: sideAdjust.sideAdjustActivatedRef,
        scheduleSideAdjustHide: sideAdjust.scheduleSideAdjustHide,
        scheduleSideAdjustUpdate: sideAdjust.scheduleSideAdjustUpdate,

        savedSpeedRef,
        controlsVisibleBeforeLongPressRef,
        setIsFastForwarding,

        setCenterTapFeedback,
        centerTapHideTimerRef,
    })

    // navigation
    const saveReturnFocus = React.useCallback((
        view = source?.entryView,
        mediaId = source?.mediaId,
    ) => {
        if (!Platform.isTV || !source || !mediaId) return
        setReturnFocus({
            mediaId,
            episodeNumber: source.episodeNumber,
            view,
        })
    }, [setReturnFocus, source])

    const stopTVTorrent = React.useCallback(() => {
        // A direct stream (webOS) keeps running when the player closes, so the
        // episode can be picked up again (kept-direct-stream.ts); it ends with
        // the player's "video-terminated". Dropping here would also drop a
        // preloaded next episode.
        if (!Platform.isTV || !isTorrentSource(source) || source?.directStreamPlaybackId) return

        void (async () => {
            try {
                await stopTorrentStream()
            } catch {
            }

            try {
                await dropTorrent()
            } catch {
            }
        })()
    }, [dropTorrent, source, stopTorrentStream])

    const handleBack = React.useCallback(() => {
        saveReturnFocus()
        // Back while the next stream starts cancels it.
        if (nextStream) {
            clearDirectRetry()
            nextStreamCancelRef.current?.()
            setReturnFocus({ mediaId: nextStream.mediaId, episodeNumber: nextStream.episodeNumber, view: nextStream.entryView })
        }
        if (Platform.OS === "web") {
            // Saved before stop() resets the player's time, which the save on unmount reads.
            flushContinuity()
            // A stream that failed has nothing to come back to.
            const failed = !!error || state.status === "error"
            if (failed && source?.directStreamPlaybackId) endKeptStream("terminate", source.directStreamPlaybackId)
        }
        player.stop()
        stopTVTorrent()
        if (canGoBack()) back()
    }, [back, canGoBack, error, flushContinuity, nextStream, player, saveReturnFocus, setReturnFocus, source?.directStreamPlaybackId, state.status,
        stopTVTorrent])

    // webOS: Back leaves at once, without asking. A torrent or debrid stream
    // keeps running on the server, so playing the episode again resumes it.
    const exitViewRef = React.useRef<React.ComponentRef<typeof View>>(null)
    const leavingRef = React.useRef(false)
    /** `endStream`: the remote's Stop key, which ends the stream instead of keeping it. */
    const leavePlayer = React.useCallback((endStream = false) => {
        if (leavingRef.current) return
        const leave = () => {
            if (endStream && source?.directStreamPlaybackId) endKeptStream("terminate", source.directStreamPlaybackId)
            handleBack()
        }
        // Nowhere to go back to: fading out would leave a blank screen.
        if (!canGoBack()) {
            leave()
            return
        }
        leavingRef.current = true
        controls.clearHideTimer()
        // A pending scrub target would seek during the fade and move the saved position.
        scrub.reset()
        // Silent at once; the page then fades out before Back.
        player.pause()
        void playPlayerExit(exitViewRef.current).then(leave)
    }, [canGoBack, controls.clearHideTimer, handleBack, player.pause, scrub, source?.directStreamPlaybackId])

    // Viewer sessions (phase 2): the server ended this device's session while it
    // plays. Stopped from Settings, or the profile moved to another device:
    // leave and say why. The slot lapsed (idle, websocket gap): take it again.
    const { mutate: reclaimViewerSlot } = usePlaybackStartManualTracking()
    const viewerSourceRef = React.useRef(source)
    viewerSourceRef.current = source
    React.useEffect(() => subscribeWsMessage((message) => {
        if (message.type !== VIEWER_SESSION_ENDED_EVENT || !message.payload) return
        const current = viewerSourceRef.current
        const playing = current && !current.serverStreamType ? { mediaId: current.mediaId, episodeNumber: current.episodeNumber } : null
        const action = viewerSessionEndedAction(message.payload as ViewerSessionEnded, playing)
        if (action.type === "leave") {
            toast.info(action.message, { visibilityTime: 5000 })
            leavePlayer()
        } else if (action.type === "reclaim" && playing) {
            reclaimViewerSlot({ ...playing, clientId: getClientIdentity().clientId })
        }
    }), [leavePlayer, reclaimViewerSlot])

    /** TV: the "Up next" card (set once useAutoNextEpisode has run, below); read by the key handlers. */
    const upNextRef = React.useRef({ visible: false, cancel: () => {} })

    // The error and loading screens replace the player and its dialogs.
    const showsBareScreen = !!error || (!!loadingMessage && !source)

    // A Magic Remote click on the video (not on a control) plays and pauses.
    usePointerClick(() => {
        // Input during the exit fade would restart playback or move the saved position.
        if (leavingRef.current) return
        if (!Platform.isTV || showsBareScreen || panel || nextEpisodePrompt || showExitPrompt) return
        if (autoNext.autoNextCountdown !== null || state.isPiPActive) return
        toggleFromWheel()
    })

    useTVEventHandler((event) => {
        if (!Platform.isTV || !event || leavingRef.current) return
        if (event.eventType === "menu") return

        if (showsBareScreen) {
            // No exit prompt to confirm there: Stop leaves like Back.
            if (event.eventType === "stop" && tvKeyAction(event) === 1) handleBack()
            return
        }

        // Remotes with separate media keys (LG's, some Android TV ones) send play and pause too.
        if (event.eventType === "playPause" || event.eventType === "play" || event.eventType === "pause") {
            if (tvKeyAction(event) === 0) return
            if (event.eventType === "play") player.play()
            else if (event.eventType === "pause") player.pause()
            else player.togglePlayPause()
            controls.showControls()
            return
        }

        if (event.eventType === "fastForward" || event.eventType === "rewind") {
            if (tvKeyAction(event) === 0) return
            const direction = event.eventType === "fastForward" ? 1 : -1
            if (Platform.OS === "web") scrub.nudge(direction)
            else player.seekRelative(direction * prefs.buttonSeekSec)
            controls.showControls()
            return
        }

        if (event.eventType === "longLeft" || event.eventType === "longRight") {
            const direction = event.eventType === "longLeft" ? -1 : 1
            if (Platform.OS === "web") {
                // Holding scrubs here while the controls are hidden, and from the
                // seek bar in TVPlayerControls; on the buttons it only moves focus.
                if (tvKeyAction(event) === 1) {
                    scrub.release()
                } else if (
                    tvKeyAction(event) === 0
                    && !controls.controlsVisible
                    && !panel
                    && !nextEpisodePrompt
                    && !showExitPrompt
                ) {
                    scrub.hold(direction)
                    controls.showControls()
                }
                return
            }
            if (tvKeyAction(event) === 0) tvLongSeek.start(direction)
            if (tvKeyAction(event) === 1) tvLongSeek.stop()
            return
        }

        if (
            tvKeyAction(event) === 1
            && !nextEpisodePrompt
            && !showExitPrompt
            && autoNext.autoNextCountdown === null
            && handleRemoteShortcut(event.eventType)
        ) return

        // The prompts and the Up next card have the focus: arrows and OK are theirs.
        if (panel || nextEpisodePrompt || showExitPrompt || upNextRef.current.visible) return

        // webOS: left/right with the controls hidden bring them up on the seek
        // bar and start scrubbing on the press itself, not on its release.
        if (
            Platform.OS === "web"
            && !controls.controlsVisible
            && (event.eventType === "left" || event.eventType === "right")
        ) {
            if (tvKeyAction(event) === 0) {
                scrub.nudge(event.eventType === "left" ? -1 : 1)
                controls.showControls()
            }
            return
        }

        if (tvKeyAction(event) === 0) return

        if (!controls.controlsVisible) {
            if (event.eventType === "left") {
                player.seekRelative(-prefs.buttonSeekSec)
                controls.showControls()
                return
            }
            if (event.eventType === "right") {
                player.seekRelative(prefs.buttonSeekSec)
                controls.showControls()
                return
            }
            // LG's OK is the Magic Remote wheel; pressing it plays and pauses.
            if (Platform.OS === "web" && (event.eventType === "select" || event.eventType === "enter")) {
                toggleFromWheel()
                return
            }
            if (
                event.eventType === "up"
                || event.eventType === "down"
                || event.eventType === "select"
                || event.eventType === "enter"
            ) {
                controls.showControls()
            }
            return
        }

        if (
            event.eventType === "left"
            || event.eventType === "right"
            || event.eventType === "up"
            || event.eventType === "down"
        ) {
            controls.scheduleHide()
        }
    })

    // tvOS only reports Menu to BackHandler while the menu key is enabled. Otherwise the native stack pops the player directly.
    React.useEffect(() => {
        if (!Platform.isTV || Platform.OS !== "ios") return
        TVEventControl.enableTVMenuKey()
        return () => TVEventControl.disableTVMenuKey()
    }, [])

    React.useEffect(() => {
        if (!Platform.isTV) return

        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            // Already on its way out.
            if (leavingRef.current) return true
            if (showsBareScreen) {
                handleBack()
                return true
            }
            if (showExitPrompt) {
                setShowExitPrompt(false)
                return true
            }
            if (panel) {
                const backPanel = getBackPanel(panel)
                if (backPanel) {
                    setPanel(backPanel)
                } else {
                    closeSettings()
                }
                return true
            }
            if (nextEpisodePrompt) {
                setNextEpisodePrompt(null)
                return true
            }
            // Back on the Up next card is its Cancel / Watch credits.
            if (upNextRef.current.visible) {
                upNextRef.current.cancel()
                return true
            }
            if (controls.controlsVisible) {
                controls.clearHideTimer()
                controls.setControlsVisible(false)
                return true
            }
            if (Platform.OS === "web") leavePlayer()
            else setShowExitPrompt(true)
            return true
        })

        return () => sub.remove()
    }, [
        closeSettings,
        controls.clearHideTimer,
        controls.controlsVisible,
        controls.setControlsVisible,
        handleBack,
        leavePlayer,
        nextEpisodePrompt,
        panel,
        showExitPrompt,
        showsBareScreen,
    ])

    const closePlayerToEntry = React.useCallback((view: MobilePlaybackSource["entryView"], mediaId: number) => {
        saveReturnFocus(view, mediaId)
        // Saved before stop() resets the player's time (see handleBack).
        if (Platform.OS === "web") flushContinuity()
        player.stop()
        if (canGoBack()) {
            back()
            return
        }
        if (!view) return
        replace({
            pathname: "/(app)/entry/anime/[id]",
            params: { id: String(mediaId), initialView: view },
        })
    }, [back, canGoBack, flushContinuity, player, replace, saveReturnFocus])

    // next episode logic
    const canPlayNext = React.useMemo(() => {
        if (!source) return false
        if (source.nextEpisodeAction === "local-file") return Boolean(nextLocalPlaybackSource)
        if (source.nextEpisodeAction === "torrentstream-auto-select"
            || source.nextEpisodeAction === "torrentstream-previous-batch"
            || source.nextEpisodeAction === "torrentstream-manual"
            || source.nextEpisodeAction === "debridstream-auto-select"
            || source.nextEpisodeAction === "debridstream-previous-batch"
            || source.nextEpisodeAction === "debridstream-manual"
            || source.nextEpisodeAction === "onlinestream-play") {
            return nextEpisodeNumber !== null
        }
        return false
    }, [nextEpisodeNumber, nextLocalPlaybackSource, source])

    const nextEpisodeLabel = nextEpisode?.displayTitle
        ?? (nextEpisodeNumber ? `Episode ${nextEpisodeNumber}` : "the next episode")
    /** With its tag and skip: "Episode 110 (skipping filler episodes 64–109) · CANON". */
    const nextEpisodeText = nextEpisodeLine(nextEpisodeLabel, nextEpisodeTag, nextEpisodeSkip, "")

    // TV "Up next" card: the episode's name and art, without spoilers when the
    // profile hides them (the episode after the one playing counts as unwatched).
    const serverStatus = useAtomValue(serverStatusAtom)
    const episodeCardInfo = (episode: Anime_Episode | null, episodeNumber: number | null) => {
        const label = episode?.displayTitle ?? (episodeNumber ? `Episode ${episodeNumber}` : "Next episode")
        const spoiler = getEpisodeSpoilerState(serverStatus, {
            episodeNumber,
            watchedProgress: Math.max(source?.entryListData?.progress ?? 0, source?.episodeNumber ?? 0),
        })
        const name = !spoiler.hideTitle && episode?.episodeTitle && episode.episodeTitle !== label ? `${label} \u00b7 ${episode.episodeTitle}` : label
        const image = (spoiler.hideThumbnail ? undefined : episode?.episodeMetadata?.image) ?? getSpoilerSafeAnimeImage(source?.media)
        return { name, image }
    }
    const nextEpisodeCard = episodeCardInfo(nextEpisode, nextEpisodeNumber)

    const canPlayPrevious = Boolean(source?.nextEpisodeAction)
        && previousEpisodeNumber !== null
        && (source?.nextEpisodeAction !== "local-file" || previousEpisode !== null)

    const canAutoAdvance = canPlayNext
        && source?.nextEpisodeAction !== "torrentstream-manual"
        && source?.nextEpisodeAction !== "debridstream-manual"
    const remainingTime = Math.max(0, state.duration - state.currentTime)

    /**
     * TV: the next torrent or debrid episode starts from here. The player shows
     * its loading screen until the stream is ready and then plays it, instead
     * of going back to the show page to start it there.
     */
    const startStreamInPlayer = React.useCallback((request: NextStreamRequest, label: string, message?: string) => {
        // On the loading screen (a direct retry that got no link) there is no source; the failed one tells the view.
        const base = source ?? directSourceRef.current
        if (!base) return
        if (source) {
            if (Platform.OS === "web") flushContinuity()
            player.stop()
            controls.clearHideTimer()
        }
        setNextStream({ ...request, label, entryView: base.entryView ?? "torrentstream", startedAt: Date.now() })
        setLoadingMessage(message ?? `Starting ${label}…`)
        // The loading screen shows while there is no source; the stream's "ready" event sets the next one.
        setSource(null)
    }, [controls.clearHideTimer, flushContinuity, player, setLoadingMessage, setSource, source])

    /** Leaves the loading screen for the show page, which starts the episode itself when `withIntent`. */
    const leaveNextStreamToEntry = React.useCallback((withIntent: boolean) => {
        if (!nextStream) return
        const { kind, mode, mediaId, episodeNumber, entryView } = nextStream
        setNextStream(null)
        setLoadingMessage(null)
        setReturnFocus({ mediaId, episodeNumber, view: entryView })
        if (withIntent) {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: `${mode === "debrid" ? "debridstream" : "torrentstream"}-${kind === "retry-relay" || kind === "retry-direct" ? "auto-select" : kind}`, mediaId, episodeNumber,
            }))
        }
        if (canGoBack()) {
            back()
            return
        }
        replace({
            pathname: "/(app)/entry/anime/[id]",
            params: { id: String(mediaId), initialView: entryView },
        })
    }, [back, canGoBack, nextStream, replace, setLoadingMessage, setPlaybackIntent, setReturnFocus])

    const nextStreamNeedsEntry = React.useCallback(() => leaveNextStreamToEntry(true), [leaveNextStreamToEntry])
    /** Set below: a direct retry that couldn't even get a link goes through the server. */
    const relayAfterFailedRetryRef = React.useRef<(() => boolean) | null>(null)
    const nextStreamFailed = React.useCallback(() => {
        if (nextStream?.kind === "retry-direct") {
            clearDirectRetry()
            if (relayAfterFailedRetryRef.current?.()) return
        }
        if (nextStream) toast.error(`Couldn't start ${nextStream.label}`)
        leaveNextStreamToEntry(false)
    }, [leaveNextStreamToEntry, nextStream])

    // The next stream arrived and plays here.
    React.useEffect(() => {
        if (source && nextStream) setNextStream(null)
    }, [nextStream, source])

    // Direct play: a failure falls back to the server quietly (once per episode),
    // or opens the diagnostics dialog in the side-by-side test build.
    const directDiagnostics = useDirectPlayDiagnostics()
    const directFailure = source?.directPlay && directDiagnostics.sourceId === source.id && directDiagnostics.failureKind
        ? { text: directDiagnostics.failure ?? "", kind: directDiagnostics.failureKind, positionSec: directDiagnostics.failurePositionSec }
        : null
    const directSourceRef = React.useRef<MobilePlaybackSource | null>(null)
    if (source?.directPlay) directSourceRef.current = source
    /** Episodes ("mediaId:episode") already sent through the server after a direct-play failure. */
    const relayTriedRef = React.useRef(new Set<string>())
    /** Direct retries per episode ("mediaId:episode") and where the last one resumed. */
    const directRetriesRef = React.useRef(new Map<string, { count: number; resumedAtSec: number }>())
    const handledFailureRef = React.useRef<string | null>(null)

    const retryViaServer = React.useCallback(() => {
        const failed = directSourceRef.current
        if (!failed) return
        clearDirectRetry()
        relayTriedRef.current.add(`${failed.mediaId}:${failed.episodeNumber}`)
        setDirectFailureOpen(false)
        setPlayerError(null)
        startStreamInPlayer({
            kind: "retry-relay",
            mode: "debrid",
            mediaId: failed.mediaId,
            episodeNumber: failed.episodeNumber,
            nextEpisodeAction: failed.nextEpisodeAction,
        }, `episode ${failed.episodeNumber} via the server`)
    }, [setPlayerError, startStreamInPlayer])

    relayAfterFailedRetryRef.current = () => {
        const failed = directSourceRef.current
        if (!failed || relayTriedRef.current.has(`${failed.mediaId}:${failed.episodeNumber}`)) return false
        toast.info(RELAY_NOTICE, { visibilityTime: 4000 })
        retryViaServer()
        return true
    }

    React.useEffect(() => {
        if (!directFailure || !source || error) return
        const key = `${source.id}:${directFailure.kind}`
        if (handledFailureRef.current === key) return
        handledFailureRef.current = key
        const episodeKey = `${source.mediaId}:${source.episodeNumber}`
        const diagnostics = directDiagnostics
        const record = lastDebridStartFor(source.mediaId, source.episodeNumber)
        const cause = diagnostics.failureCause ?? "unknown"
        const retryable = isRetryableDirectFailure(directFailure.kind, cause, {
            headerRead: diagnostics.container !== null,
            videoProblems: diagnostics.video?.problems.length ?? 0,
        })
        const backoffUntil = diagnostics.network?.backoffUntil
        const action = directPlayFailureAction(directFailure.kind, {
            loud: DIRECT_PLAY_LOUD,
            relayTried: relayTriedRef.current.has(episodeKey),
            canRetry: true,
            playedSec: directFailure.positionSec,
            cause,
            retryable,
            directRetries: directRetriesSoFar(directRetriesRef.current.get(episodeKey), directFailure.positionSec),
            canRetryDirect: directRetrySelection(record) !== null,
            cdnBackoffMs: backoffUntil ? Math.max(0, backoffUntil - Date.now()) : 0,
        })
        log.info("Direct play failure handled", {
            kind: directFailure.kind,
            cause,
            retryable,
            action: action.type,
            attempt: action.type === "retry-direct" ? action.attempt : undefined,
            positionSec: Math.round(directFailure.positionSec),
        })
        switch (action.type) {
            case "dialog":
                setDirectFailureOpen(true)
                break
            case "retry-direct":
                directRetriesRef.current.set(episodeKey, { count: action.attempt, resumedAtSec: action.resumeAtSec })
                requestDirectRetry({ mediaId: source.mediaId, episodeNumber: source.episodeNumber, attempt: action.attempt, resumeAtSec: action.resumeAtSec })
                startStreamInPlayer({
                    kind: "retry-direct",
                    mode: "debrid",
                    mediaId: source.mediaId,
                    episodeNumber: source.episodeNumber,
                    delayMs: action.delayMs,
                    nextEpisodeAction: source.nextEpisodeAction,
                }, `episode ${source.episodeNumber} directly`, action.notice)
                break
            case "retry-relay":
                toast.info(action.notice, { visibilityTime: 4000 })
                retryViaServer()
                break
            case "notice":
                toast.info(action.notice, { visibilityTime: 4000 })
                break
            case "error":
                setPlayerError(action.message)
                break
        }
    }, [directDiagnostics, directFailure, error, retryViaServer, setPlayerError, source, startStreamInPlayer])

    const playEpisodeSelection = React.useCallback((episode: Anime_Episode | null, episodeNumber: number | null) => {
        if (!source) return

        if (source.nextEpisodeAction === "local-file") {
            if (!episode) return
            const isLocal = serverUrl ? isLocalServer(serverUrl) : false
            const effectiveServerUrl = source.serverLocalServerUrl
                ?? ((isServerConnected || isLocal) ? serverUrl : null)
            const newSource = getLocalEpisodePlaybackSource({
                mediaId: source.mediaId,
                episode,
                media: source.media,
                entryListData: source.entryListData,
                episodes: source.episodes,
                serverUrl: effectiveServerUrl,
                entryView: source.entryView ?? "library",
                serverLocalIdentity: source.serverLocalIdentity,
            })
            if (!newSource) {
                if (!isServerConnected) {
                    toast.info("Episode isn't downloaded on this device")
                }
                return
            }
            setSource(newSource)
            controls.scheduleHide()
            return
        }

        if (!episodeNumber) return

        const inPlayer = Platform.isTV ? streamRequestFor(source.nextEpisodeAction, source.mediaId, episodeNumber) : null
        if (inPlayer) {
            startStreamInPlayer(inPlayer, episode?.displayTitle ?? `Episode ${episodeNumber}`)
            return
        }

        if (source.nextEpisodeAction === "torrentstream-auto-select") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "torrentstream-auto-select", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "torrentstream-previous-batch") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "torrentstream-previous-batch", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "torrentstream-manual") {
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "debridstream-auto-select") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "debridstream-auto-select", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "debridstream-previous-batch") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "debridstream-previous-batch", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "debridstream-manual") {
            closePlayerToEntry(source.entryView ?? "torrentstream", source.mediaId)
            return
        }
        if (source.nextEpisodeAction === "onlinestream-play") {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({
                kind: "onlinestream-play", mediaId: source.mediaId, episodeNumber,
            }))
            closePlayerToEntry(source.entryView ?? "onlinestream", source.mediaId)
        }
    }, [closePlayerToEntry, controls.scheduleHide, isServerConnected, serverUrl, setPlaybackIntent, setSource, source, startStreamInPlayer])

    const playNextEpisode = React.useCallback(() => {
        playEpisodeSelection(nextEpisode, nextEpisodeNumber)
    }, [nextEpisode, nextEpisodeNumber, playEpisodeSelection])

    const dismissNextEpisodePrompt = React.useCallback(() => {
        setNextEpisodePrompt(null)
        if (state.paused) {
            controls.clearHideTimer()
            return
        }

        controls.scheduleHide()
    }, [controls, state.paused])

    const confirmNextEpisodePrompt = React.useCallback(() => {
        const confirm = nextEpisodePrompt?.onConfirm ?? playNextEpisode
        setNextEpisodePrompt(null)
        confirm()
    }, [nextEpisodePrompt, playNextEpisode])

    const autoNext = useAutoNextEpisode({
        sourceId: source?.id,
        canAutoAdvance,
        isPiPActive: state.isPiPActive,
        autoNextEnabled: prefs.autoNextEpisode,
        paused: state.paused,
        currentTime: state.currentTime,
        duration: state.duration,
        remainingTime,
        eofReached: state.eofReached,
        playNextEpisode,
        // TV: Netflix-style, the card comes up when the ending starts or in the
        // last seconds while the episode plays. Auto skip OP/ED jumps over the
        // ending, so then only the last seconds count.
        upNext: Platform.isTV
            ? { outroStart: prefs.autoSkipOpEd ? null : skipData.ed?.interval.startTime ?? null }
            : undefined,
    })
    const upNextVisible = autoNext.autoNextCountdown !== null && !state.isPiPActive && canAutoAdvance
    upNextRef.current = { visible: Platform.isTV && upNextVisible, cancel: autoNext.cancelAutoNext }

    const shouldConfirmEarlySkip = state.duration > 0
        && remainingTime > NEXT_EPISODE_CONFIRM_REMAINING_SECONDS
        && (state.currentTime / state.duration) < NEXT_EPISODE_CONFIRM_PROGRESS_THRESHOLD

    React.useEffect(() => {
        setNextEpisodePrompt(null)
    }, [source?.id])

    function handleManualNextEpisode() {
        if (!source || !canPlayNext) return
        autoNext.cancelAutoNext()
        controls.clearHideTimer()

        if (source.nextEpisodeAction === "torrentstream-manual" || source.nextEpisodeAction === "debridstream-manual") {
            setNextEpisodePrompt({
                title: "Choose next episode source?",
                description: `Continuing to ${nextEpisodeText} will return you to the source picker.`,
                confirmLabel: "Continue",
                tag: nextEpisodeTag,
                kicker: "Next episode",
                episodeName: nextEpisodeCard.name,
                image: nextEpisodeCard.image,
            })
            return
        }
        if (shouldConfirmEarlySkip) {
            setNextEpisodePrompt({
                title: "Play next episode?",
                description: `${formatTime(remainingTime)} is still left in this episode. Start ${nextEpisodeText} now?`,
                confirmLabel: "Play next",
                tag: nextEpisodeTag,
                kicker: "Next episode",
                episodeName: nextEpisodeCard.name,
                image: nextEpisodeCard.image,
            })
            return
        }
        playNextEpisode()
    }

    function handlePreviousEpisode() {
        if (!source || !canPlayPrevious) {
            toast.info("No previous episode")
            return
        }
        autoNext.cancelAutoNext()
        controls.clearHideTimer()

        const label = previousEpisode?.displayTitle ?? `Episode ${previousEpisodeNumber}`
        const play = () => playEpisodeSelection(previousEpisode, previousEpisodeNumber)
        const card = { kicker: "Previous episode", episodeName: label, image: episodeCardInfo(previousEpisode, previousEpisodeNumber).image }
        if (source.nextEpisodeAction === "torrentstream-manual" || source.nextEpisodeAction === "debridstream-manual") {
            setNextEpisodePrompt({
                title: "Choose previous episode source?",
                description: `Going back to ${label} will return you to the source picker.`,
                confirmLabel: "Continue",
                onConfirm: play,
                ...card,
            })
            return
        }
        if (shouldConfirmEarlySkip) {
            setNextEpisodePrompt({
                title: "Play previous episode?",
                description: `${formatTime(remainingTime)} is still left in this episode. Start ${label} now?`,
                confirmLabel: "Play previous",
                onConfirm: play,
                ...card,
            })
            return
        }
        play()
    }

    /**
     * One-press shortcuts for the remote's extra keys: colour keys, Info,
     * Stop, CH+/CH- and the number keys. LG remotes send them on webOS, and
     * Android TV remotes that have them send the same events. Returns true
     * when the key was used.
     */
    function handleRemoteShortcut(type: string): boolean {
        const togglePanel = (target: PlayerPanel) => {
            if (panel === target) {
                closeSettings()
                return
            }
            controls.clearHideTimer()
            setPanel(target)
        }

        switch (type) {
            case "red":
                togglePanel("audio-subtitles")
                return true
            case "green":
                if ((source?.episodes?.length ?? 0) > 1) togglePanel("episodes")
                else toast.info("No other episodes")
                return true
            case "blue":
                togglePanel("main")
                return true
            case "yellow":
                if (!panel && !skipCurrentSegment()) controls.showControls()
                return !panel
            case "info":
                updatePrefs({ showStats: !prefs.showStats })
                if (!panel) controls.showControls()
                return true
            case "stop":
                setPanel(null)
                controls.clearHideTimer()
                // webOS leaves at once and ends the stream (Back keeps it); elsewhere it asks first.
                if (Platform.OS === "web") leavePlayer(true)
                else setShowExitPrompt(true)
                return true
        }

        // The rest act on playback, so they wait until a panel is closed.
        if (panel) return false

        if (type === "channelUp") {
            if (canPlayNext) handleManualNextEpisode()
            else toast.info("No next episode")
            return true
        }
        if (type === "channelDown") {
            handlePreviousEpisode()
            return true
        }
        // 0 to 9 jump to that tenth of the episode (0 is the start).
        if (/^[0-9]$/.test(type)) {
            // A pending scrub target would otherwise seek away from the jump.
            scrub.reset()
            if (state.duration > 0) player.seekTo(state.duration * Number(type) / 10)
            controls.showControls()
            return true
        }
        return false
    }

    // episode list selection
    const handleEpisodeSelect = React.useCallback((episode: Anime_Episode) => {
        if (!source) return
        if (episode.episodeNumber === source.episodeNumber) {
            setPanel(null)
            return
        }

        setPanel(null)
        playEpisodeSelection(episode, episode.episodeNumber)
    }, [playEpisodeSelection, source])

    // settings callbacks
    function handleSetSpeed(speed: number) {
        player.setSpeed(speed)
        updatePrefs({ speed })
    }

    function handleVideoSource(videoSource: Onlinestream_VideoSource) {
        if (!source || videoSource.url === source.onlineSource?.url) return

        setOnlineServer(videoSource.server)
        setOnlineQuality(videoSource.quality)
        setSource(switchOnlineSource(source, videoSource, state.currentTime))
    }

    function handleSubDelayChange(delta: number) {
        const v = Math.round((state.subtitleDelay + delta) * 10) / 10
        player.setSubtitleDelay(v)
        updatePrefs({ subtitleDelay: v })
    }

    function handleSubDelayReset() {
        player.setSubtitleDelay(0)
        updatePrefs({ subtitleDelay: 0 })
    }

    function handleAudioDelayChange(delta: number) {
        const v = Math.round((state.audioDelay + delta) * 10) / 10
        player.setAudioDelay(v)
        updatePrefs({ audioDelay: v })
    }

    function handleAudioDelayReset() {
        player.setAudioDelay(0)
        updatePrefs({ audioDelay: 0 })
    }

    function handleSubFontSize(size: number) {
        player.setSubtitleFontSize(size)
        updatePrefs({ subtitleFontSize: size })
    }

    function handleStartPiP() {
        controls.clearHideTimer()
        setPanel(null)
        controls.setControlsVisible(false)
        setIsFastForwarding(false)
        setCenterTapFeedback(null)
        requestAnimationFrame(() => { requestAnimationFrame(() => { player.startPiP() }) })
    }

    // The TV settings panel (memoized) gets only what it shows and callbacks
    // that keep their identity: the position ticking under it doesn't re-render it.
    const tvPanelState = React.useMemo(() => ({
        speed: state.speed,
        audioTracks: state.audioTracks,
        subtitleTracks: state.subtitleTracks,
        subtitleDelay: state.subtitleDelay,
        audioDelay: state.audioDelay,
    }), [state.speed, state.audioTracks, state.subtitleTracks, state.subtitleDelay, state.audioDelay])
    const tvPanelHandlers = useStableHandlers({
        onClose: closeSettings,
        onSetSpeed: handleSetSpeed,
        onSubDelayChange: handleSubDelayChange,
        onSubDelayReset: handleSubDelayReset,
        onAudioDelayChange: handleAudioDelayChange,
        onAudioDelayReset: handleAudioDelayReset,
        onSetSubFontSize: handleSubFontSize,
        onToggleAssRendering: Platform.OS === "web" ? () => {
            updatePrefs({ assRendering: !prefs.assRendering })
            player.setAssRendering(!prefs.assRendering)
        } : undefined,
        onToggleAutoNext: () => updatePrefs({ autoNextEpisode: !prefs.autoNextEpisode }),
        onToggleAutoSkipOpEd: () => updatePrefs({ autoSkipOpEd: !prefs.autoSkipOpEd }),
        onPlayEpisode: handleEpisodeSelect,
        onSetVideoSource: handleVideoSource,
    })

    // display calculations
    const displayTime = swipeSeek.swipeSeeking?.currentTime ?? seekingDisplay ?? state.currentTime
    const progressRatio = state.duration > 0 ? clamp(displayTime / state.duration, 0, 1) : 0
    const bufferedRatio = getBufferedRatio(state.currentTime, state.duration, state.cacheSeconds)
    const isPiPActive = state.isPiPActive
    const isSeeking = seekingDisplay !== null || swipeSeek.swipeSeeking !== null
    const seekingChapter = isSeeking ? getChapterAtTime(chapters, displayTime) : undefined

    const chapterMarkers = (() => {
        if (!chapters || chapters.length <= 1 || state.duration <= 0 || seekBarWidth <= 0) return []
        return chapters.flatMap((chapter, index) => {
            if (!(chapter.start > 0)) return []
            const markerProgress = clamp(chapter.start / state.duration, 0, 1)
            if (!isFinite(markerProgress) || markerProgress <= 0.001 || markerProgress >= 0.999) return []
            return [{
                key: `chapter-${chapter.id}-${index}-${chapter.start}`,
                left: clamp((markerProgress * seekBarWidth) - 1, 0, Math.max(seekBarWidth - 2, 0)),
                progress: markerProgress,
            }]
        })
    })()

    // seek bar animated styles
    React.useEffect(() => {
        // The TV draws its own controls; on webOS this timing would run in JS on every tick.
        if (Platform.isTV) return
        if (state.duration <= 0) {
            seekBarProgress.set(0)
            return
        }

        seekBarProgress.set(isSeeking ? progressRatio : withTiming(progressRatio, { duration: 180 }))
    }, [isSeeking, progressRatio, seekBarProgress, state.duration])

    React.useEffect(() => {
        if (Platform.isTV) return
        seekBarThumbScale.set(withTiming(isSeeking ? 1.35 : 1, { duration: 140 }))
        seekBarTrackHeight.set(withTiming(isSeeking ? 8 : 6, { duration: 140 }))
        seekBarGlowOpacity.set(withTiming(isSeeking ? 1 : 0, { duration: 180 }))
    }, [isSeeking, seekBarGlowOpacity, seekBarThumbScale, seekBarTrackHeight])

    const seekBarTrackStyle = useAnimatedStyle(() => ({ height: seekBarTrackHeight.value }))
    const seekBarFillStyle = useAnimatedStyle(() => ({ width: seekBarWidthValue.value * seekBarProgress.value }))
    const seekBarThumbStyle = useAnimatedStyle(() => {
        const w = seekBarWidthValue.value
        const thumbLeft = clamp((w * seekBarProgress.value) - 6, 0, Math.max(w - 12, 0))
        return {
            opacity: w > 0 ? 1 : 0,
            transform: [{ translateX: thumbLeft }, { scale: seekBarThumbScale.value }],
        }
    })
    const seekBarGlowStyle = useAnimatedStyle(() => ({ opacity: seekBarGlowOpacity.value }))

    // horizontal safe-area padding for overlays
    const extendHudPastHorizontalSafeArea = Platform.OS === "ios" && zoomMode === "fill"
    const padL = extendHudPastHorizontalSafeArea ? 24 : insets.left + 16
    const padR = extendHudPastHorizontalSafeArea ? 24 : insets.right + 16

    // error screen
    if (error) {
        return (
            <View className="flex-1 bg-black items-center justify-center px-6">
                <StatusBar hidden />
                <Text className="text-red-400 text-lg font-semibold mb-2">Playback Error</Text>
                <Text className="text-white/70 text-center mb-6">{error}</Text>
                {source?.directPlay ? (
                    <RNPressable
                        onPress={retryViaServer}
                        hasTVPreferredFocus={Platform.isTV}
                        className="rounded-xl border-2 border-transparent bg-white/10 px-6 py-3 mb-3 focus:border-brand-100"
                    >
                        <Text className="text-white font-medium">Retry via server</Text>
                    </RNPressable>
                ) : null}
                <RNPressable
                    onPress={handleBack}
                    hasTVPreferredFocus={Platform.isTV && !source?.directPlay}
                    className="rounded-xl border-2 border-transparent bg-white/10 px-6 py-3 focus:border-brand-100"
                >
                    <Text className="text-white font-medium">Go Back</Text>
                </RNPressable>
            </View>
        )
    }

    // loading screen
    if (loadingMessage && !source) {
        return (
            <View className="flex-1 bg-black items-center justify-center">
                <StatusBar hidden />
                <ActivityIndicator size="large" color="#ffffff" />
                <Text
                    className="text-white/70 mt-4 text-base"
                    style={Platform.isTV ? { fontSize: tvSize(26) } : undefined}
                    accessibilityLabel={loadingMessage}
                >
                    {loadingMessage}
                </Text>
                {nextStream ? (
                    <>
                        <PlayerNextStreamProgress fontSize={Platform.isTV ? tvSize(20) : 14} />
                        <PlayerNextStream
                            key={nextStream.startedAt}
                            request={nextStream}
                            onNeedsEntry={nextStreamNeedsEntry}
                            onFailed={nextStreamFailed}
                            cancelRef={nextStreamCancelRef}
                        />
                    </>
                ) : null}
            </View>
        )
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            {/* Styled without className: the exit fade needs this view's DOM node. */}
            <View
                ref={exitViewRef}
                style={{
                    flex: 1,
                    width: "100%",
                    height: "100%",
                    backgroundColor: "black",
                }}
            >
                <StatusBar hidden />


                <View style={{ flex: 1, width: "100%", height: "100%", position: "relative", justifyContent: "center" }}>
                    <MpvPlayerView
                        ref={player.viewRef}
                        source={player.videoSource}
                        nowPlayingMetadata={player.nowPlayingMetadata}
                        {...(Platform.OS === "android" ? { videoOutput: prefs.androidVideoOutput } : {})}
                        onLoad={player.onNativeLoad}
                        onProgress={player.onNativeProgress}
                        onPlaybackStateChange={player.onNativePlaybackStateChange}
                        onPictureInPictureChange={player.onNativePictureInPictureChange}
                        onError={player.onNativeError}
                        onTracksReady={player.onNativeTracksReady}
                        style={{ width: "100%", height: "100%" }}
                    />
                </View>


                {state.status === "buffering" && !isPiPActive && (
                    <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
                        <ActivityIndicator size="large" color="#ffffff" />
                    </View>
                )}

                {prefs.showStats && !isPiPActive ? (
                    <PlayerStatsOverlay
                        info={stats}
                        top={Math.max(insets.top + 16, Platform.isTV ? 32 : 16)}
                        right={Math.max(insets.right + 16, Platform.isTV ? 32 : 16)}
                    />
                ) : null}

                {/* Direct play: what it found out, with "Playback stats" (useful for support). */}
                {source?.directPlay && prefs.showStats && !isPiPActive ? (
                    <TVDirectPlayDiagnostics top={Math.max(insets.top + 16, 32)} left={Math.max(insets.left + 16, 32)} />
                ) : null}



                {!Platform.isTV && (
                    <GestureDetector gesture={screenGesture}>
                        <Animated.View
                            collapsable={false}
                            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                        />
                    </GestureDetector>
                )}


                {!isPiPActive && (
                    Platform.isTV ? (
                        <TVPlayerControls
                            visible={
                                controls.controlsVisible
                                && !controls.controlsLocked
                                && !panel
                                && !nextEpisodePrompt
                                && !showExitPrompt
                                && autoNext.autoNextCountdown === null
                            }
                            focusWhenHidden={
                                !panel
                                && !nextEpisodePrompt
                                && !showExitPrompt
                                && autoNext.autoNextCountdown === null
                            }
                            source={source}
                            state={state}
                            chapters={chapters}
                            displayTime={displayTime}
                            progress={progressRatio}
                            buffered={bufferedRatio}
                            longSeekVisible={tvLongSeek.visible}
                            seekSec={prefs.buttonSeekSec}
                            canPlayNext={canPlayNext}
                            episodeTag={currentEpisodeTag}
                            nextEpisode={canPlayNext ? {
                                label: nextEpisodeLine(nextEpisodeLabel, undefined, nextEpisodeSkip),
                                tag: nextEpisodeTag,
                            } : undefined}
                            canShowEpisodes={(source?.episodes?.length ?? 0) > 1}
                            skipLabel={showSkipIntro ? "Skip intro" : showSkipOutro ? "Skip outro" : undefined}
                            onSkip={(showSkipIntro || showSkipOutro) ? () => {
                                skipCurrentSegment()
                            } : undefined}
                            onSeekTo={player.seekTo}
                            onTogglePlayPause={player.togglePlayPause}
                            onSeekRelative={player.seekRelative}
                            onPlayNext={handleManualNextEpisode}
                            onOpenEpisodes={() => {
                                controls.clearHideTimer()
                                setPanel("episodes")
                            }}
                            onOpenTracks={() => {
                                controls.clearHideTimer()
                                setPanel("audio-subtitles")
                            }}
                            onOpenSettings={() => {
                                controls.clearHideTimer()
                                setPanel("main")
                            }}
                            onExit={() => {
                                controls.clearHideTimer()
                                if (Platform.OS === "web") leavePlayer()
                                else setShowExitPrompt(true)
                            }}
                            onShowControls={controls.showControls}
                            onControlFocus={controls.scheduleHide}
                            onControlAction={controls.scheduleHide}
                            scrub={Platform.OS === "web" ? scrub : undefined}
                        />
                    ) : (
                        <ControlsOverlay
                            visible={controls.controlsVisible && !controls.controlsLocked}
                            source={source}
                            state={state}
                            insets={insets}
                            zoomMode={zoomMode}
                            panel={panel}
                            seekBarGesture={seekBarGesture}
                            onSeekBarLayout={onSeekBarLayout}
                            seekBarTrackStyle={seekBarTrackStyle}
                            seekBarFillStyle={seekBarFillStyle}
                            seekBarThumbStyle={seekBarThumbStyle}
                            seekBarGlowStyle={seekBarGlowStyle}
                            chapterMarkers={chapterMarkers}
                            progressRatio={progressRatio}
                            bufferedRatio={bufferedRatio}
                            displayTime={displayTime}
                            isSeeking={isSeeking}
                            seekingChapter={seekingChapter}
                            onBack={handleBack}
                            onTogglePlayPause={player.togglePlayPause}
                            scheduleHide={controls.scheduleHide}
                            clearHideTimer={controls.clearHideTimer}
                            setPanel={setPanel}
                            canPlayNext={canPlayNext}
                            onManualNextEpisode={handleManualNextEpisode}
                            chapters={chapters}
                            seekBarProgress={seekBarProgress}
                            onLockScreen={controls.lockScreen}
                            onSeekRelative={player.seekRelative}
                            buttonSeekSec={prefs.buttonSeekSec}
                        />
                    )
                )}


                {!Platform.isTV && controls.controlsVisible && controls.controlsLocked && !isPiPActive && (
                    <LockModeOverlay insets={insets} onUnlock={controls.handleUnlockScreen} />
                )}


                {upNextVisible && (
                    Platform.isTV ? (
                        <TVUpNextCard
                            kicker="Next episode"
                            title={nextEpisodeCard.name}
                            tag={nextEpisodeTag}
                            note={nextEpisodeSkip ? capitalize(describeEpisodeSkip(nextEpisodeSkip)) : undefined}
                            image={nextEpisodeCard.image}
                            confirmLabel="Next episode"
                            // Before the end the card hides until then; at the end it's gone for good.
                            cancelLabel={state.eofReached ? "Cancel" : "Watch credits"}
                            countdown={autoNext.autoNextTotal
                                ? { remaining: autoNext.autoNextCountdown!, total: autoNext.autoNextTotal }
                                : undefined}
                            onCancel={autoNext.cancelAutoNext}
                            onConfirm={autoNext.triggerAutoNext}
                        />
                    ) : (
                        <AutoNextCard
                            countdown={autoNext.autoNextCountdown!}
                            nextEpisodeLabel={nextEpisodeText}
                            controlsVisible={controls.controlsVisible}
                            controlsLocked={controls.controlsLocked}
                            padR={padR}
                            insets={insets}
                            onCancel={autoNext.cancelAutoNext}
                            onPlayNow={autoNext.triggerAutoNext}
                        />
                    )
                )}

                {nextEpisodePrompt && !isPiPActive && (
                    Platform.isTV ? (
                        <TVUpNextCard
                            kicker={nextEpisodePrompt.kicker ?? nextEpisodePrompt.title}
                            title={nextEpisodePrompt.episodeName ?? nextEpisodePrompt.title}
                            tag={nextEpisodePrompt.tag}
                            note={nextEpisodePrompt.description}
                            image={nextEpisodePrompt.image}
                            confirmLabel={nextEpisodePrompt.confirmLabel}
                            cancelLabel="Cancel"
                            onCancel={dismissNextEpisodePrompt}
                            onConfirm={confirmNextEpisodePrompt}
                        />
                    ) : (
                        <NextEpisodeConfirmCard
                            title={nextEpisodePrompt.title}
                            description={nextEpisodePrompt.description}
                            confirmLabel={nextEpisodePrompt.confirmLabel}
                            insets={insets}
                            onCancel={dismissNextEpisodePrompt}
                            onConfirm={confirmNextEpisodePrompt}
                        />
                    )
                )}

                {!Platform.isTV && !isPiPActive && !controls.controlsLocked && (showSkipIntro || showSkipOutro) && (
                    <Animated.View
                        entering={FadeIn.duration(200)}
                        exiting={FadeOut.duration(150)}
                        style={{
                            position: "absolute",
                            bottom: Math.max(80, insets.bottom + 64),
                            right: Math.max(20, insets.right + 20),
                            zIndex: 50,
                        }}
                    >
                        <Pressable
                            onPress={() => {
                                const targetTime = showSkipIntro ? skipData.op!.interval.endTime : skipData.ed!.interval.endTime
                                playerSeekTo(targetTime)
                                toast.info(showSkipIntro ? "Skipped opening intro" : "Skipped ending outro")
                            }}
                        >
                            {({ pressed }) => (
                                <View
                                    className={cn(
                                        "flex-row items-center gap-1.5 rounded-full border border-white/5 bg-black/60 px-3 py-1.5",
                                        pressed ? "opacity-75 bg-white/5" : "opacity-100",
                                    )}
                                >
                                    <Text className="text-xs font-medium text-white/90">
                                        {showSkipIntro ? "Skip Intro" : "Skip Outro"}
                                    </Text>
                                    <SkipForward size={11} color="rgba(255,255,255,0.9)" />
                                </View>
                            )}
                        </Pressable>
                    </Animated.View>
                )}

                {!Platform.isTV && isFastForwarding && !isPiPActive && (
                    <FastForwardBadge speed={prefs.longPressFastForwardSpeed} />
                )}

                {!Platform.isTV && swipeSeek.swipeSeeking && !isPiPActive && (
                    <SwipeSeekOverlay
                        swipeSeeking={swipeSeek.swipeSeeking}
                        duration={state.duration}
                        seekingChapter={seekingChapter}
                    />
                )}

                {!Platform.isTV && !isPiPActive && (
                    <DoubleTapFlash
                        side={doubleTap.doubleTapSide}
                        amount={doubleTap.doubleTapAmount}
                        screenWidth={screenWidth}
                        animatedStyle={doubleTap.doubleTapIndicatorStyle}
                    />
                )}

                {!Platform.isTV && centerTapFeedback && !isPiPActive && (
                    <CenterTapFeedback feedback={centerTapFeedback} />
                )}

                {!Platform.isTV && sideAdjust.sideAdjustFeedbackKind && !isPiPActive && (
                    <SideAdjustHUD
                        kind={sideAdjust.sideAdjustFeedbackKind}
                        progress={sideAdjust.sideAdjustProgress}
                        initialProgress={
                            sideAdjust.sideAdjustFeedbackKind === "brightness"
                                ? sideAdjust.brightnessLevelRef.current
                                : sideAdjust.volumeLevelRef.current
                        }
                        insets={insets}
                        screenHeight={screenHeight}
                        padL={padL}
                        padR={padR}
                        sideAdjustFillStyle={sideAdjust.sideAdjustFillStyle}
                    />
                )}

                {panel && !isPiPActive && (
                    Platform.isTV ? (
                        <TVPlayerPanel
                            {...tvPanelHandlers}
                            panel={panel}
                            onNavigate={setPanel}
                            state={tvPanelState}
                            prefs={prefs}
                            updatePrefs={updatePrefs}
                            onSetAudioTrack={player.setAudioTrack}
                            onSetSubtitleTrack={player.setSubtitleTrack}
                            episodes={source?.episodes}
                            currentEpisodeNumber={source?.episodeNumber}
                            videoSources={source?.onlineSources}
                            videoSource={source?.onlineSource}
                        />
                    ) : (
                        <PlayerPanelOverlay
                            panel={panel}
                            onNavigate={setPanel}
                            onClose={closeSettings}
                            insets={insets}
                            state={state}
                            prefs={prefs}
                            updatePrefs={updatePrefs}
                            onSetSpeed={handleSetSpeed}
                            onSubDelayChange={handleSubDelayChange}
                            onSubDelayReset={handleSubDelayReset}
                            onAudioDelayChange={handleAudioDelayChange}
                            onAudioDelayReset={handleAudioDelayReset}
                            onSetSubFontSize={handleSubFontSize}
                            onSetAudioTrack={player.setAudioTrack}
                            onSetSubtitleTrack={player.setSubtitleTrack}
                            onAddExternalSubtitle={player.addSubtitleFile ? (url: string) => player.addSubtitleFile(url, true) : undefined}
                            anilistId={source?.mediaId}
                            wyzieApiKey={prefs.wyzieApiKey}
                            onSaveWyzieApiKey={(value) => updatePrefs({ wyzieApiKey: value })}
                            onStartPiP={handleStartPiP}
                            onToggleAutoNext={() => updatePrefs({ autoNextEpisode: !prefs.autoNextEpisode })}
                            onToggleCenterTapPlayPause={() => updatePrefs({ centerTapPlayPause: !prefs.centerTapPlayPause })}
                            onToggleSideSwipeControls={() => updatePrefs({ sideSwipeBrightnessVolume: !prefs.sideSwipeBrightnessVolume })}
                            onToggleAutoSkipOpEd={() => updatePrefs({ autoSkipOpEd: !prefs.autoSkipOpEd })}
                            onToggleStats={() => updatePrefs({ showStats: !prefs.showStats })}
                            onLockScreen={controls.lockScreen}
                            episodes={source?.episodes}
                            currentEpisodeNumber={source?.episodeNumber}
                            onPlayEpisode={handleEpisodeSelect}
                            videoSources={source?.onlineSources}
                            videoSource={source?.onlineSource}
                            onSetVideoSource={handleVideoSource}
                        />
                    )
                )}

                {Platform.OS === "web" && (
                    <TVPlayerDialog
                        open={directFailureOpen}
                        title="Direct play failed"
                        text={`${directFailure?.text ?? ""}\n\nThe video may keep playing without what failed. Press Info for the diagnostics.`}
                        cancelLabel="Keep watching"
                        confirmLabel="Retry via server"
                        onCancel={() => {
                            setDirectFailureOpen(false)
                            controls.showControls()
                        }}
                        onConfirm={retryViaServer}
                    />
                )}

                {/* webOS leaves without asking (see leavePlayer). */}
                {Platform.isTV && Platform.OS !== "web" && (
                    <TVPlayerDialog
                        open={exitPromptOpen}
                        eyebrow="Stop playback"
                        title="Leave the player?"
                        text={`Stop playing “${source?.media?.title?.userPreferred ?? source?.media?.title?.english ?? "this episode"}”?`}
                        confirmLabel="Stop"
                        danger
                        onCancel={() => {
                            setShowExitPrompt(false)
                            controls.showControls()
                        }}
                        onConfirm={handleBack}
                    />
                )}
            </View>
        </GestureHandlerRootView>
    )
}
