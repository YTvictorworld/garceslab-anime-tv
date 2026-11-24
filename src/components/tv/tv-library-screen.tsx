import type { AL_BaseAnime, Anime_Episode, Continuity_WatchHistory } from "@/api/generated/types"
import { getEpisodeMinutesRemaining, getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { type AnimeEntryPlaybackIntent, animeEntryPlaybackIntentAtom, createAnimeEntryPlaybackIntent } from "@/atoms/anime-entry.atoms"
import type { AnimeEntryView } from "@/components/features/media/anime-entry-view-switcher"
import { defaultEntryView } from "@/components/features/media/anime-entry-view-utils"
import { useServerStatus } from "@/atoms/server.atoms"
import { useDiscoverTrendingAnime } from "@/components/features/discover/discover-queries"
import {
    EPISODE_ROW_LAYOUT,
    ROW_OVERFLOW,
    TV,
    TVButton,
    TVContinueCard,
    TVHeroCarousel,
    type TVHeroItem,
    TVPageSkeleton,
    TVSectionHeader,
    TVShelf,
    tvSize,
    TVUpcomingCard,
} from "@/components/tv"
import { trendingHeroItem } from "@/components/tv/tv-hero-items"
import {
    type HomeTrendingItem,
    homeTrendingSkipIds,
    pickHomeTrending,
    pickTrendingHeroItems,
    trendingShelfIndex,
} from "@/components/tv/tv-home-feed"
import { useTVFocus } from "@/components/tv/tv-focus"
import { SCRIM_SCROLL_THRESHOLD, TVNavScrim, useScrolledPast } from "@/components/tv/tv-nav-scrim"
import type { TVMediaMeta } from "@/components/tv/tv-shelf"
import { pickUpcomingEpisodes, type UpcomingEpisode } from "@/components/tv/tv-upcoming-episodes"
import { type ContinueStartResult, streamStartStatusAtom, TVContinueStreamStarter } from "@/components/tv/tv-continue-stream-starter"
import type { TVEpisodeCardStatus } from "@/components/tv/tv-episode-card"
import { toast } from "@/lib/utils/toast"
import { getWatchHistoryResumePercent, WEB_TV_RESUME_RULE } from "@/lib/player/resume-position"
import { ContinueWatchingItem, useAnimeLibraryCollection } from "@/hooks/use-anime-library-collection"
import { getContinueWatchingSpoilerActive, getEpisodeSpoilerState, getSpoilerSafeAnimeImage } from "@/lib/anime-spoilers"
import { Ionicons } from "@/lib/icons/Ionicons"
import { cleanHtml, mediaTitle } from "@/lib/media-metadata"
import { getServerLocalEpisodeCount, parseServerLocalAnimeEntry, useIsServerConnected, useServerLocalAnimeRecords } from "@/lib/offline"
import { router, useFocusEffect, useIsFocused } from "expo-router"
import { useAtomValue, useSetAtom } from "jotai"
import * as React from "react"
import { Animated, BackHandler, FlatList, Platform, Pressable, ScrollView, Text, TVFocusGuideView, View } from "react-native"

type Shelf = {
    key: string
    title: string
    media: AL_BaseAnime[]
    badgeById?: ReadonlyMap<number, string>
    metaById?: ReadonlyMap<number, TVMediaMeta>
    hideLibraryBadge?: boolean
    hideProgress?: boolean
    showAudienceScore?: boolean
    onMediaPress?: (media: AL_BaseAnime) => void
}

const NO_TRENDING: HomeTrendingItem<AL_BaseAnime>[] = []
const NO_UPCOMING: UpcomingEpisode<AL_BaseAnime>[] = []

/**
 * webOS: continue watching plays the episode straight away instead of opening
 * the show on its episode list. The hero's "View details" and the "Currently
 * watching" row still open the show.
 */
const CONTINUE_PLAYS = Platform.OS === "web"

const FAILED_SHOWN_MS = 15_000

/**
 * The card's progress bar. webOS: shown exactly when playing the card
 * resumes (the watch history's position, from 10 s in to 90 %, see
 * WEB_TV_RESUME_RULE in resume-position.ts); elsewhere as before (5 % to 90 %).
 */
function continuePercent(history: Continuity_WatchHistory | undefined, mediaId: number, episode: Anime_Episode) {
    return CONTINUE_PLAYS
        ? getWatchHistoryResumePercent(history, { mediaId, episodeNumber: episode.episodeNumber }, WEB_TV_RESUME_RULE)
        : getEpisodePercentageComplete(history, mediaId, episode.progressNumber)
}

type StreamStart =
    | { id: number; mediaId: number; episodeNumber: number; phase: "starting" }
    | { id: number; mediaId: number; episodeNumber: number; phase: "failed"; message: string }

/** A row of episodes to continue, then the next episodes of shows the user is caught up with (webOS). */
type ContinueRowItem =
    | { kind: "continue"; item: ContinueWatchingItem }
    | { kind: "upcoming"; item: UpcomingEpisode<AL_BaseAnime> }

/**
 * The library's search button, left of the nav bar and as tall as it: it
 * opens the library search (like Discover's "Search anime" opens its search).
 * It used to be a 480 px wide text field there, which ran into the centred
 * nav bar on the TV, whose font is wider than a desktop browser's. A round
 * button leaves room to spare whatever the font. It stays put and visible
 * when the page scrolls, like the nav bar; Up reaches it from the hero, at
 * the top of the page (see moveFocus in spatial-navigation.ts).
 */
function LibrarySearchButton() {
    const focusState = useTVFocus(1.08, "library-search")
    // As tall as the nav bar's pill.
    const size = tvSize(54)
    return (
        <View
            pointerEvents="box-none"
            style={{ position: "absolute", top: TV.navTop, left: TV.gutter, zIndex: 210 }}
        >
            <Pressable
                onPress={() => router.push("/(app)/(tabs)/(library)/search" as never)}
                onFocus={focusState.focus}
                onBlur={focusState.blur}
                accessibilityRole="button"
                accessibilityLabel="Search your anime library"
            >
                {({ focused }) => (
                    <Animated.View
                        style={[
                            focusState.style,
                            {
                                width: size,
                                height: size,
                                borderRadius: size / 2,
                                borderWidth: tvSize(2),
                                borderColor: focused ? "#ffffff" : "rgba(255,255,255,0.08)",
                                backgroundColor: focused ? "#ffffff" : "rgba(10,10,12,0.92)",
                                alignItems: "center",
                                justifyContent: "center",
                            },
                        ]}
                    >
                        <Ionicons name="search" size={tvSize(26)} color={focused ? "#0a0a0a" : "rgba(255,255,255,0.75)"} />
                    </Animated.View>
                )}
            </Pressable>
        </View>
    )
}

/** Outside the component: the React Compiler skips a component containing `import()`. */
function warmEntryScreen() {
    void import("@/components/features/media/anime-entry-screen")
}

const LABELS: Record<string, string> = {
    CURRENT: "Currently watching",
    PAUSED: "Paused",
    PLANNING: "Planning",
    COMPLETED: "Completed",
    DROPPED: "Dropped",
}

export function TVLibraryScreen() {
    const serverStatus = useServerStatus()
    const isConnected = useIsServerConnected()
    const isFocused = useIsFocused()
    const setPlaybackIntent = useSetAtom(animeEntryPlaybackIntentAtom)
    const localRecords = useServerLocalAnimeRecords()
    const { data: watchHistory } = useGetContinuityWatchHistory()
    // webOS: the nav scrim fades in past the top (a CSS transition, see useScrolledPast).
    const [scrolled, onWebScroll] = useScrolledPast(SCRIM_SCROLL_THRESHOLD)
    const {
        libraryCollectionList,
        continueWatchingList,
        isLoading,
        refetch,
        hasNonLocalEpisodes,
    } = useAnimeLibraryCollection()

    // webOS: the start screen also shows what is trending on AniList, after the
    // shows to continue. Same query as Discover's (no genre), so they share one result.
    // It runs on every launch: when AniList fails, the trending slides and row are
    // just left out, without an error toast.
    const showTrending = Platform.OS === "web" && isConnected
    const trending = useDiscoverTrendingAnime(showTrending, undefined, { muteError: true })
    const hideScore = serverStatus?.settings?.anilist?.hideAudienceScore ?? false
    const trendingItems = React.useMemo(() => {
        if (!showTrending) return NO_TRENDING
        const continueIds = continueWatchingList
            .map(item => item.episode.baseAnime?.id)
            .filter((id): id is number => typeof id === "number")
        return pickHomeTrending(
            trending.data?.Page?.media as (AL_BaseAnime | null)[] | undefined,
            homeTrendingSkipIds(continueIds, libraryCollectionList),
        )
    }, [continueWatchingList, libraryCollectionList, showTrending, trending.data?.Page?.media])
    const trendingMedia = React.useMemo(() => trendingItems.map(item => item.media), [trendingItems])

    // webOS: the show page's code runs the first time it is required, which
    // made the first show opened noticeably slower than the rest on a TV.
    // Load it while the library sits idle instead.
    React.useEffect(() => {
        if (Platform.OS !== "web" || isLoading) return
        if (typeof requestIdleCallback === "function") {
            const handle = requestIdleCallback(warmEntryScreen, { timeout: 5000 })
            return () => cancelIdleCallback(handle)
        }
        const timer = setTimeout(warmEntryScreen, 2000)
        return () => clearTimeout(timer)
    }, [isLoading])

    useFocusEffect(React.useCallback(() => {
        if (isConnected) refetch()
    }, [isConnected, refetch]))

    const shelves = React.useMemo<Shelf[]>(() => {
        const items: Shelf[] = []

        for (const list of libraryCollectionList) {
            const media = list?.entries?.map(entry => entry.media).filter(Boolean) as AL_BaseAnime[] ?? []
            if (!list?.type || media.length === 0) continue
            items.push({
                key: list.type,
                title: LABELS[list.type] ?? list.type,
                media,
                hideLibraryBadge: list.type !== "CURRENT" || !hasNonLocalEpisodes,
            })
        }

        const localMedia: AL_BaseAnime[] = []
        const localBadges = new Map<number, string>()
        const localMeta = new Map<number, TVMediaMeta>()
        for (const record of localRecords) {
            const entry = parseServerLocalAnimeEntry(record)
            if (!entry?.media) continue
            localMedia.push(entry.media)
            localBadges.set(record.mediaId, `Server · ${getServerLocalEpisodeCount(record)}`)
            localMeta.set(record.mediaId, {
                listData: entry.listData,
                libraryData: entry.libraryData,
                nakamaLibraryData: entry.nakamaLibraryData,
            })
        }
        if (localMedia.length > 0) {
            items.push({
                key: "server-local",
                title: "On the server",
                media: localMedia,
                badgeById: localBadges,
                metaById: localMeta,
                hideLibraryBadge: true,
                onMediaPress: media => router.push({
                    pathname: "/(app)/entry/anime/[id]",
                    params: { id: String(media.id), initialView: "server-local" },
                }),
            })
        }

        if (trendingMedia.length > 0) {
            items.splice(trendingShelfIndex(items.map(shelf => shelf.key)), 0, {
                key: "trending",
                title: "Trending now",
                media: trendingMedia,
                showAudienceScore: true,
            })
        }

        return items
    }, [hasNonLocalEpisodes, libraryCollectionList, localRecords, trendingMedia])

    const openMedia = React.useCallback((id: number) => {
        router.push(`/(app)/entry/anime/${id}`)
    }, [])

    /**
     * webOS: a torrent/debrid episode starts right here (TVContinueStreamStarter)
     * and its card shows how it goes; the player opens on top of this screen,
     * so Back from it comes here. One start at a time; Back cancels it.
     */
    const [streamStart, setStreamStart] = React.useState<StreamStart | null>(null)
    const streamStartRef = React.useRef(streamStart)
    streamStartRef.current = streamStart
    const cancelStartRef = React.useRef<(() => void) | null>(null)
    const startStatus = useAtomValue(streamStartStatusAtom)

    /** The show's page, with the episode started there as if pressed (or nothing started). */
    const openEntry = React.useCallback((mediaId: number, view: AnimeEntryView, intent?: AnimeEntryPlaybackIntent["kind"], episodeNumber?: number) => {
        if (intent && episodeNumber !== undefined) {
            setPlaybackIntent(createAnimeEntryPlaybackIntent({ kind: intent, mediaId, episodeNumber }))
        }
        router.push({
            pathname: "/(app)/entry/anime/[id]",
            params: {
                id: String(mediaId),
                initialView: view,
            },
        })
    }, [setPlaybackIntent])

    /** Plays the episode: here for streams on webOS, otherwise through the show's page. */
    const playEpisode = React.useCallback((mediaId: number, episodeNumber: number, view: AnimeEntryView, hasLocalFile: boolean) => {
        if (CONTINUE_PLAYS && view === "torrentstream") {
            const current = streamStartRef.current
            if (current?.phase === "starting") {
                if (current.mediaId !== mediaId) toast.info("An episode is starting. Press Back to cancel it first.")
                return
            }
            // Pressed again after it failed: the show's page, to pick the episode or release by hand.
            if (current?.phase === "failed" && current.mediaId === mediaId) {
                setStreamStart(null)
                openEntry(mediaId, view)
                return
            }
            setStreamStart({ id: Date.now(), mediaId, episodeNumber, phase: "starting" })
            return
        }
        if (view === "library" && hasLocalFile) {
            openEntry(mediaId, view, "play-local-episode", episodeNumber)
        } else if (CONTINUE_PLAYS && view === "onlinestream") {
            openEntry(mediaId, view, "onlinestream-play", episodeNumber)
        } else {
            openEntry(mediaId, view)
        }
    }, [openEntry])

    const onStartResult = React.useCallback((result: ContinueStartResult) => {
        const current = streamStartRef.current
        if (!current || current.phase !== "starting") return
        if (result.kind === "failed") {
            setStreamStart({ ...current, phase: "failed", message: result.message })
            return
        }
        setStreamStart(null)
        // Auto-select is off: the show's page presses the episode again and lists the releases.
        if (result.kind === "needs-page") openEntry(current.mediaId, "torrentstream", "stream-episode-press", current.episodeNumber)
    }, [openEntry])

    // Back cancels a start; a failure message goes away after a while.
    React.useEffect(() => {
        if (streamStart?.phase === "failed") {
            const timer = setTimeout(() => setStreamStart(current => current?.id === streamStart.id ? null : current), FAILED_SHOWN_MS)
            return () => clearTimeout(timer)
        }
        if (streamStart?.phase !== "starting" || !isFocused) return
        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            cancelStartRef.current?.()
            setStreamStart(null)
            return true
        })
        return () => subscription.remove()
    }, [isFocused, streamStart])

    const startCardStatus = React.useMemo<{ mediaId: number; status: TVEpisodeCardStatus } | null>(() => {
        if (!streamStart) return null
        return {
            mediaId: streamStart.mediaId,
            status: streamStart.phase === "failed"
                ? { message: streamStart.message, hint: "OK: choose the episode or release", error: true }
                : { message: startStatus, hint: "Back to cancel" },
        }
    }, [startStatus, streamStart])

    // A string, so the handlers below don't change on every server status refetch.
    const streamView = defaultEntryView(serverStatus, false)

    const openContinue = React.useCallback((item: ContinueWatchingItem) => {
        const episode = item.episode
        const mediaId = episode.baseAnime?.id
        if (!mediaId) return
        const hasLocalFile = !!episode.localFile?.path
        // An episode to continue without a file to play is streamed the way the server prefers.
        const view = CONTINUE_PLAYS && item.sourceView === "library" && !hasLocalFile
            ? streamView
            : item.sourceView
        playEpisode(mediaId, episode.episodeNumber, view, hasLocalFile)
    }, [playEpisode, streamView])

    // webOS: shows caught up with what has aired get a card for their next episode.
    const upcoming = React.useMemo(() => {
        if (!CONTINUE_PLAYS || !isConnected) return NO_UPCOMING
        const continueIds = new Set(continueWatchingList
            .map(item => item.episode.baseAnime?.id)
            .filter((id): id is number => typeof id === "number"))
        const items = pickUpcomingEpisodes(libraryCollectionList, continueIds, {
            allowAdult: !!serverStatus?.settings?.anilist?.enableAdultContent,
        })
        return items.length > 0 ? items : NO_UPCOMING
    }, [continueWatchingList, isConnected, libraryCollectionList, serverStatus?.settings?.anilist?.enableAdultContent])

    const continueRow = React.useMemo<ContinueRowItem[]>(() => [
        ...continueWatchingList.map(item => ({ kind: "continue" as const, item })),
        ...upcoming.map(item => ({ kind: "upcoming" as const, item })),
    ], [continueWatchingList, upcoming])

    const pressUpcoming = React.useCallback((item: UpcomingEpisode<AL_BaseAnime>, aired: boolean) => {
        // Not out yet: the show's page, where the next episode isn't listed yet either.
        if (!aired) {
            if (streamStartRef.current?.phase === "starting") {
                toast.info("An episode is starting. Press Back to cancel it first.")
                return
            }
            router.push(`/(app)/entry/anime/${item.media.id}`)
            return
        }
        playEpisode(item.media.id, item.episodeNumber, streamView, false)
    }, [playEpisode, streamView])

    const heroItems = React.useMemo<TVHeroItem[]>(() => {
        const spoilerActive = getContinueWatchingSpoilerActive(serverStatus)

        const continueItems = continueWatchingList
            .filter(item => !!item.episode.baseAnime)
            .slice(0, 12)
            .map(item => {
                const episode = item.episode
                const media = episode.baseAnime!
                const spoiler = getEpisodeSpoilerState(serverStatus, {
                    episodeNumber: episode.progressNumber || episode.episodeNumber,
                    spoilerActive,
                })
                const progressPercent = continuePercent(watchHistory, media.id, episode)
                const minutesLeft = getEpisodeMinutesRemaining(watchHistory, media.id, episode.progressNumber)
                return {
                    key: `${media.id}-${episode.progressNumber}`,
                    image: spoiler.hideThumbnail
                        ? getSpoilerSafeAnimeImage(media)
                        : media.bannerImage
                        ?? episode.episodeMetadata?.image
                        ?? media.coverImage?.extraLarge
                        ?? media.coverImage?.large,
                    kicker: "Continue watching",
                    title: mediaTitle(media),
                    subtitle: `${episode.displayTitle}${!spoiler.hideTitle && episode.episodeTitle ? `  ·  ${episode.episodeTitle}` : ""}`,
                    meta: [
                        media.seasonYear,
                        media.format?.replaceAll("_", " "),
                        media.genres?.slice(0, 3).join("  ·  "),
                    ].filter(Boolean).join("  ·  "),
                    description: cleanHtml(media.description),
                    score: media.meanScore,
                    progressPercent,
                    // The hero falls back to a percentage without it.
                    progressLabel: progressPercent > 0 && minutesLeft > 0 ? `${minutesLeft}m left` : undefined,
                    episodeTag: episode.type === "main" ? { mediaId: media.id, episodeNumber: episode.episodeNumber } : undefined,
                    actionLabel: startCardStatus?.mediaId === media.id
                        ? `${startCardStatus.status.message}  ·  ${startCardStatus.status.hint}`
                        : progressPercent > 0 ? `Resume ${episode.displayTitle}` : `Play ${episode.displayTitle}`,
                    onAction: () => openContinue(item),
                    secondaryLabel: "View details",
                    onSecondary: () => openMedia(media.id),
                }
            })

        // Trending fills the hero after the shows to continue (none off webOS).
        const trendingSlides = pickTrendingHeroItems(trendingItems, continueItems.length)
            .map(item => trendingHeroItem(item.media, {
                hideScore,
                subtitle: `#${item.rank} trending on AniList`,
            }))

        return trendingSlides.length > 0 ? [...continueItems, ...trendingSlides] : continueItems
    }, [continueWatchingList, hideScore, openContinue, openMedia, serverStatus, startCardStatus, trendingItems, watchHistory])
    const heroLoading = isLoading || (showTrending && continueWatchingList.length === 0 && trending.isLoading)

    const renderContinue = React.useCallback(({ item: row, index }: { item: ContinueRowItem; index: number }) => {
        const mediaId = row.kind === "upcoming" ? row.item.media.id : row.item.episode.baseAnime?.id
        const status = startCardStatus && startCardStatus.mediaId === mediaId ? startCardStatus.status : undefined
        if (row.kind === "upcoming") {
            // The server lists the episode to continue once its AniList data shows it aired.
            return <TVUpcomingCard item={row.item} preferred={index === 0} onPressItem={pressUpcoming} onAired={refetch} status={status} />
        }
        const item = row.item
        return (
            <TVContinueCard
                item={item}
                preferred={index === 0}
                progressPercent={item.episode.baseAnime?.id
                    ? continuePercent(watchHistory, item.episode.baseAnime.id, item.episode)
                    : 0}
                onPressItem={openContinue}
                status={status}
            />
        )
    }, [openContinue, pressUpcoming, refetch, startCardStatus, watchHistory])

    if (isLoading && isConnected) {
        return <TVPageSkeleton hero />
    }

    if (!shelves.length && !continueRow.length) {
        // webOS: trending is still loading and will fill the screen.
        if (showTrending && trending.isLoading) {
            return <TVPageSkeleton hero />
        }

        return (
            <ScrollView style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
                <View
                    style={{
                        flex: 1,
                        minHeight: tvSize(360),
                        alignItems: "center",
                        justifyContent: "center",
                        gap: tvSize(8),
                        paddingHorizontal: TV.gutter,
                        paddingTop: tvSize(100),
                    }}
                >
                    <Text className="font-bold text-white" style={{ fontSize: tvSize(30) }}>
                        {isConnected ? "Your anime library is empty" : "Server is offline"}
                    </Text>
                    <Text className="text-white/45" style={{ fontSize: tvSize(20) }}>
                        {isConnected ? "Use Discover to find something to watch." : "Reconnect to load your library."}
                    </Text>
                    <View style={{ marginTop: tvSize(20) }}>
                        <TVButton
                            label={isConnected ? "Open Discover" : "Open Settings"}
                            variant="primary"
                            hasTVPreferredFocus
                            onPress={() => router.navigate((isConnected ? "/(app)/(tabs)/discover" : "/(app)/(tabs)/(profile)") as never)}
                        />
                    </View>
                </View>
            </ScrollView>
        )
    }

    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            {isConnected ? <LibrarySearchButton /> : null}

            <ScrollView
                style={{ flex: 1 }}
                fadingEdgeLength={{ start: TV.navInset + tvSize(18), end: 0 }}
                contentContainerStyle={{
                    paddingBottom: tvSize(90),
                    gap: TV.sectionGap,
                }}
                showsVerticalScrollIndicator={false}
                onScroll={Platform.OS === "web" ? onWebScroll : undefined}
                scrollEventThrottle={16}
            >
                <View style={{ gap: tvSize(34), paddingBottom: tvSize(8) }}>
                    <View
                        style={{
                            minHeight: heroItems.length > 0 || heroLoading ? tvSize(560) : tvSize(32),
                        }}
                    >
                        <TVHeroCarousel items={heroItems} active={isFocused} preferred loading={heroLoading} />
                    </View>

                    {continueRow.length > 0 ? (
                        <View style={{ gap: tvSize(12) }}>
                            <TVSectionHeader
                                title="Continue watching"
                                count={continueRow.length}
                            />
                            <TVFocusGuideView trapFocusLeft trapFocusRight>
                                <FlatList
                                    horizontal
                                    data={continueRow}
                                    extraData={startCardStatus}
                                    renderItem={renderContinue}
                                    getItemLayout={EPISODE_ROW_LAYOUT}
                                    keyExtractor={(row, index) => {
                                        if (row.kind === "upcoming") return `upcoming-${row.item.media.id}-${row.item.episodeNumber}`
                                        const item = row.item
                                        return item.episode.localFile?.path || `${item.episode.baseAnime?.id ?? "episode"}-${item.episode.type}-${item.episode.episodeNumber}-${index}`
                                    }}
                                    snapToAlignment="item"
                                    snapToItemPadding={TV.gutter}
                                    style={[{ flexGrow: 0 }, ROW_OVERFLOW]}
                                    contentContainerStyle={{
                                        paddingHorizontal: TV.gutter,
                                        paddingTop: tvSize(10),
                                        paddingBottom: tvSize(14),
                                        gap: TV.cardGap,
                                    }}
                                    showsHorizontalScrollIndicator={false}
                                    removeClippedSubviews={false}
                                    initialNumToRender={6}
                                    maxToRenderPerBatch={6}
                                    windowSize={5}
                                />
                            </TVFocusGuideView>
                        </View>
                    ) : null}
                </View>

                {shelves.map((shelf, index) => (
                    <TVShelf
                        key={shelf.key}
                        title={shelf.title}
                        media={shelf.media}
                        badgeById={shelf.badgeById}
                        metaById={shelf.metaById}
                        hideLibraryBadge={shelf.hideLibraryBadge}
                        hideProgress={shelf.hideProgress}
                        showAudienceScore={shelf.showAudienceScore}
                        onMediaPress={shelf.onMediaPress}
                        first={heroItems.length === 0 && index === 0}
                    />
                ))}
            </ScrollView>
            <TVNavScrim shown={scrolled} />
            {streamStart?.phase === "starting" ? (
                <TVContinueStreamStarter
                    key={streamStart.id}
                    mediaId={streamStart.mediaId}
                    episodeNumber={streamStart.episodeNumber}
                    onResult={onStartResult}
                    cancelRef={cancelStartRef}
                />
            ) : null}
        </View>
    )
}
