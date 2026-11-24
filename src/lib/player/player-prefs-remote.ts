import { buildSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { PlayerPrefs, TVPlayerPrefs } from "@/api/generated/types"
import { getPlayerPreferences, type PlayerPreferences, setPlayerPreferences, subscribePlayerPreferences } from "@/lib/player/player-preferences"
import { createPlayerPrefsSync } from "@/lib/player/player-prefs-sync"
import { getProfileSession, subscribeProfileSession } from "@/lib/profile/profile-session"

/**
 * Garceslab Anime: the player preferences follow the profile. Started when a
 * profile is entered (useProfileSwitch), stopped when its session ends.
 */
const ENDPOINTS = API_ENDPOINTS.PROFILES_PLAYER

let active: { profileId: number, sync: ReturnType<typeof createPlayerPrefsSync> } | null = null
let unsubscribePrefs: (() => void) | null = null
let unsubscribeSession: (() => void) | null = null

function stopActive() {
    active?.sync.stop()
    active = null
}

export function startProfilePlayerPrefsSync(serverUrl: string | null, profileId: number) {
    stopActive()
    const sync = createPlayerPrefsSync({
        fetchPrefs: () => buildSeaQuery<PlayerPrefs>({
            serverUrl,
            endpoint: ENDPOINTS.GetMyPlayerPrefs.endpoint,
            method: "GET",
            muteError: true,
        }),
        savePrefs: (tv: TVPlayerPrefs) => buildSeaQuery<PlayerPrefs, { tv: TVPlayerPrefs }>({
            serverUrl,
            endpoint: ENDPOINTS.PatchMyPlayerPrefs.endpoint,
            method: "PATCH",
            data: { tv },
            muteError: true,
        }),
        getLocal: () => getPlayerPreferences() as unknown as Record<string, unknown>,
        setLocal: next => setPlayerPreferences(next as unknown as Partial<PlayerPreferences>),
    })
    active = { profileId, sync }
    unsubscribePrefs ??= subscribePlayerPreferences(() => active?.sync.localChanged())
    unsubscribeSession ??= subscribeProfileSession(() => {
        // Left the profile (switch, expiry, refused token): stop saving to it.
        if (active && getProfileSession()?.profile.id !== active.profileId) stopActive()
    })
    void sync.load()
}
