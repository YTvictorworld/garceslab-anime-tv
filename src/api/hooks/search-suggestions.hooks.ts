import { buildSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { AL_BaseAnime, TitleIndex_Suggestion } from "@/api/generated/types"
import { useInfiniteAnimeSearch } from "@/api/hooks/search.hooks"
import { useServerUrl } from "@/atoms/server.atoms"
import { pickSuggestions, type SearchSuggestion } from "@/lib/search/search-suggestions"
import { isSearchActive, type SearchParams } from "@/lib/search/search.atoms"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import * as React from "react"

const SUGGESTIONS = 6
const SUGGEST_TIMEOUT_MS = 8000

/**
 * Garceslab Anime: the titles suggested while typing (TV search keyboard).
 * The one place that decides where suggestions come from: first the server's
 * title index (GET /api/v1/search/suggest, prefix matches: "ble" finds Bleach),
 * then, when it has nothing (not downloaded yet, disabled, an older server, or
 * only filters set), the AniList anime search the results use (same query, so
 * no extra request), which matches whole words only.
 */
export function useSearchSuggestions(query: string | null, params: SearchParams): { suggestions: SearchSuggestion[]; isFetching: boolean; fromIndex: boolean } {
    const serverUrl = useServerUrl()
    const searchParams = React.useMemo(() => ({ ...params, type: "anime" as const, title: query }), [params, query])
    const active = isSearchActive(searchParams)
    const search = useInfiniteAnimeSearch(searchParams, active, { keepPrevious: true })

    const index = useQuery({
        queryKey: ["search-suggest", query, serverUrl],
        enabled: !!serverUrl && !!query,
        staleTime: 10 * 60 * 1000,
        retry: false,
        // The previous letters' suggestions stay up while the next query runs.
        placeholderData: keepPreviousData,
        queryFn: ({ signal }) => buildSeaQuery<TitleIndex_Suggestion[], { q: string; limit: number }>({
            serverUrl,
            endpoint: API_ENDPOINTS.SEARCH_SUGGEST.SearchSuggest.endpoint,
            method: "GET",
            params: { q: query ?? "", limit: SUGGESTIONS },
            // An older server answers 404: fall back to AniList quietly.
            muteError: true,
            timeoutMs: SUGGEST_TIMEOUT_MS,
            signal,
        }),
    })

    const anilist = React.useMemo(() => (
        active ? (search.data?.pages.flatMap(page => page?.Page?.media ?? []).filter(Boolean) as AL_BaseAnime[] ?? []) : []
    ), [active, search.data?.pages])

    const { items, fromIndex } = React.useMemo(() => {
        if (!active) return { items: [], fromIndex: false }
        return pickSuggestions({
            index: query ? (index.data ?? (index.isFetching ? undefined : [])) : [],
            indexFailed: index.isError,
            anilist,
        }, SUGGESTIONS)
    }, [active, query, index.data, index.isFetching, index.isError, anilist])

    const isFetching = active && (
        (!!query && index.isFetching)
        || (!fromIndex && search.isFetching && !search.isFetchingNextPage)
    )
    return { suggestions: items, isFetching, fromIndex }
}
