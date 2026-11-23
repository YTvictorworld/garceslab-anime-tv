/**
 * Garceslab Anime: the profile this app is using on a server with local
 * profiles. The session token lives in memory only, never in MMKV or
 * localStorage, so every cold launch asks "Who's watching?" again; resuming
 * the app from the background keeps the JavaScript context, and the session.
 * Kept free of React Native so it can be unit tested.
 */
import type { Profile } from "@/api/generated/types"

export type ProfileSessionState = {
    token: string
    /** Unix seconds, from the server. */
    expiresAt: number
    profile: Profile
    /** When this app selected it (ms). */
    selectedAt: number
}

/** Why the session ended, for the picker's message. */
export type ProfileSessionEnd = "switch" | "expired" | "rejected"

let current: ProfileSessionState | null = null
let lastEnd: ProfileSessionEnd | null = null
let expiryTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function notify() {
    for (const listener of Array.from(listeners)) listener()
}

function clearExpiryTimer() {
    if (expiryTimer) clearTimeout(expiryTimer)
    expiryTimer = null
}

export function getProfileSession(): ProfileSessionState | null {
    return current
}

/** The X-Seanime-Profile value, or null without a profile. */
export function getProfileToken(): string | null {
    return current?.token ?? null
}

export function getProfileSessionEnd(): ProfileSessionEnd | null {
    return lastEnd
}

export function isProfileSessionExpired(session: Pick<ProfileSessionState, "expiresAt">, nowMs: number): boolean {
    return session.expiresAt > 0 && session.expiresAt * 1000 <= nowMs
}

export function setProfileSession(next: { profileToken: string; expiresAt: number; profile: Profile }, nowMs = Date.now()) {
    clearExpiryTimer()
    current = {
        token: next.profileToken,
        expiresAt: next.expiresAt,
        profile: next.profile,
        selectedAt: nowMs,
    }
    lastEnd = null
    if (next.expiresAt > 0) {
        // The server caps the session at 24 h; past that it answers PROFILE_REQUIRED anyway.
        const delay = Math.max(0, next.expiresAt * 1000 - nowMs)
        expiryTimer = setTimeout(() => endProfileSession("expired"), delay)
    }
    notify()
}

/** Ends the session (switching profile, expiry, or the server refused the token). */
export function endProfileSession(reason: ProfileSessionEnd) {
    clearExpiryTimer()
    if (!current) return
    current = null
    lastEnd = reason
    notify()
}

/** The profile itself changed (name, avatar) but the session didn't. */
export function updateSessionProfile(profile: Profile) {
    if (!current || current.profile.id !== profile.id) return
    current = { ...current, profile }
    notify()
}

export function subscribeProfileSession(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}
