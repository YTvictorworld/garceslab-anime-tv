import type { MpvVideoOutput } from "expo-mpv-player"
import React from "react"
import { createMMKV } from "react-native-mmkv"
import { DEFAULT_SUBTITLE_LANGUAGES, migrateDeviceSubtitleDefault, SUBTITLE_DEFAULT_VERSION } from "./subtitle-defaults"

const storage = createMMKV({ id: "seanime-player-prefs" })

/**
 * Player preferences persisted across sessions via MMKV.
 */
export type PlayerPreferences = {
    /** Playback speed multiplier (0.25 – 4.0). Default 1.0. */
    speed: number
    /** Subtitle delay in seconds. Positive = later, negative = earlier. Default 0. */
    subtitleDelay: number
    /** Audio delay in seconds. Default 0. */
    audioDelay: number
    /** Subtitle font size override (20 – 100). Default 48. */
    subtitleFontSize: number
    /** Whether to auto-play when source loads. Default true. */
    autoPlay: boolean
    /** Skip intro/outro seconds. Default 85. */
    skipDurationSec: number
    /** Whether to show subtitles by default. Default true. */
    showSubtitles: boolean
    /**
     * Comma-separated language tags to prefer for the default audio track.
     * e.g. "jpn, jp, ja, japanese". First match wins.
     */
    preferredAudioLanguages: string
    /**
     * Comma-separated language tags to prefer for the default subtitle track.
     * e.g. "eng, en, english". First match wins.
     * Garceslab Anime: Spanish first by default (subtitle-defaults.ts).
     */
    preferredSubtitleLanguages: string
    /** Garceslab Anime: this device's preferences went through the subtitle default migration (not synced). */
    subtitleDefaultVersion: number
    ignoredSubtitleLabels: string
    /** Seek amount in seconds for double-tap gestures. Default 3. */
    doubleTapSeekSec: number
    /** Seek amount in seconds for forward/back controls. Default 3. */
    buttonSeekSec: number
    /** Speed multiplier for long-press fast forward. Default 2.0. */
    longPressFastForwardSpeed: number
    /** Whether the player should automatically advance near the end of an episode. */
    autoNextEpisode: boolean
    /**
     * Garceslab Anime: "next episode" (auto next and the Next button) jumps
     * over filler and recap episodes, when the anime's episode tags are known.
     */
    skipFillerEpisodes: boolean
    /** Whether tapping the center of the screen toggles play/pause. */
    centerTapPlayPause: boolean
    /** Whether side vertical swipes adjust brightness and volume. */
    sideSwipeBrightnessVolume: boolean
    // playbackBrightness: number | null
    autoSkipOpEd: boolean
    /** User-provided Wyzie Subs API key for external subtitle search. */
    wyzieApiKey: string
    /**
     * URL template for an external player, e.g. `vlc://{url}` or a custom scheme.
     * Null means use the built-in mpv player.
     */
    externalPlayerTemplate: string | null
    /** mpv video output. gpu-next is the default. */
    androidVideoOutput: MpvVideoOutput
    /** Whether to show live playback diagnostics over the video. */
    showStats: boolean
    /**
     * webOS player: draw ASS subtitles with libass (fonts, styling, signs and
     * positioning) rather than as plain text lines. mpv always uses libass.
     */
    assRendering: boolean
}

const DEFAULTS: PlayerPreferences = {
    speed: 1.0,
    subtitleDelay: 0,
    audioDelay: 0,
    subtitleFontSize: 48,
    autoPlay: true,
    skipDurationSec: 85,
    showSubtitles: true,
    preferredAudioLanguages: "jpn, jp, ja, japanese",
    preferredSubtitleLanguages: DEFAULT_SUBTITLE_LANGUAGES,
    subtitleDefaultVersion: SUBTITLE_DEFAULT_VERSION,
    ignoredSubtitleLabels: "signs & songs, signs, songs, sign, song",
    doubleTapSeekSec: 3,
    buttonSeekSec: 3,
    longPressFastForwardSpeed: 2.0,
    autoNextEpisode: true,
    skipFillerEpisodes: false,
    centerTapPlayPause: true,
    sideSwipeBrightnessVolume: true,
    // playbackBrightness: null,
    autoSkipOpEd: false,
    wyzieApiKey: "",
    externalPlayerTemplate: null,
    androidVideoOutput: "gpu-next",
    showStats: false,
    assRendering: true,
}

const STORAGE_KEY = "player-prefs"

/**
 * Read persisted player preferences. Missing keys are filled with defaults.
 */
export function getPlayerPreferences(): PlayerPreferences {
    const raw = storage.getString(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    try {
        const parsed = JSON.parse(raw) as Partial<PlayerPreferences>
        // Garceslab Anime: the previous English-only default becomes the new one, once.
        const migrated = migrateDeviceSubtitleDefault(parsed as Record<string, unknown>) as Partial<PlayerPreferences> | null
        if (migrated) {
            storage.set(STORAGE_KEY, JSON.stringify(migrated))
            return { ...DEFAULTS, ...migrated }
        }
        return { ...DEFAULTS, ...parsed }
    }
    catch {
        return { ...DEFAULTS }
    }
}

/**
 * Persist a partial update to player preferences.
 */
export function setPlayerPreferences(update: Partial<PlayerPreferences>) {
    const current = getPlayerPreferences()
    const next = { ...current, ...update }
    storage.set(STORAGE_KEY, JSON.stringify(next))
    for (const listener of Array.from(changeListeners)) listener()
}

// Garceslab Anime: the profile sync (player-prefs-remote.ts) saves changes to the server.
const changeListeners = new Set<() => void>()

/**
 * Garceslab Anime: which profiles (per server) this TV has checked for the
 * previous subtitle default (player-prefs-sync.ts), so a value set later by
 * hand is never migrated.
 */
const PROFILE_MIGRATION_KEY = "subtitle-default-migrated-profiles"

function migratedProfiles(): string[] {
    try {
        const list = JSON.parse(storage.getString(PROFILE_MIGRATION_KEY) ?? "[]")
        return Array.isArray(list) ? list.filter(item => typeof item === "string") : []
    }
    catch {
        return []
    }
}

export function isProfileSubtitleDefaultChecked(profileKey: string): boolean {
    return migratedProfiles().includes(profileKey)
}

export function markProfileSubtitleDefaultChecked(profileKey: string) {
    const list = migratedProfiles()
    if (list.includes(profileKey)) return
    storage.set(PROFILE_MIGRATION_KEY, JSON.stringify([...list, profileKey]))
}

export function subscribePlayerPreferences(listener: () => void): () => void {
    changeListeners.add(listener)
    return () => {
        changeListeners.delete(listener)
    }
}

export function usePlayerPreferences() {
    const [prefs, setPrefsState] = React.useState(getPlayerPreferences)

    const updatePrefs = React.useCallback((update: Partial<PlayerPreferences>) => {
        setPrefsState((prev: PlayerPreferences) => {
            const next = { ...prev, ...update }
            setPlayerPreferences(next)
            return next
        })
    }, [])

    return [prefs, updatePrefs] as const
}

///////////////////////////////////////////////////////////////////////////////
// Track matching
///////////////////////////////////////////////////////////////////////////////

// Garceslab Anime: the matching lives in a pure module (unit tested); it compares
// canonical language codes instead of substrings (issue #11).
export { findFallbackTrack, findPreferredTrack } from "./track-matching"
