import { getProfileSession, type ProfileSessionState, subscribeProfileSession } from "@/lib/profile/profile-session"
import { atom, useAtomValue } from "jotai"

/**
 * Garceslab Anime: the selected profile's session. A plain atom (no
 * atomWithStorage) mirroring the in-memory session in profile-session.ts,
 * which request headers read outside React: the token is never saved.
 */
const profileSessionBaseAtom = atom<ProfileSessionState | null>(getProfileSession())
profileSessionBaseAtom.onMount = (set) => {
    set(getProfileSession())
    return subscribeProfileSession(() => set(getProfileSession()))
}

export const profileSessionAtom = atom(get => get(profileSessionBaseAtom))
export const profileTokenAtom = atom(get => get(profileSessionBaseAtom)?.token ?? null)

export function useProfileSession() {
    return useAtomValue(profileSessionAtom)
}

export function useProfileToken() {
    return useAtomValue(profileTokenAtom)
}
