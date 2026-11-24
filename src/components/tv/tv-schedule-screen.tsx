import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Anime_ScheduleItem } from "@/api/generated/types"
import { useServerQuery } from "@/api/client/requests"
import { useGetRawAnimeCollection } from "@/api/hooks/anilist.hooks"
import { TVButton, TVFocusScaleView, useTVFocus } from "@/components/tv/tv-focus"
import { requestTVFocus } from "@/components/tv/tv-native"
import { TVLazyImage } from "@/components/tv/tv-lazy-image"
import { TVNavScrim } from "@/components/tv/tv-nav-scrim"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { TVPageSkeleton } from "@/components/tv/tv-skeleton"
import { Ionicons } from "@/lib/icons/Ionicons"
import { useIsServerConnected } from "@/lib/offline"
import { TV_VISUAL } from "@/lib/tv/visual-flags"
import {
    buildScheduleWeek,
    formatAiringClock,
    initialScheduleFocus,
    type ScheduleEntry,
    scheduleFromCollection,
    type ScheduleWeekDay,
    smallCoverUrl,
} from "@/lib/tv/schedule-days"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { router, useFocusEffect, useIsFocused } from "expo-router"
import * as React from "react"
import { Pressable, ScrollView, Text, TVFocusGuideView, View } from "react-native"

/** Same zone as the upcoming cards on Home (see tv-continue-card.tsx). */
const AIRING_TIME_ZONE = process.env.EXPO_PUBLIC_TV_TIME_ZONE || undefined
/** How far the week buttons go, in weeks from this one (AniList's schedule reaches about this far). */
const MAX_WEEK_OFFSET = 4
const COLUMN_GAP = tvSize(12)
const THUMB_WIDTH = tvSize(56)
const THUMB_HEIGHT = tvSize(80)
const LILAC = "#a443cf"
const LILAC_TEXT = "#e6b0fd"

type Entry = ScheduleEntry<Anime_ScheduleItem>
type Day = ScheduleWeekDay<Anime_ScheduleItem>
type FocusNode = React.ElementRef<typeof Pressable>
type RegisterRef = (key: string) => (node: FocusNode | null) => void

const entryKey = (entry: Entry) => `${entry.item.mediaId}-${entry.item.episodeNumber}`

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
 * Garceslab Anime: the TV Schedule tab, the web's release calendar as a week
 * grid. One column per day, Monday to Sunday, today highlighted, each day
 * listing the episodes of the current profile's list anime that air on it,
 * in the TV's time zone. Buttons move to the previous and next weeks. Focus
 * starts on the next episode to air; OK opens the anime and Back returns to
 * the same episode.
 */
