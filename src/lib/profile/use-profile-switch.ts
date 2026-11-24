import type { Profile, ProfileSession } from "@/api/generated/types"
import { logoutProfile } from "@/api/hooks/profiles.hooks"
import { useServerUrl, useSetServerStatus } from "@/atoms/server.atoms"
import { endKeptStream } from "@/lib/player/kept-direct-stream"
import { startProfilePlayerPrefsSync } from "@/lib/player/player-prefs-remote"
import { endProfileSession, setProfileSession } from "@/lib/profile/profile-session"
import { switchQueryCacheProfile } from "@/lib/query-persistence"
import { useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import * as React from "react"

/** A profile opened by the nav bar's switcher, entered by the select-profile route (changeProfile). */
let pendingEntry: { session: ProfileSession; profile: Profile } | null = null

/** The switcher's profile to enter, once. */
export function takePendingProfileEntry(): { session: ProfileSession; profile: Profile } | null {
    if (!pendingEntry) return null
    const entry = { session: pendingEntry.session, profile: pendingEntry.profile }
    pendingEntry = null
    return entry
}

/**
 * Garceslab Anime: entering and leaving a profile. Each one starts from an
 * empty cache (and its own saved responses), so nothing of the previous
 * profile is shown.
 */
export function useProfileSwitch() {
    const queryClient = useQueryClient()
    const setServerStatus = useSetServerStatus()
    const serverUrl = useServerUrl()

    const enterProfile = React.useCallback((session: ProfileSession, selected: Profile) => {
        const profile = session.profile ?? selected
        setProfileSession({ profileToken: session.profileToken, expiresAt: session.expiresAt, profile })
        switchQueryCacheProfile(queryClient, profile.id)
        // The profile's player preferences replace this TV's (phase 4).
        startProfilePlayerPrefsSync(serverUrl, profile.id)
        // The saved status is the previous profile's (its settings, its user).
        void setServerStatus(null)
        router.replace("/(app)/(tabs)/(library)")
    }, [queryClient, serverUrl, setServerStatus])

    const switchProfile = React.useCallback(() => {
        // A stream the player left belongs to this profile's playback.
        endKeptStream("terminate")
        void logoutProfile(serverUrl).catch(() => undefined)
        endProfileSession("switch")
        switchQueryCacheProfile(queryClient, null)
        void setServerStatus(null)
        router.replace("/(out)/select-profile")
    }, [queryClient, serverUrl, setServerStatus])

    /**
     * Straight from one profile to another (the nav bar's profile switcher).
     * The new session is already open (the server moved this TV to it when it
     * was selected), so nothing is logged out. The app still passes through
     * the select-profile route, which enters it at once without showing the
     * picker: the screens of the previous profile unmount there, as they do
     * after "Switch profile", instead of staying mounted on an emptied cache.
     */
    const changeProfile = React.useCallback((session: ProfileSession, selected: Profile) => {
        endKeptStream("terminate")
        pendingEntry = { session, profile: selected }
        router.replace("/(out)/select-profile")
    }, [])

    return { enterProfile, switchProfile, changeProfile }
}
