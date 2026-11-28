/**
 * Garceslab Anime: the default subtitle languages, and moving devices and
 * profiles that still have the previous default to the new one (issue #11
 * follow-up). Free of React Native so it can be unit tested.
 *
 * Latin American Spanish first, then any Spanish, English as the fallback
 * (track-matching.ts gives the regional tag its meaning). Seanime Tenji's
 * default was English only.
 */
export const DEFAULT_SUBTITLE_LANGUAGES = "es-419, spa, es, spanish, eng, en, english"

/** The default this app shipped before (and every profile was seeded with). */
export const PREVIOUS_DEFAULT_SUBTITLE_LANGUAGES = "eng, en, english"

/** Stored in the device's preferences once they went through the migration. */
export const SUBTITLE_DEFAULT_VERSION = 2

function normalisedList(value: string) {
    return value.split(",").map(part => part.trim().toLowerCase()).filter(Boolean).join(",")
}

/**
 * Whether a saved value is the previous default. The app can't tell a value
 * nobody changed from one typed in by hand, so the exact previous list
 * (ignoring case and spaces) counts as never customised.
 */
export function isPreviousSubtitleDefault(value: unknown): boolean {
    return typeof value === "string" && normalisedList(value) === normalisedList(PREVIOUS_DEFAULT_SUBTITLE_LANGUAGES)
}

/**
 * The device's saved preferences after the one-time migration, or null when
 * there is nothing to change (already migrated). Only the subtitle languages
 * change, and only when they are the previous default.
 */
export function migrateDeviceSubtitleDefault<T extends Record<string, unknown>>(stored: T): (T & { subtitleDefaultVersion: number }) | null {
    const version = stored.subtitleDefaultVersion
    if (typeof version === "number" && version >= SUBTITLE_DEFAULT_VERSION) return null
    const next: Record<string, unknown> = { ...stored, subtitleDefaultVersion: SUBTITLE_DEFAULT_VERSION }
    if (isPreviousSubtitleDefault(stored.preferredSubtitleLanguages)) next.preferredSubtitleLanguages = DEFAULT_SUBTITLE_LANGUAGES
    return next as T & { subtitleDefaultVersion: number }
}
