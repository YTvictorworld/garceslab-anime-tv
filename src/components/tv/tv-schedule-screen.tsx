import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Anime_ScheduleItem } from "@/api/generated/types"
import { useServerQuery } from "@/api/client/requests"
import { useGetRawAnimeCollection } from "@/api/hooks/anilist.hooks"
import { TVFocusScaleView, useTVFocus } from "@/components/tv/tv-focus"
import { TVLazyImage } from "@/components/tv/tv-lazy-image"
import { TVNavScrim } from "@/components/tv/tv-nav-scrim"
import { MEDIA_ROW_LAYOUT, TV, tvSize } from "@/components/tv/tv-scale"
import { TVSectionHeader } from "@/components/tv/tv-section-header"
import { TVPageSkeleton } from "@/components/tv/tv-skeleton"
import { Ionicons } from "@/lib/icons/Ionicons"
import { useIsServerConnected } from "@/lib/offline"
import { TV_VISUAL } from "@/lib/tv/visual-flags"
import {
    formatAiringClock,
    groupScheduleByDay,
    initialScheduleFocus,
    type ScheduleDay,
    type ScheduleEntry,
    scheduleFromCollection,
} from "@/lib/tv/schedule-days"
import { LinearGradient } from "expo-linear-gradient"
import { router, useIsFocused } from "expo-router"
import * as React from "react"
import { FlatList, Pressable, ScrollView, Text, TVFocusGuideView, View } from "react-native"

/** Same zone as the upcoming cards on Home (see tv-continue-card.tsx). */
const AIRING_TIME_ZONE = process.env.EXPO_PUBLIC_TV_TIME_ZONE || undefined
const DAYS = 7
const CARD_WIDTH = tvSize(220)

type Entry = ScheduleEntry<Anime_ScheduleItem>
type FocusNode = React.ElementRef<typeof Pressable>

/** The profile's schedule (the server caches it per profile). Errors stay quiet: the screen falls back. */
function useSchedule(enabled: boolean) {
    return useServerQuery<Array<Anime_ScheduleItem>>({
        endpoint: API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.endpoint,
        method: API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.methods[0],
        queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.key],
        enabled,
        muteError: true,
        retry: 1,
    })
}

/** Redraws once a minute, so episodes turn "Aired" while the screen is open. */
function useMinuteClock(active: boolean) {
    const [now, setNow] = React.useState(() => Date.now())
    React.useEffect(() => {
        if (!active) return
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 60 * 1000)
        return () => clearInterval(timer)
    }, [active])
    return now
}

function timeZoneName() {
    if (AIRING_TIME_ZONE) return AIRING_TIME_ZONE
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null
    } catch {
        return null
    }
}

/**
 * Garceslab Anime: the TV Schedule tab. The anime on the current profile's
 * lists airing today and in the next six days, one row per day, in the TV's
 * time zone. OK opens the anime; Down from the nav bar lands on the next
 * episode to air.
 */
