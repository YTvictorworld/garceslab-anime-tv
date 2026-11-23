import type { Profile, ProfileSession } from "@/api/generated/types"
import { logoutProfile } from "@/api/hooks/profiles.hooks"
import { useServerUrl, useSetServerStatus } from "@/atoms/server.atoms"
import { endKeptStream } from "@/lib/player/kept-direct-stream"
import { endProfileSession, setProfileSession } from "@/lib/profile/profile-session"
import { switchQueryCacheProfile } from "@/lib/query-persistence"
import { useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import * as React from "react"

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
        // The saved status is the previous profile's (its settings, its user).
        void setServerStatus(null)
        router.replace("/(app)/(tabs)/(library)")
    }, [queryClient, setServerStatus])

    const switchProfile = React.useCallback(() => {
        // A stream the player left belongs to this profile's playback.
        endKeptStream("terminate")
        void logoutProfile(serverUrl).catch(() => undefined)
        endProfileSession("switch")
        switchQueryCacheProfile(queryClient, null)
        void setServerStatus(null)
        router.replace("/(out)/select-profile")
    }, [queryClient, serverUrl, setServerStatus])

    return { enterProfile, switchProfile }
}