export function TVScheduleScreen() {
    const isFocused = useIsFocused()
    const isConnected = useIsServerConnected()
    const schedule = useSchedule(isConnected)
    const collection = useGetRawAnimeCollection()
    const now = useMinuteClock(isFocused)
    const [weekOffset, setWeekOffset] = React.useState(0)
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

    // Built against the minute clock: an episode turns "Aired" when its time passes.
    const week = React.useMemo(() => buildScheduleWeek(items, {
        now,
        weekOffset,
        timeZone: AIRING_TIME_ZONE,
        progressOf: id => progressById.get(id),
    }), [items, now, progressById, weekOffset])
    // Focus starts on this week's next episode to air (only in the current week).
    const focusTarget = React.useMemo(() => week.isCurrent ? initialScheduleFocus(week.days) : null, [week])
    const total = week.days.reduce((count, day) => count + day.items.length, 0)
    const zone = React.useMemo(timeZoneName, [])

    const focusedInitial = React.useCallback(() => setPreferInitial(false), [])

    // Back from the anime page puts focus on the episode that opened it. One
    // ref callback per episode, kept, so the memoized items don't re-render.
    const cardRefs = React.useRef(new Map<string, FocusNode>())
    const refCallbacks = React.useRef(new Map<string, (node: FocusNode | null) => void>())
    const registerRef = React.useCallback<RegisterRef>((key) => {
        let callback = refCallbacks.current.get(key)
        if (!callback) {
            callback = (node) => {
                if (node) cardRefs.current.set(key, node)
                else cardRefs.current.delete(key)
            }
            refCallbacks.current.set(key, callback)
        }
        return callback
    }, [])
    const lastOpened = React.useRef<string | null>(null)
    useFocusEffect(React.useCallback(() => {
        const key = lastOpened.current
        if (!key) return
        const timer = setTimeout(() => {
            lastOpened.current = null
            requestTVFocus(cardRefs.current.get(key))
        }, 120)
        return () => clearTimeout(timer)
    }, []))

    const open = React.useCallback((entry: Entry) => {
        lastOpened.current = entryKey(entry)
        router.push(`/(app)/entry/anime/${entry.item.mediaId}`)
    }, [])

    if (schedule.isLoading && !usingFallback && isConnected) {
        return <TVPageSkeleton />
    }

    const subtitle = [
        total === 1 ? "1 episode from your lists" : `${total} episodes from your lists`,
        zone ? `times in ${zone.replaceAll("_", " ")}` : null,
        usingFallback ? "next episodes only (this server has no schedule)" : null,
    ].filter(Boolean).join("  ·  ")

    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            <ScrollView
                style={{ flex: 1 }}
                fadingEdgeLength={{ start: TV.navInset + tvSize(18), end: 0 }}
                contentContainerStyle={{ paddingTop: TV.navInset, paddingBottom: tvSize(48) }}
                showsVerticalScrollIndicator={false}
            >
                <View
                    style={{
                        paddingHorizontal: TV.gutter,
                        paddingBottom: tvSize(18),
                        flexDirection: "row",
                        alignItems: "flex-end",
                        justifyContent: "space-between",
                        gap: tvSize(24),
                    }}
                >
                    <View style={{ flexShrink: 1, gap: tvSize(4) }}>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: tvSize(18) }}>
                            <Text
                                className="font-black text-white"
                                style={{ fontSize: tvSize(40), lineHeight: tvSize(48), letterSpacing: tvSize(-0.5) }}
                            >
                                Schedule
                            </Text>
                            <Text className="font-semibold" style={{ fontSize: tvSize(26), color: week.isCurrent ? LILAC_TEXT : "#ffffff" }}>
                                {week.label}
                            </Text>
                        </View>
                        <Text className="font-medium text-white/50" style={{ fontSize: tvSize(18) }} numberOfLines={1}>
                            {subtitle}
                        </Text>
                    </View>
                    <TVFocusGuideView trapFocusLeft trapFocusRight style={{ flexDirection: "row", gap: tvSize(12) }}>
                        <TVButton
                            label="Previous week"
                            variant="secondary"
                            size="compact"
                            icon={<Ionicons name="chevron-back" size={tvSize(22)} color="#ffffff" />}
                            onPress={() => setWeekOffset(offset => Math.max(-MAX_WEEK_OFFSET, offset - 1))}
                        />
                        <TVButton
                            label="This week"
                            variant={week.isCurrent ? "primary" : "secondary"}
                            size="compact"
                            icon={<Ionicons name="today-outline" size={tvSize(22)} color="#ffffff" />}
                            onPress={() => setWeekOffset(0)}
                        />
                        <TVButton
                            label="Next week"
                            variant="secondary"
                            size="compact"
                            icon={<Ionicons name="chevron-forward" size={tvSize(22)} color="#ffffff" />}
                            onPress={() => setWeekOffset(offset => Math.min(MAX_WEEK_OFFSET, offset + 1))}
                        />
                    </TVFocusGuideView>
                </View>

                <TVFocusGuideView
                    autoFocus={isFocused}
                    destinations={initialCard ? [initialCard] : undefined}
                    style={{
                        paddingHorizontal: TV.gutter,
                        flexDirection: "row",
                        alignItems: "stretch",
                        gap: COLUMN_GAP,
                    }}
                >
                    {week.days.map((day, dayIndex) => (
                        <TVScheduleDayColumn
                            key={day.key}
                            day={day}
                            focusIndex={focusTarget?.day === dayIndex ? focusTarget.index : -1}
                            preferred={preferInitial && isFocused}
                            initialRef={setInitialCard}
                            onFocusInitial={focusedInitial}
                            registerRef={registerRef}
                            onPress={open}
                        />
                    ))}
                </TVFocusGuideView>

                {total === 0 ? (
                    <View style={{ alignItems: "center", paddingTop: tvSize(28), paddingHorizontal: TV.gutter, gap: tvSize(6) }}>
                        <Text className="font-semibold text-white" style={{ fontSize: tvSize(22) }}>
                            {isConnected ? "Nothing from your lists airs this week" : "Server is offline"}
                        </Text>
                        <Text className="text-white/40" style={{ fontSize: tvSize(18) }}>
                            {isConnected
                                ? "Try the next week, or add airing anime to Watching or Planning."
                                : "Reconnect to load the schedule."}
                        </Text>
                    </View>
                ) : null}
            </ScrollView>
            <TVNavScrim />
        </View>
    )
}

