import { buildSeaQuery, useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Avatar, Profile, ProfileImportResult, ProfileSession } from "@/api/generated/types"

/**
 * Garceslab Anime: local profiles ("Who's watching?", "Create your profile").
 * The selector and setup routes work without a profile, so these run before
 * one is selected. Errors are shown by the screens (muteError).
 */

export function useGetProfiles(enabled = true) {
    return useServerQuery<Profile[]>({
        endpoint: API_ENDPOINTS.PROFILES.GetProfiles.endpoint,
        method: API_ENDPOINTS.PROFILES.GetProfiles.methods[0],
        queryKey: [API_ENDPOINTS.PROFILES.GetProfiles.key],
        enabled,
        muteError: true,
        // Never kept across launches: the picker always asks the server.
        gcTime: 0,
        refetchOnMount: "always",
    })
}

export function useGetAvatarCatalog(enabled = true) {
    return useServerQuery<Avatar[]>({
        endpoint: API_ENDPOINTS.PROFILES.GetAvatarCatalog.endpoint,
        method: API_ENDPOINTS.PROFILES.GetAvatarCatalog.methods[0],
        queryKey: [API_ENDPOINTS.PROFILES.GetAvatarCatalog.key],
        enabled,
        muteError: true,
        staleTime: Infinity,
    })
}

function withId(endpoint: string, id: number) {
    return endpoint.replace("{id}", String(id))
}

export function selectProfile(serverUrl: string | null, id: number, pin?: string) {
    return buildSeaQuery<ProfileSession, { pin: string }>({
        serverUrl,
        endpoint: withId(API_ENDPOINTS.PROFILES.SelectProfile.endpoint, id),
        method: "POST",
        data: pin ? { pin } : undefined,
        muteError: true,
    })
}

export function createProfile(serverUrl: string | null, input: { name: string; avatarId: string; pin?: string }) {
    return buildSeaQuery<Profile, typeof input>({
        serverUrl,
        endpoint: API_ENDPOINTS.PROFILES.CreateProfile.endpoint,
        method: "POST",
        data: input,
        muteError: true,
    })
}

export function logoutProfile(serverUrl: string | null, profileToken?: string) {
    return buildSeaQuery<boolean>({
        serverUrl,
        endpoint: API_ENDPOINTS.PROFILES.ProfileLogout.endpoint,
        method: "POST",
        muteError: true,
        profileToken,
    })
}

/*
 * Editing a profile needs a profile session (the server's user-data routes),
 * which "Who's watching?" doesn't have: the TV opens one for the profile being
 * edited (selectProfile, with its PIN) and sends its token with these.
 */

/** Renames the profile or changes its avatar. */
export function updateProfile(serverUrl: string | null, id: number, patch: { name?: string; avatarId?: string }, profileToken: string) {
    return buildSeaQuery<Profile, typeof patch>({
        serverUrl,
        endpoint: withId(API_ENDPOINTS.PROFILES.UpdateProfile.endpoint, id),
        method: "PATCH",
        data: patch,
        muteError: true,
        profileToken,
    })
}

/** Sets or changes the PIN, or removes it with null. The server then closes the profile's sessions. */
export function setProfilePin(serverUrl: string | null, id: number, pin: string | null, profileToken: string) {
    return buildSeaQuery<boolean, { pin: string | null }>({
        serverUrl,
        endpoint: withId(API_ENDPOINTS.PROFILES.SetProfilePin.endpoint, id),
        method: "PUT",
        data: { pin },
        muteError: true,
        profileToken,
    })
}

/** Moves the profile to the server's trash (restorable from the web for 30 days). */
export function deleteProfile(serverUrl: string | null, id: number, profileToken: string) {
    return buildSeaQuery<boolean>({
        serverUrl,
        endpoint: withId(API_ENDPOINTS.PROFILES.DeleteProfile.endpoint, id),
        method: "DELETE",
        muteError: true,
        profileToken,
    })
}

/** A public AniList list, by user name (no account or token). */
export function importAnilistList(serverUrl: string | null, id: number, username: string) {
    return buildSeaQuery<ProfileImportResult, { username: string; mode: string }>({
        serverUrl,
        endpoint: withId(API_ENDPOINTS.PROFILES_DATA.ImportProfileAnilist.endpoint, id),
        method: "POST",
        data: { username, mode: "merge" },
        muteError: true,
        // The server pages through the whole list.
        timeoutMs: 120_000,
    })
}

/** The list of the AniList account the server was using before profiles. */
export function importServerAccountList(serverUrl: string | null, id: number) {
    return buildSeaQuery<ProfileImportResult, { mode: string }>({
        serverUrl,
        endpoint: withId(API_ENDPOINTS.PROFILES_DATA.ImportProfileServerAccount.endpoint, id),
        method: "POST",
        data: { mode: "merge" },
        muteError: true,
        timeoutMs: 120_000,
    })
}

/** An avatar's image URL on the server (`/profile-avatars/<file>`, public). */
export function avatarImageUrl(serverUrl: string | null | undefined, path: string | null | undefined): string | null {
    if (!serverUrl || !path) return null
    if (/^https?:\/\//.test(path)) return path
    return serverUrl.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`)
}