export function TVScheduleScreen() {
    const isFocused = useIsFocused()
    const isConnected = useIsServerConnected()
    const schedule = useSchedule(isConnected)
    const collection = useGetRawAnimeCollection()
    const now = useMinuteClock(isFocused)
    const [initialCard, setInitialCard] = React.useState<FocusNode | null>(null)
    const [preferInitial, setPreferInitial] = React.useState(true)

    const lists = collection.data?.MediaListCollection?.lists
    const progressById = React.useMemo(() => {
        const map = new Map<number, number>()
        for (const list of lists ?? []) {
            for (const entry of list.entries ?? []) {
                if (entry.media?.id && entry.progress) map.set(entry.media.id, entry.progress)
            }
        }
        return map
    }, [lists])

    // An older server without the endpoint (or a failed request): each list
    // anime's next episode from the collection the app already has.
    const usingFallback = !!schedule.error && !schedule.data
    const items = React.useMemo<Anime_ScheduleItem[]>(() => {
        if (schedule.data) return schedule.data
        if (!usingFallback) return []
        return scheduleFromCollection(lists).map(item => ({
            ...item,
            time: "",
            image: item.image ?? "",
            isMovie: !!item.isMovie,
            isSeasonFinale: !!item.isSeasonFinale,
        }))
    }, [lists, schedule.data, usingFallback])

    // Grouped against the minute clock: an episode turns "Aired" when its time passes.
    const days = React.useMemo(() => groupScheduleByDay(items, {
        now,
        days: DAYS,
        timeZone: AIRING_TIME_ZONE,
        progressOf: id => progressById.get(id),
    }), [items, now, progressById])
    const focusTarget = React.useMemo(() => initialScheduleFocus(days), [days])
    const total = days.reduce((count, day) => count + day.items.length, 0)
    const zone = React.useMemo(timeZoneName, [])

    const focusedInitial = React.useCallback(() => setPreferInitial(false), [])
    const open = React.useCallback((entry: Entry) => {
        router.push(`/(app)/entry/anime/${entry.item.mediaId}`)
    }, [])

    if (schedule.isLoading && !usingFallback && isConnected) {
        return <TVPageSkeleton />
    }

    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            <ScrollView
                style={{ flex: 1 }}
                fadingEdgeLength={{ start: TV.navInset + tvSize(18), end: 0 }}
                contentContainerStyle={{ paddingTop: TV.navInset, paddingBottom: tvSize(90) }}
                showsVerticalScrollIndicator={false}
            >
                <View style={{ paddingHorizontal: TV.gutter, paddingBottom: tvSize(18), gap: tvSize(6) }}>
                    <Text
                        className="font-black text-white"
                        style={{ fontSize: tvSize(44), lineHeight: tvSize(52), letterSpacing: tvSize(-0.5) }}
                    >
                        Schedule
                    </Text>
                    <Text className="font-medium text-white/50" style={{ fontSize: tvSize(19) }}>
                        {[
                            total === 1 ? "1 episode from your lists this week" : `${total} episodes from your lists this week`,
                            zone ? `times in ${zone.replaceAll("_", " ")}` : null,
                            usingFallback ? "next episodes only (this server has no schedule)" : null,
                        ].filter(Boolean).join("  ·  ")}
                    </Text>
                </View>

                <TVFocusGuideView
                    autoFocus={isFocused}
                    destinations={initialCard ? [initialCard] : undefined}
                    style={{ gap: tvSize(26) }}
                >
                    {days.map((day, dayIndex) => dayIndex > 0 && day.items.length === 0 ? null : (
                        // Later days with nothing airing are left out; Today always shows.
                        <TVScheduleDayRow
                            key={day.key}
                            day={day}
                            focusIndex={focusTarget?.day === dayIndex ? focusTarget.index : -1}
                            preferred={preferInitial && isFocused}
                            initialRef={setInitialCard}
                            onFocusInitial={focusedInitial}
                            onPress={open}
                        />
                    ))}
                </TVFocusGuideView>

                {total === 0 ? (
                    <View style={{ alignItems: "center", paddingTop: tvSize(40), paddingHorizontal: TV.gutter, gap: tvSize(8) }}>
                        <Text className="font-semibold text-white" style={{ fontSize: tvSize(24) }}>
                            {isConnected ? "Nothing from your lists airs this week" : "Server is offline"}
                        </Text>
                        <Text className="text-white/40" style={{ fontSize: tvSize(18) }}>
                            {isConnected
                                ? "Add airing anime to Watching or Planning to see them here."
                                : "Reconnect to load the schedule."}
                        </Text>
                    </View>
                ) : null}
            </ScrollView>
            <TVNavScrim />
        </View>
    )
}

const TVScheduleDayRow = React.memo(function TVScheduleDayRow({
    day,
    focusIndex,
    preferred,
    initialRef,
    onFocusInitial,
    onPress,
}: {
    day: ScheduleDay<Anime_ScheduleItem>
    /** The card focus starts on, in this row (-1: none). */
    focusIndex: number
    preferred: boolean
    initialRef: (node: FocusNode | null) => void
    onFocusInitial: () => void
    onPress: (entry: Entry) => void
}) {
    const renderItem = React.useCallback(({ item, index }: { item: Entry; index: number }) => (
        <TVScheduleCard
            ref={index === focusIndex ? initialRef : undefined}
            entry={item}
            preferred={preferred && index === focusIndex}
            onFocus={index === focusIndex ? onFocusInitial : undefined}
            onPressEntry={onPress}
        />
    ), [focusIndex, initialRef, onFocusInitial, onPress, preferred])

    return (
        <View style={{ gap: tvSize(8) }}>
            <TVSectionHeader
                title={day.label}
                count={day.items.length || undefined}
                after={(
                    <Text className="font-medium text-white/45" style={{ fontSize: tvSize(20) }}>
                        {day.dateLabel}
                    </Text>
                )}
            />
            {day.items.length > 0 ? (
                <TVFocusGuideView trapFocusLeft trapFocusRight>
                    <FlatList
                        horizontal
                        data={day.items}
                        extraData={focusIndex}
                        renderItem={renderItem}
                        keyExtractor={entry => `${entry.item.mediaId}-${entry.item.episodeNumber}`}
                        getItemLayout={MEDIA_ROW_LAYOUT}
                        snapToAlignment="item"
                        snapToItemPadding={TV.gutter}
                        style={{ flexGrow: 0 }}
                        contentContainerStyle={{
                            paddingHorizontal: TV.gutter,
                            paddingTop: tvSize(10),
                            paddingBottom: tvSize(14),
                            gap: TV.cardGap,
                        }}
                        showsHorizontalScrollIndicator={false}
                        removeClippedSubviews={false}
                        initialNumToRender={8}
                        maxToRenderPerBatch={8}
                        windowSize={5}
                    />
                </TVFocusGuideView>
            ) : (
                <Text className="text-white/35" style={{ paddingHorizontal: TV.gutter, fontSize: tvSize(18) }}>
                    Nothing from your lists airs this day.
                </Text>
            )}
        </View>
    )
})

