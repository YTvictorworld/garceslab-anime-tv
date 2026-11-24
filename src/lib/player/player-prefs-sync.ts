/**
 * Garceslab Anime: the player preferences that follow the profile. The server
 * keeps them per profile (GET/PATCH /api/v1/profiles/me/player-prefs, section
 * "tv"); this module decides which local preferences are synced and keeps the
 * device and the server in step. Device-bound preferences (video output,
 * external player, gestures, API keys, per-file delays, stats) stay local.
 * Free of React Native so it can be unit tested; player-prefs-remote.ts wires it.
 */
import type { TVPlayerPrefs } from "@/api/generated/types"

/** The synced keys and the type each one must have. */
export const SYNCED_PLAYER_PREF_TYPES = {
    preferredAudioLanguages: "string",
    preferredSubtitleLanguages: "string",
    ignoredSubtitleLabels: "string",
    showSubtitles: "boolean",
    subtitleFontSize: "number",
    assRendering: "boolean",
    autoPlay: "boolean",
    autoNextEpisode: "boolean",
    autoSkipOpEd: "boolean",
    skipDurationSec: "number",
    buttonSeekSec: "number",
    doubleTapSeekSec: "number",
    speed: "number",
    longPressFastForwardSpeed: "number",
} as const satisfies Record<keyof TVPlayerPrefs, "string" | "number" | "boolean">

export type SyncedPlayerPrefKey = keyof typeof SYNCED_PLAYER_PREF_TYPES

export const SYNCED_PLAYER_PREF_KEYS = Object.keys(SYNCED_PLAYER_PREF_TYPES) as SyncedPlayerPrefKey[]

function validValue(key: SyncedPlayerPrefKey, value: unknown): boolean {
    const type = SYNCED_PLAYER_PREF_TYPES[key]
    if (type === "number") return typeof value === "number" && Number.isFinite(value)
    return typeof value === type
}

/** The synced part of the local preferences (valid values only). */
export function pickSyncedPlayerPrefs(prefs: Record<string, unknown>): TVPlayerPrefs {
    const out: Record<string, unknown> = {}
    for (const key of SYNCED_PLAYER_PREF_KEYS) {
        if (validValue(key, prefs[key])) out[key] = prefs[key]
    }
    return out as TVPlayerPrefs
}

/** The local preferences with the profile's saved values on top. */
export function mergeServerPlayerPrefs<T extends Record<string, unknown>>(local: T, server: TVPlayerPrefs | null | undefined): T {
    if (!server) return local
    const next: Record<string, unknown> = { ...local }
    for (const key of SYNCED_PLAYER_PREF_KEYS) {
        const value = (server as Record<string, unknown>)[key]
        if (validValue(key, value)) next[key] = value
    }
    return next as T
}

/** The synced values that differ between two snapshots (what to save). */
export function changedSyncedPlayerPrefs(prev: TVPlayerPrefs, next: TVPlayerPrefs): TVPlayerPrefs | null {
    const out: Record<string, unknown> = {}
    let changed = false
    for (const key of SYNCED_PLAYER_PREF_KEYS) {
        const a = (prev as Record<string, unknown>)[key]
        const b = (next as Record<string, unknown>)[key]
        if (b !== undefined && a !== b) {
            out[key] = b
            changed = true
        }
    }
    return changed ? out as TVPlayerPrefs : null
}

function hasAny(prefs: TVPlayerPrefs | null | undefined) {
    return !!prefs && SYNCED_PLAYER_PREF_KEYS.some(key => (prefs as Record<string, unknown>)[key] !== undefined)
}

export type PlayerPrefsSyncDeps = {
    fetchPrefs: () => Promise<{ tv?: TVPlayerPrefs } | null | undefined>
    savePrefs: (tv: TVPlayerPrefs) => Promise<unknown>
    getLocal: () => Record<string, unknown>
    setLocal: (next: Record<string, unknown>) => void
    /** setTimeout-like; returns a cancel function. */
    schedule?: (fn: () => void, ms: number) => () => void
    saveDelayMs?: number
}

/**
 * One profile's sync: `load()` when the profile is entered (the server's values
 * replace the device's; a profile without saved values takes the device's as
 * its first copy), `localChanged()` after the device's preferences change
 * (saved after a short pause), `stop()` when the profile is left.
 */
export function createPlayerPrefsSync(deps: PlayerPrefsSyncDeps) {
    const schedule = deps.schedule ?? ((fn, ms) => {
        const t = setTimeout(fn, ms)
        return () => clearTimeout(t)
    })
    const delay = deps.saveDelayMs ?? 1500
    let synced: TVPlayerPrefs | null = null
    let stopped = false
    let cancelPending: (() => void) | null = null

    async function load() {
        let server: { tv?: TVPlayerPrefs } | null | undefined
        try {
            server = await deps.fetchPrefs()
        }
        catch {
            // Old server or offline: keep the device's preferences and don't save.
            return false
        }
        if (stopped) return false
        const local = deps.getLocal()
        if (hasAny(server?.tv)) {
            const merged = mergeServerPlayerPrefs(local, server!.tv)
            synced = pickSyncedPlayerPrefs(merged)
            deps.setLocal(merged)
        } else {
            synced = pickSyncedPlayerPrefs(local)
            void deps.savePrefs(synced).catch(() => undefined)
        }
        return true
    }

    function localChanged() {
        if (stopped || !synced) return
        cancelPending?.()
        cancelPending = schedule(() => {
            cancelPending = null
            if (stopped || !synced) return
            const next = pickSyncedPlayerPrefs(deps.getLocal())
            const patch = changedSyncedPlayerPrefs(synced, next)
            if (!patch) return
            synced = next
            void deps.savePrefs(patch).catch(() => undefined)
        }, delay)
    }

    function stop() {
        stopped = true
        cancelPending?.()
        cancelPending = null
    }

    return { load, localChanged, stop, isLoaded: () => !!synced && !stopped }
}
