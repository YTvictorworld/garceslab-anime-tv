/**
 * webOS start screen: shows on the "Currently watching" list that are caught
 * up with what has aired get a card for their next episode in "Continue
 * watching", with when it airs. Once that time has passed the card plays the
 * episode, until the server lists the episode to continue itself.
 * Kept free of React Native so the rules can be unit tested.
 */

type NextAiringLike = { airingAt: number; episode: number } | null | undefined

type MediaLike = {
    id: number
    status?: string | null
    isAdult?: boolean | null
    nextAiringEpisode?: NextAiringLike
}

type EntryLike<T extends MediaLike> = {
    media?: T | null
    listData?: { progress?: number | null } | null
} | null | undefined

type LibraryListLike<T extends MediaLike> = {
    type?: string | null
    entries?: readonly EntryLike<T>[] | null
} | null | undefined

export type UpcomingEpisode<T> = {
    media: T
    /** The episode to watch next: AniList progress + 1. */
    episodeNumber: number
    /** Unix seconds. */
    airingAt: number
}

/**
 * Shows the user watches that are airing and whose AniList progress is the
 * last aired episode, soonest first. Shows already in continue watching
 * (`skipIds`) are left out.
 */
export function pickUpcomingEpisodes<T extends MediaLike>(
    libraryLists: readonly LibraryListLike<T>[],
    skipIds: ReadonlySet<number>,
    options: { allowAdult?: boolean } = {},
): UpcomingEpisode<T>[] {
    const items: UpcomingEpisode<T>[] = []
    const seen = new Set<number>()
    for (const list of libraryLists) {
        if (list?.type !== "CURRENT") continue
        for (const entry of list.entries ?? []) {
            const media = entry?.media
            const next = media?.nextAiringEpisode
            if (!media || !next || seen.has(media.id) || skipIds.has(media.id)) continue
            if (media.isAdult && !options.allowAdult) continue
            if (media.status && media.status !== "RELEASING") continue
            const progress = entry?.listData?.progress ?? 0
            if (!(next.episode > 0) || !(next.airingAt > 0) || progress + 1 !== next.episode) continue
            seen.add(media.id)
            items.push({ media, episodeNumber: next.episode, airingAt: next.airingAt })
        }
    }
    return items.sort((left, right) => left.airingAt - right.airingAt)
}

/** True once the episode's airing time has passed. `now` is in milliseconds. */
export function hasAired(airingAt: number, now: number) {
    return airingAt * 1000 <= now
}

/** "in 3 days", "in 5 h 20 min", "in 12 min", "in less than a minute". */
export function formatTimeUntil(airingAt: number, now: number) {
    const minutes = Math.ceil((airingAt * 1000 - now) / 60000)
    if (minutes <= 1) return "in less than a minute"
    if (minutes < 60) return `in ${minutes} min`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) {
        const rest = minutes % 60
        return rest > 0 ? `in ${hours} h ${rest} min` : `in ${hours} h`
    }
    const days = Math.round(hours / 24)
    return days === 1 ? "in 1 day" : `in ${days} days`
}

/**
 * "Sun, Nov 30, 9:30 AM" in the TV's time zone, or in `timeZone` (an IANA
 * name) when given. An unknown zone falls back to the TV's.
 */
export function formatAiringTime(airingAt: number, timeZone?: string) {
    const options: Intl.DateTimeFormatOptions = {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }
    const date = new Date(airingAt * 1000)
    if (timeZone) {
        try {
            return date.toLocaleString("en-US", { ...options, timeZone })
        } catch {
            // RangeError: not a zone this browser knows.
        }
    }
    return date.toLocaleString("en-US", options)
}

/**
 * When a card's label next needs redrawing: each minute, or the moment the
 * episode airs if that is sooner. Null once it has aired.
 */
export function nextLabelUpdateDelay(airingAt: number, now: number) {
    const left = airingAt * 1000 - now
    if (left <= 0) return null
    return Math.max(1000, Math.min(60 * 1000, left + 500))
}