const CHIP = {
    position: "absolute",
    minHeight: tvSize(32),
    paddingHorizontal: tvSize(10),
    borderRadius: tvSize(9),
    flexDirection: "row",
    alignItems: "center",
    gap: tvSize(5),
} as const

const TVScheduleCard = React.memo(React.forwardRef<FocusNode, {
    entry: Entry
    preferred?: boolean
    onFocus?: () => void
    onPressEntry: (entry: Entry) => void
}>(function TVScheduleCard({ entry, preferred, onFocus, onPressEntry }, ref) {
    const { item, aired, watched, airingAt } = entry
    const focus = useTVFocus(1.055, item.title)
    const time = formatAiringClock(airingAt, AIRING_TIME_ZONE)
    const episodeLabel = item.isMovie
        ? "Movie"
        : `Episode ${item.episodeNumber}${item.isSeasonFinale ? "  ·  Finale" : ""}`
    const state = watched ? "Watched" : aired ? "Aired" : "Upcoming"

    return (
        <Pressable
            ref={ref}
            onPress={() => onPressEntry(entry)}
            onFocus={() => {
                focus.focus()
                onFocus?.()
            }}
            onBlur={focus.blur}
            hasTVPreferredFocus={preferred}
            scrollSnapAlign="start"
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${episodeLabel}, ${state.toLowerCase()} at ${time}`}
            style={{ width: CARD_WIDTH }}
        >
            <TVFocusScaleView style={focus.style}>
                <View
                    style={{
                        width: CARD_WIDTH,
                        height: CARD_WIDTH * 1.42,
                        overflow: "hidden",
                        borderRadius: TV.radius,
                        borderWidth: TV.focusBorder,
                        borderColor: focus.focused ? "#fff" : "transparent",
                        backgroundColor: "rgba(255,255,255,0.04)",
                    }}
                >
                    <TVLazyImage
                        source={item.image ? { uri: item.image } : undefined}
                        style={{ width: "100%", height: "100%" }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={120}
                        recyclingKey={`${item.mediaId}`}
                    />
                    {aired ? (
                        <View pointerEvents="none" style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.45)" }} />
                    ) : null}
                    {TV_VISUAL.cardGradients ? (
                        <LinearGradient
                            pointerEvents="none"
                            colors={["transparent", "rgba(12,12,12,0.55)", "rgba(12,12,12,0.92)"]}
                            locations={[0, 0.45, 1]}
                            style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "45%" }}
                        />
                    ) : null}
                    <View style={[CHIP, { top: tvSize(8), left: tvSize(8), backgroundColor: "rgba(10,10,10,0.86)" }]}>
                        <Ionicons name="time-outline" size={tvSize(16)} color="#ffffff" />
                        <Text className="font-bold text-white" style={{ fontSize: tvSize(17) }}>{time}</Text>
                    </View>
                    <View
                        style={[CHIP, {
                            bottom: tvSize(8),
                            left: tvSize(8),
                            backgroundColor: watched
                                ? "rgba(63,63,70,0.92)"
                                : aired ? "rgba(255,255,255,0.9)" : "rgba(164,67,207,0.94)",
                        }]}
                    >
                        <Ionicons
                            name={watched ? "checkmark-done" : aired ? "checkmark" : "radio-outline"}
                            size={tvSize(16)}
                            color={aired && !watched ? "#0a0a0a" : "#ffffff"}
                        />
                        <Text
                            className="font-bold"
                            style={{ fontSize: tvSize(16), color: aired && !watched ? "#0a0a0a" : "#ffffff" }}
                        >
                            {state}
                        </Text>
                    </View>
                </View>
                <Text
                    className="font-semibold text-white"
                    numberOfLines={1}
                    style={{ marginTop: tvSize(12), fontSize: tvSize(21), lineHeight: tvSize(27), opacity: focus.focused ? 1 : 0.86 }}
                >
                    {item.title}
                </Text>
                <Text
                    className="font-medium text-white/45"
                    numberOfLines={1}
                    style={{ marginTop: tvSize(3), fontSize: tvSize(17), lineHeight: tvSize(22) }}
                >
                    {episodeLabel}
                </Text>
            </TVFocusScaleView>
        </Pressable>
    )
}))