/** Fills the screen below the header, like the web's calendar. */
const COLUMN_MIN_HEIGHT = tvSize(800)

const TVScheduleDayColumn = React.memo(function TVScheduleDayColumn({
    day,
    focusIndex,
    preferred,
    initialRef,
    onFocusInitial,
    registerRef,
    onPress,
}: {
    day: Day
    /** The item focus starts on, in this day (-1: none). */
    focusIndex: number
    preferred: boolean
    initialRef: (node: FocusNode | null) => void
    onFocusInitial: () => void
    registerRef: RegisterRef
    onPress: (entry: Entry) => void
}) {
    const art = TV_VISUAL.scheduleDayArt ? day.items[0]?.item.image : undefined
    return (
        <View
            style={{
                flex: 1,
                minWidth: 0,
                minHeight: COLUMN_MIN_HEIGHT,
                overflow: "hidden",
                borderRadius: tvSize(16),
                borderWidth: day.isToday ? tvSize(2) : Math.max(1, tvSize(1)),
                borderColor: day.isToday ? "rgba(164,67,207,0.75)" : "rgba(255,255,255,0.07)",
                backgroundColor: day.isToday ? "rgba(164,67,207,0.08)" : "rgba(255,255,255,0.025)",
            }}
        >
            {art ? (
                // The web calendar's day background: the first episode's cover, dim and still.
                <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: tvSize(260) }}>
                    <Image
                        source={{ uri: art }}
                        style={{ position: "absolute", inset: 0, opacity: day.isToday ? 0.42 : 0.16 }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={0}
                        accessibilityIgnoresInvertColors
                    />
                    <LinearGradient
                        colors={["rgba(10,10,10,0.2)", "rgba(10,10,10,0.85)", "#0b0a0c"]}
                        locations={[0, 0.6, 1]}
                        style={{ position: "absolute", inset: 0 }}
                    />
                </View>
            ) : null}

            <View
                accessibilityLabel={`${day.isToday ? "Today, " : ""}${day.weekday} ${day.dateLabel}, ${day.items.length} episodes`}
                style={{
                    paddingHorizontal: tvSize(14),
                    paddingTop: tvSize(12),
                    paddingBottom: tvSize(10),
                    flexDirection: "row",
                    alignItems: "center",
                    gap: tvSize(10),
                }}
            >
                <View
                    style={{
                        minWidth: tvSize(48),
                        height: tvSize(48),
                        paddingHorizontal: tvSize(6),
                        borderRadius: tvSize(24),
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: day.isToday ? LILAC : "transparent",
                    }}
                >
                    <Text
                        className="font-black"
                        style={{
                            fontSize: tvSize(26),
                            color: day.isToday ? "#ffffff" : day.isPast ? "rgba(255,255,255,0.45)" : "#ffffff",
                        }}
                    >
                        {day.dateLabel.split(" ")[1]}
                    </Text>
                </View>
                <View style={{ flexShrink: 1 }}>
                    <Text
                        className="font-bold"
                        style={{
                            fontSize: tvSize(19),
                            color: day.isToday ? LILAC_TEXT : day.isPast ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.85)",
                        }}
                    >
                        {day.isToday ? "Today" : day.weekday}
                    </Text>
                    <Text className="font-medium text-white/40" style={{ fontSize: tvSize(15) }}>
                        {day.dateLabel.split(" ")[0]}
                        {day.items.length ? `  ·  ${day.items.length}` : ""}
                    </Text>
                </View>
            </View>

            <View style={{ paddingHorizontal: tvSize(8), paddingBottom: tvSize(10), gap: tvSize(8) }}>
                {day.items.map((entry, index) => (
                    <TVScheduleItem
                        key={entryKey(entry)}
                        entry={entry}
                        preferred={preferred && index === focusIndex}
                        initialRef={index === focusIndex ? initialRef : undefined}
                        registerRef={registerRef(entryKey(entry))}
                        onFocus={index === focusIndex ? onFocusInitial : undefined}
                        onPressEntry={onPress}
                    />
                ))}
                {day.items.length === 0 ? (
                    <Text className="text-white/25" style={{ fontSize: tvSize(16), paddingHorizontal: tvSize(6), paddingTop: tvSize(4) }}>
                        No episodes
                    </Text>
                ) : null}
            </View>
        </View>
    )
})

