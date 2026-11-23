/**
 * Garceslab Anime: the on-screen keyboard's layout and editing rules
 * (tv-on-screen-keyboard.tsx). Kept free of React Native so they can be unit
 * tested.
 */

export type KeyboardKey =
    | { kind: "char"; value: string }
    | { kind: "space" }
    | { kind: "backspace" }
    | { kind: "clear" }

const COLUMNS = 6
const CHARACTERS = "abcdefghijklmnopqrstuvwxyz0123456789"

let rows: KeyboardKey[][] | null = null

/** A-Z and 0-9 in rows of six, then Space, Delete and Clear. */
export function keyboardRows(): KeyboardKey[][] {
    if (rows) return rows
    const built: KeyboardKey[][] = []
    for (let i = 0; i < CHARACTERS.length; i += COLUMNS) {
        built.push(CHARACTERS.slice(i, i + COLUMNS).split("").map(value => ({ kind: "char", value })))
    }
    built.push([{ kind: "space" }, { kind: "backspace" }, { kind: "clear" }])
    rows = built
    return built
}

export type KeyboardOptions = {
    maxLength?: number
    capitalize?: "none" | "words"
}

export function applyKeyboardKey(value: string, key: KeyboardKey, options: KeyboardOptions = {}): string {
    const full = options.maxLength !== undefined && value.length >= options.maxLength
    switch (key.kind) {
        case "clear":
            return ""
        case "backspace":
            return value.slice(0, -1)
        case "space":
            // No leading or double spaces: they would only make an empty-looking query.
            if (full || value.length === 0 || value.endsWith(" ")) return value
            return value + " "
        case "char": {
            if (full) return value
            const startsWord = value.length === 0 || value.endsWith(" ")
            const character = options.capitalize === "words" && startsWord ? key.value.toUpperCase() : key.value
            return value + character
        }
    }
}

/** The character a physical key types on the keyboard, or null for keys it ignores. */
export function typedCharacter(key: string): string | null {
    if (key === " " || key === "Spacebar") return " "
    if (key.length !== 1) return null
    const lower = key.toLowerCase()
    return CHARACTERS.includes(lower) ? lower : null
}

/** Search as you type: the query to run for what is typed, or null for none yet. */
export function searchQueryFor(text: string, minLength = 2): string | null {
    const trimmed = text.trim()
    return trimmed.length >= minLength ? trimmed : null
}

/** How long typing has to pause before the search runs. */
export const SEARCH_DEBOUNCE_MS = 250
