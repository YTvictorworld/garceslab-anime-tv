/**
 * Garceslab Anime: the TV Schedule screen's rules. The anime on the current
 * profile's lists airing today and in the next days, grouped by day in the
 * TV's time zone (or `timeZone`, an IANA name). Kept free of React Native so
 * it can be unit tested.
 */

/** The fields of the server's Anime_ScheduleItem this uses. */
export type ScheduleItemLike = {
    mediaId: number
    title: string
    /** ISO time, UTC. Items without one are skipped (very old servers). */
    dateTime?: string
    image?: string
    episodeNumber: number
    isMovie?: boolean
    isSeasonFinale?: boolean
}

export type ScheduleEntry<T extends ScheduleItemLike> = {
    item: T
    /** Milliseconds. */
    airingAt: number
    aired: boolean
    /** The profile's progress already covers the episode. */
    watched: boolean
}

export type ScheduleDay<T extends ScheduleItemLike> = {
    /** "2026-11-24" in the schedule's time zone. */
    key: string
    /** "Today", "Tomorrow", or the weekday ("Thursday"). */
    label: string
    /** "Nov 26". */
    dateLabel: string
    items: ScheduleEntry<T>[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function formatter(options: Intl.DateTimeFormatOptions, timeZone?: string) {
    if (timeZone) {
        try {
            return new Intl.DateTimeFormat("en-US", { ...options, timeZone })
        } catch {
            // RangeError: not a zone this browser knows; use the TV's.
        }
    }
    return new Intl.DateTimeFormat("en-US", options)
}

/** The calendar day of `ms` in the time zone, as "YYYY-MM-DD". */
export function dayKey(ms: number, timeZone?: string) {
    const parts = formatter({ year: "numeric", month: "2-digit", day: "2-digit" }, timeZone).formatToParts(new Date(ms))
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00"
    return `${part("year")}-${part("month")}-${part("day")}`
}

/** `count` consecutive day keys from `firstKey` (calendar days, so DST changes don't skip one). */
export function nextDayKeys(firstKey: string, count: number) {
    const [year, month, day] = firstKey.split("-").map(Number)
    return Array.from({ length: count }, (_, index) => new Date(Date.UTC(year, month - 1, day + index)).toISOString().slice(0, 10))
}

function dayLabels(key: string, index: number) {
    const [year, month, day] = key.split("-").map(Number)
    const date = new Date(Date.UTC(year, month - 1, day, 12))
    const weekday = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    return {
        label: index === 0 ? "Today" : index === 1 ? "Tomorrow" : weekday,
        dateLabel: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    }
}

/** "9:30 PM" in the time zone. */
export function formatAiringClock(ms: number, timeZone?: string) {
    return formatter({ hour: "numeric", minute: "2-digit" }, timeZone).format(new Date(ms))
}

export type GroupScheduleOptions = {
    /** Milliseconds. */
    now: number
    /** Days shown, today included. */
    days?: number
    timeZone?: string
    /** The profile's progress for a media, to mark episodes already watched. */
    progressOf?: (mediaId: number) => number | null | undefined
}

/**
 * The episodes airing on each of `keys` (calendar days in the time zone), in
 * airing order. Days with nothing airing are kept, so the screen can say so;
 * the same episode listed twice counts once.
 */
export function groupScheduleByKeys<T extends ScheduleItemLike>(
    items: readonly T[] | null | undefined,
    keys: readonly string[],
    { now, timeZone, progressOf }: Omit<GroupScheduleOptions, "days">,
): Map<string, ScheduleEntry<T>[]> {
    const byKey = new Map<string, ScheduleEntry<T>[]>(keys.map(key => [key, []]))
    if (keys.length === 0) return byKey
    // Quick reject before the (slower) Intl call: well outside the days asked for.
    const first = Date.parse(`${keys[0]}T00:00:00Z`) - 2 * DAY_MS
    const last = Date.parse(`${keys[keys.length - 1]}T00:00:00Z`) + 3 * DAY_MS
    const seen = new Set<string>()
    for (const item of items ?? []) {
        const airingAt = item.dateTime ? Date.parse(item.dateTime) : NaN
        if (!Number.isFinite(airingAt) || airingAt < first || airingAt > last) continue
        const list = byKey.get(dayKey(airingAt, timeZone))
        if (!list) continue
        const id = `${item.mediaId}:${item.episodeNumber}`
        if (seen.has(id)) continue
        seen.add(id)
        const progress = progressOf?.(item.mediaId) ?? 0
        list.push({
            item,
            airingAt,
            aired: airingAt <= now,
            watched: progress >= item.episodeNumber && item.episodeNumber > 0,
        })
    }
    for (const list of byKey.values()) {
        list.sort((left, right) => left.airingAt - right.airingAt || left.item.title.localeCompare(right.item.title))
    }
    return byKey
}

/** Today and the next `days - 1` days, each with the episodes airing that day. */
export function groupScheduleByDay<T extends ScheduleItemLike>(
    items: readonly T[] | null | undefined,
    { now, days = 7, timeZone, progressOf }: GroupScheduleOptions,
): ScheduleDay<T>[] {
    const keys = nextDayKeys(dayKey(now, timeZone), days)
    const byKey = groupScheduleByKeys(items, keys, { now, timeZone, progressOf })
    return keys.map((key, index) => ({
        key,
        ...dayLabels(key, index),
        items: byKey.get(key) ?? [],
    }))
}

/** 0 = Sunday … 6 = Saturday, of a "YYYY-MM-DD" key. */
function weekdayOf(key: string) {
    const [year, month, day] = key.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/**
 * The first day of the week holding `key`, `weekOffset` weeks away. Weeks
 * start on Monday (1) like the web's calendar, or on Sunday (0).
 */
export function weekStartKey(key: string, weekOffset = 0, weekStartsOn: 0 | 1 = 1) {
    const back = (weekdayOf(key) - weekStartsOn + 7) % 7
    const [year, month, day] = key.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day - back + weekOffset * 7)).toISOString().slice(0, 10)
}

export type ScheduleWeekDay<T extends ScheduleItemLike> = {
    key: string
    /** "Mon". */
    weekday: string
    /** "Nov 24". */
    dateLabel: string
    isToday: boolean
    /** Before today. */
    isPast: boolean
    items: ScheduleEntry<T>[]
}

export type ScheduleWeek<T extends ScheduleItemLike> = {
    /** "Nov 23 – 29, 2026", "Nov 30 – Dec 6, 2026", "Dec 28, 2026 – Jan 3, 2027". */
    label: string
    days: ScheduleWeekDay<T>[]
    /** The week holding today. */
    isCurrent: boolean
}

function shortDate(key: string, withYear = false) {
    const [year, month, day] = key.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(withYear ? { year: "numeric" } : null),
        timeZone: "UTC",
    })
}

