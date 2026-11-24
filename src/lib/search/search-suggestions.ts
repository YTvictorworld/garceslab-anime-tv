import type { AL_BaseAnime, TitleIndex_Suggestion } from "@/api/generated/types"

/** One suggestion row on the TV search screen, from the server's title index or from AniList. */
export type SearchSuggestion = {
    /** AniList anime id (opens the anime's page). */
    id: number
    title: string
    /** The synonym that matched when it isn't the title (e.g. "Attack on Titan" for "Shingeki no Kyojin"). */
    matched?: string
    format?: string
    year?: number
}

export function suggestionFromTitleIndex(item: TitleIndex_Suggestion): SearchSuggestion {
    return {
        id: item.mediaId,
        title: item.title,
        matched: item.matched || undefined,
        format: item.format || undefined,
        year: item.year || undefined,
    }
}

export function suggestionFromAnilist(media: AL_BaseAnime): SearchSuggestion {
    return {
        id: media.id,
        title: media.title?.userPreferred || media.title?.english || media.title?.romaji || "Untitled",
        format: media.format || undefined,
        year: media.seasonYear ?? media.startDate?.year ?? undefined,
    }
}

/** The second line of a suggestion: matched synonym, format, year. */
export function suggestionDetail(item: SearchSuggestion): string {
    return [item.matched, item.format?.replace(/_/g, " "), item.year].filter(Boolean).join(" · ")
}

export type SuggestionSources = {
    /** The title index's answer for the current query: undefined while it is still loading. */
    index: TitleIndex_Suggestion[] | undefined
    /** True when the index request failed (e.g. an older server without the endpoint). */
    indexFailed: boolean
    /** The AniList results the screen already loads for the same query and filters. */
    anilist: AL_BaseAnime[]
}

/**
 * Prefer the title index (prefix matches: "ble" finds Bleach); fall back to the
 * AniList results when the index answered nothing, failed, or there is no title
 * (filters only). While the index is still loading, the AniList rows stay up.
 */
export function pickSuggestions(sources: SuggestionSources, limit: number): { items: SearchSuggestion[]; fromIndex: boolean } {
    if (!sources.indexFailed && sources.index && sources.index.length > 0) {
        return { items: sources.index.slice(0, limit).map(suggestionFromTitleIndex), fromIndex: true }
    }
    return { items: sources.anilist.slice(0, limit).map(suggestionFromAnilist), fromIndex: false }
}
