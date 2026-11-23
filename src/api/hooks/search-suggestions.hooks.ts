import type { AL_BaseAnime } from "@/api/generated/types"
import { useInfiniteAnimeSearch } from "@/api/hooks/search.hooks"
import { isSearchActive, type SearchParams } from "@/lib/search/search.atoms"
import * as React from "react"

const SUGGESTIONS = 6

/**
 * Garceslab Anime: the titles suggested while typing (TV search keyboard).
 * The one place that decides where suggestions come from. Today it is the
 * AniList anime search the results use (same query, so no extra request),
 * which matches whole words only ("blea" finds nothing, "bleach" does); a
 * server endpoint with a local title index (e.g. GET /api/v1/search/suggest?q=)
 * can replace it here without touching the screen.
 */
export function useSearchSuggestions(query: string | null, params: SearchParams): { suggestions: AL_BaseAnime[]; isFetching: boolean } {
    const searchParams = React.useMemo(() => ({ ...params, type: "anime" as const, title: query }), [params, query])
    const active = isSearchActive(searchParams)
    const search = useInfiniteAnimeSearch(searchParams, active, { keepPrevious: true })
    const suggestions = React.useMemo(() => (
        active
            ? (search.data?.pages.flatMap(page => page?.Page?.media ?? []).filter(Boolean) as AL_BaseAnime[] ?? []).slice(0, SUGGESTIONS)
            : []
    ), [active, search.data?.pages])
    return { suggestions, isFetching: active && search.isFetching && !search.isFetchingNextPage }
}
