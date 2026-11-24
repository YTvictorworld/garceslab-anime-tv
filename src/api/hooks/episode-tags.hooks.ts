import { buildSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { EpisodeTags_Response } from "@/api/generated/types"
import { useServerUrl } from "@/atoms/server.atoms"
import { episodeTagFor, episodeTagsRefetchInterval, visibleEpisodeTags, type EpisodeTagKind, type EpisodeTagMap } from "@/lib/episode-tags/episode-tags"
import { createRequestLimiter } from "@/lib/episode-tags/request-limit"
import { useQuery } from "@tanstack/react-query"
import * as React from "react"

const TIMEOUT_MS = 8000

/**
 * The home screen's cards and hero, the anime page and the player share one
 * cache entry per anime; a few requests at a time at most, so a long Continue
 * watching row doesn't fire a burst of them at the server.
 */
const requestLimiter = createRequestLimiter(3)

/**
 * Garceslab Anime: canon/filler/recap tags for an anime's episode cards, or
 * null when there is nothing to show (no data yet, an all-canon anime, an
 * older server without the endpoint, any error). Never shows an error: the
 * cards simply have no tag. While the server fetches ("pending") it asks again
 * every few seconds for about two minutes.
 */
export function useEpisodeTags(mediaId: number | null | undefined): EpisodeTagMap | null {
    const serverUrl = useServerUrl()
    const query = useQuery<EpisodeTags_Response | undefined>({
        queryKey: ["episode-tags", mediaId, serverUrl],
        enabled: !!serverUrl && !!mediaId,
        staleTime: 30 * 60 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchInterval: q => episodeTagsRefetchInterval(q.state.data, q.state.dataUpdateCount),
        queryFn: ({ signal }) => requestLimiter.run(() => buildSeaQuery<EpisodeTags_Response>({
            serverUrl,
            endpoint: API_ENDPOINTS.ANIME_EPISODE_TAGS.GetAnimeEpisodeTags.endpoint.replace("{id}", String(mediaId)),
            method: "GET",
            // An older server answers 404: no tags, no toast.
            muteError: true,
            timeoutMs: TIMEOUT_MS,
            signal,
        }), signal),
    })
    return React.useMemo(() => visibleEpisodeTags(query.data), [query.data])
}

/**
 * One episode's tag (home cards, the hero, the player), from the same cache
 * as the anime page. Undefined when there is nothing to show.
 */
export function useEpisodeTag(mediaId: number | null | undefined, episodeNumber: number | null | undefined): EpisodeTagKind | undefined {
    const tags = useEpisodeTags(episodeNumber ? mediaId : null)
    return episodeTagFor(tags, episodeNumber)
}
