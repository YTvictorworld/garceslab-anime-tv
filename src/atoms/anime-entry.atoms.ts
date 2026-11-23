import { atom } from "jotai"
import type { AnimeEntryLaunchView } from "@/lib/player/types"

export type AnimeEntryPlaybackIntentKind =
    | "play-local-episode"
    | "torrentstream-auto-select"
    | "torrentstream-previous-batch"
    | "debridstream-auto-select"
    | "debridstream-previous-batch"
    | "onlinestream-play"
    /** Torrent/debrid: as if the episode were pressed on the show's page (auto-select, previous batch or picker, per the settings). */
    | "stream-episode-press"

export type AnimeEntryPlaybackIntent = {
    id: string
    mediaId: number
    episodeNumber: number
    kind: AnimeEntryPlaybackIntentKind
}

export const animeEntryPlaybackIntentAtom = atom<AnimeEntryPlaybackIntent | null>(null)

export type TVReturnFocus = {
    mediaId: number
    episodeNumber: number
    view?: AnimeEntryLaunchView
}

export const tvReturnFocusAtom = atom<TVReturnFocus | null>(null)

export function createAnimeEntryPlaybackIntent(intent: Omit<AnimeEntryPlaybackIntent, "id">): AnimeEntryPlaybackIntent {
    return {
        ...intent,
        id: `${intent.kind}-${intent.mediaId}-${intent.episodeNumber}-${Date.now()}`,
    }
}