function weekLabel(first: string, last: string) {
    const [firstYear, firstMonth] = first.split("-")
    const [lastYear, lastMonth, lastDay] = last.split("-")
    if (firstYear !== lastYear) return `${shortDate(first, true)} – ${shortDate(last, true)}`
    if (firstMonth !== lastMonth) return `${shortDate(first)} – ${shortDate(last)}, ${lastYear}`
    return `${shortDate(first)} – ${Number(lastDay)}, ${lastYear}`
}

/**
 * The web calendar's week, for the TV: seven days from the week's first day
 * (Monday by default), `weekOffset` weeks from the one holding today, each
 * with its episodes in airing order.
 */
export function buildScheduleWeek<T extends ScheduleItemLike>(
    items: readonly T[] | null | undefined,
    {
        now,
        weekOffset = 0,
        weekStartsOn = 1,
        timeZone,
        progressOf,
    }: Omit<GroupScheduleOptions, "days"> & { weekOffset?: number; weekStartsOn?: 0 | 1 },
): ScheduleWeek<T> {
    const today = dayKey(now, timeZone)
    const keys = nextDayKeys(weekStartKey(today, weekOffset, weekStartsOn), 7)
    const byKey = groupScheduleByKeys(items, keys, { now, timeZone, progressOf })
    return {
        label: weekLabel(keys[0], keys[6]),
        isCurrent: weekOffset === 0,
        days: keys.map(key => {
            const [year, month, day] = key.split("-").map(Number)
            return {
                key,
                weekday: new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
                dateLabel: shortDate(key),
                isToday: key === today,
                isPast: key < today,
                items: byKey.get(key) ?? [],
            }
        }),
    }
}

/**
 * AniList's ~100 px `medium` cover for a `large` (or `extraLarge`) cover URL,
 * for small thumbnails; other URLs are returned as they are.
 */
export function smallCoverUrl(url: string | null | undefined) {
    if (!url) return undefined
    return url.replace(/\/cover\/(large|extraLarge)\//, "/cover/medium/")
}

/** Where focus starts: the first episode still to air, else the latest one that aired. */
export function initialScheduleFocus(days: readonly { items: readonly { aired: boolean }[] }[]) {
    let last: { day: number; index: number } | null = null
    for (let day = 0; day < days.length; day++) {
        const items = days[day].items
        for (let index = 0; index < items.length; index++) {
            if (!items[index].aired) return { day, index }
            last = { day, index }
        }
    }
    return last
}

type CollectionMediaLike = {
    id: number
    title?: { userPreferred?: string | null; english?: string | null; romaji?: string | null } | null
    coverImage?: { large?: string | null; medium?: string | null } | null
    format?: string | null
    episodes?: number | null
    nextAiringEpisode?: { airingAt: number; episode: number } | null
}

type CollectionListLike = {
    status?: string | null
    entries?: readonly ({ media?: CollectionMediaLike | null } | null | undefined)[] | null
} | null | undefined

/**
 * For a server without the schedule endpoint (or when it fails): each list
 * anime's next episode from the profile's collection. Only upcoming episodes,
 * one per anime; dropped lists are left out, as the server does.
 */
export function scheduleFromCollection(lists: readonly CollectionListLike[] | null | undefined): ScheduleItemLike[] {
    const items: ScheduleItemLike[] = []
    const seen = new Set<number>()
    for (const list of lists ?? []) {
        if (list?.status === "DROPPED") continue
        for (const entry of list?.entries ?? []) {
            const media = entry?.media
            const next = media?.nextAiringEpisode
            if (!media || !next || !(next.airingAt > 0) || seen.has(media.id)) continue
            seen.add(media.id)
            items.push({
                mediaId: media.id,
                title: media.title?.userPreferred ?? media.title?.english ?? media.title?.romaji ?? "Untitled",
                dateTime: new Date(next.airingAt * 1000).toISOString(),
                image: media.coverImage?.large ?? media.coverImage?.medium ?? undefined,
                episodeNumber: next.episode,
                isMovie: media.format === "MOVIE",
                isSeasonFinale: !!media.episodes && next.episode === media.episodes,
            })
        }
    }
    return items
}
