import { EPISODE_TAG_LABELS, type EpisodeTagKind, type EpisodeTagMap } from "./episode-tags.ts"

/**
 * Garceslab Anime: the player's "next episode" with episode tags. With "Skip
 * filler and recaps" on, the next episode is the first one after the current
 * one that isn't filler or recap. MIX episodes are kept (they carry canon
 * story), and so are episodes the source doesn't list. Pure, so it is tested
 * directly.
 */

/** What "Skip filler and recaps" jumps over. */
export function isSkippableEpisodeTag(kind: EpisodeTagKind | undefined): boolean {
    return kind === "filler" || kind === "recap"
}

export type NextEpisodeSkip = {
    /** First and last episode jumped over. */
    from: number
    to: number
    /** What was jumped over: only filler, only recaps, or both. */
    kinds: "filler" | "recap" | "both"
}

export type NextEpisodePlan = {
    /** The episode to play next. */
    episodeNumber: number
    skip: NextEpisodeSkip | null
}

/**
 * Where "next" goes. `natural` is the episode the player would play without
 * tags (null when there is none); the plan only differs from it when skipping
 * is on, tags are known, and there is a non-filler episode to land on:
 * - `lastEpisode`: the anime's episode count, when known; a jump past it falls
 *   back to the natural next episode (an anime that ends on filler).
 * - `available`: the episodes that can be played (downloaded files); a jump to
 *   one that isn't there falls back as well.
 */
export function planNextEpisode(options: {
    current: number | null | undefined
    natural: number | null | undefined
    tags: EpisodeTagMap | null | undefined
    skipFiller: boolean
    lastEpisode?: number | null
    available?: ReadonlySet<number> | null
}): NextEpisodePlan | null {
    const { current, natural, tags, skipFiller, lastEpisode, available } = options
    if (!natural) return null
    const plain: NextEpisodePlan = { episodeNumber: natural, skip: null }
    if (!skipFiller || !tags || !current || natural !== current + 1) return plain

    let target = natural
    let filler = false
    let recap = false
    // The map is finite, so an untagged episode always ends the walk.
    while (isSkippableEpisodeTag(tags.get(target))) {
        if (tags.get(target) === "filler") filler = true
        else recap = true
        target++
    }
    if (target === natural) return plain
    if (lastEpisode && target > lastEpisode) return plain
    if (available && !available.has(target)) return plain
    return {
        episodeNumber: target,
        skip: { from: natural, to: target - 1, kinds: filler && recap ? "both" : filler ? "filler" : "recap" },
    }
}

/** "skipping filler episodes 64–109", "skipping recap episode 12". */
export function describeEpisodeSkip(skip: NextEpisodeSkip): string {
    const what = skip.kinds === "both" ? "filler and recap" : skip.kinds
    return skip.from === skip.to
        ? `skipping ${what} episode ${skip.from}`
        : `skipping ${what} episodes ${skip.from}–${skip.to}`
}

/**
 * The next episode's line in the player: "Next: Episode 34 · FILLER", or with
 * a skip "Next: Episode 110 (skipping filler episodes 64–109)". `label` is the
 * episode's display title ("Episode 34").
 */
export function nextEpisodeLine(label: string, tag: EpisodeTagKind | undefined, skip: NextEpisodeSkip | null, prefix = "Next: "): string {
    let line = `${prefix}${label}`
    if (skip) line += ` (${describeEpisodeSkip(skip)})`
    // A CANON tag says nothing new next to the skip; filler, recap and MIX do.
    if (tag && (tag !== "canon" || !skip)) line += ` · ${EPISODE_TAG_LABELS[tag]}`
    return line
}
