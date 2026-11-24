import type { EpisodeTags_Kind, EpisodeTags_Response } from "@/api/generated/types"

/**
 * Garceslab Anime: canon/filler/recap tags on episode cards, from the server's
 * GET /api/v1/anime/episode-tags/{id} (MyAnimeList data). Pure helpers, no
 * react-native imports, so tests can load this file directly.
 */
export type EpisodeTagKind = EpisodeTags_Kind

/** Episode number (the episode list's episodeNumber) -> kind. */
export type EpisodeTagMap = ReadonlyMap<number, EpisodeTagKind>

export const EPISODE_TAG_LABELS: Record<EpisodeTagKind, string> = {
    canon: "CANON",
    filler: "FILLER",
    recap: "RECAP",
    mixed: "MIX",
}

/** Read aloud by webOS Audio Guidance. */
export const EPISODE_TAG_SPOKEN: Record<EpisodeTagKind, string> = {
    canon: "Canon",
    filler: "Filler",
    recap: "Recap",
    mixed: "Mixed canon and filler",
}

/**
 * Pill colours. CANON is muted lilac (outlined, the brand's 300 shade), FILLER
 * stands out in warm orange, RECAP is grey, MIX blends the brand and filler.
 */
export const EPISODE_TAG_STYLE: Record<EpisodeTagKind, { background: string; color: string; border?: string }> = {
    canon: { background: "rgba(20,12,28,0.72)", color: "#e6b0fd", border: "rgba(230,176,253,0.45)" },
    filler: { background: "#f59e4b", color: "#1c0d02" },
    recap: { background: "rgba(120,120,134,0.92)", color: "#f4f4f6" },
    // The TV card paints a brand -> orange gradient over this.
    mixed: { background: "#c06d8d", color: "#ffffff" },
}

const KINDS = new Set<string>(["canon", "filler", "recap", "mixed"])

/**
 * The tags to show for an anime, or null to show none: only when the server
 * has data ("ready") and at least one episode is filler, recap or mixed, so an
 * all-canon anime stays free of pills.
 */
export function visibleEpisodeTags(response: EpisodeTags_Response | null | undefined): EpisodeTagMap | null {
    if (!response || response.status !== "ready" || !response.episodes) return null
    const map = new Map<number, EpisodeTagKind>()
    let nonCanon = false
    for (const [key, kind] of Object.entries(response.episodes)) {
        const n = Number(key)
        if (!Number.isInteger(n) || n <= 0 || !KINDS.has(kind)) continue
        map.set(n, kind)
        if (kind !== "canon") nonCanon = true
    }
    return nonCanon ? map : null
}

export function episodeTagFor(tags: EpisodeTagMap | null | undefined, episodeNumber: number | null | undefined): EpisodeTagKind | undefined {
    if (!tags || !episodeNumber) return undefined
    return tags.get(episodeNumber)
}

export const EPISODE_TAGS_POLL_MS = 4000
/** About two minutes of polling while the server fetches a long series. */
export const EPISODE_TAGS_MAX_POLLS = 30

/** How soon to ask again: only while the server is still fetching ("pending"). */
export function episodeTagsRefetchInterval(response: EpisodeTags_Response | null | undefined, polls: number): number | false {
    if (response?.status !== "pending" || polls >= EPISODE_TAGS_MAX_POLLS) return false
    return EPISODE_TAGS_POLL_MS
}