const TVScheduleItem = React.memo(function TVScheduleItem({
    entry,
    preferred,
    initialRef,
    registerRef,
    onFocus,
    onPressEntry,
}: {
    entry: Entry
    preferred?: boolean
    /** Set on the item focus starts on (the grid's destination). */
    initialRef?: (node: FocusNode | null) => void
    registerRef: (node: FocusNode | null) => void
    onFocus?: () => void
    onPressEntry: (entry: Entry) => void
}) {
    const { item, aired, watched, airingAt } = entry
    const focus = useTVFocus(1.04, item.title)
    const ref = React.useCallback((node: FocusNode | null) => {
        registerRef(node)
        initialRef?.(node)
    }, [initialRef, registerRef])
    const time = formatAiringClock(airingAt, AIRING_TIME_ZONE)
    const episodeLabel = item.isMovie ? "Movie" : `Ep ${item.episodeNumber}`
    const state = watched ? "Watched" : aired ? "Aired" : item.isSeasonFinale ? "Finale" : null
    const spokenState = watched ? "watched" : aired ? "aired" : "upcoming"

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
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${item.isMovie ? "movie" : `episode ${item.episodeNumber}`}${item.isSeasonFinale ? ", finale" : ""}, ${spokenState} at ${time}`}
        >
            <TVFocusScaleView style={focus.style}>
                <View
                    style={{
                        flexDirection: "row",
                        gap: tvSize(10),
                        padding: tvSize(6),
                        borderRadius: tvSize(12),
                        borderWidth: tvSize(3),
                        borderColor: focus.focused ? "#ffffff" : "transparent",
                        backgroundColor: focus.focused ? "rgba(255,255,255,0.12)" : "rgba(18,16,20,0.82)",
                    }}
                >
                    <View
                        style={{
                            width: THUMB_WIDTH,
                            height: THUMB_HEIGHT,
                            borderRadius: tvSize(8),
                            overflow: "hidden",
                            backgroundColor: "rgba(255,255,255,0.05)",
                            opacity: aired && !focus.focused ? 0.6 : 1,
                        }}
                    >
                        <TVLazyImage
                            source={item.image ? { uri: smallCoverUrl(item.image) } : undefined}
                            style={{ width: "100%", height: "100%" }}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            transition={100}
                            recyclingKey={entryKey(entry)}
                        />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: tvSize(2) }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(5) }}>
                            {!aired ? <Ionicons name="radio-outline" size={tvSize(15)} color={LILAC_TEXT} /> : null}
                            <Text
                                className="font-bold"
                                numberOfLines={1}
                                style={{ fontSize: tvSize(16), color: aired ? "rgba(255,255,255,0.5)" : LILAC_TEXT }}
                            >
                                {time}
                            </Text>
                        </View>
                        <Text
                            className="font-semibold"
                            numberOfLines={2}
                            style={{
                                fontSize: tvSize(17),
                                lineHeight: tvSize(21),
                                color: watched && !focus.focused ? "rgba(255,255,255,0.5)" : "#ffffff",
                            }}
                        >
                            {item.title}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(5) }}>
                            {watched ? <Ionicons name="checkmark-done" size={tvSize(15)} color="rgba(255,255,255,0.5)" /> : null}
                            <Text className="font-medium text-white/55" numberOfLines={1} style={{ fontSize: tvSize(15) }}>
                                {state ? `${episodeLabel}  ·  ${state}` : episodeLabel}
                            </Text>
                        </View>
                    </View>
                </View>
            </TVFocusScaleView>
        </Pressable>
    )
})
