/**
 * Garceslab Anime: the stable error codes a server with local profiles
 * answers with, and what the TV says for them. Kept free of React Native so
 * it can be unit tested.
 */

/** No (valid) profile on a route that needs one: back to "Who's watching?". */
export function isProfileRequiredError(message: string | null | undefined): boolean {
    return message === "PROFILE_REQUIRED" || message === "PROFILE_INVALID_TOKEN"
}

/** The message to show for a profile error code, or null when it isn't one. */
export function profileErrorMessage(message: string | null | undefined, retryAfterSeconds?: number | null): string | null {
    switch (message) {
        case "PLAYBACK_BUSY":
            return "Another playback is in progress. Stop it first, then try again."
        case "PROFILE_REQUIRED":
        case "PROFILE_INVALID_TOKEN":
            return "Choose a profile to continue."
        case "PROFILE_PIN_LOCKED":
            return retryAfterSeconds && retryAfterSeconds > 0
                ? `Too many wrong PINs. Try again in ${formatWait(retryAfterSeconds)}.`
                : "Too many wrong PINs. Try again in a few minutes."
        case "PROFILE_WRONG_PIN":
            return "Wrong PIN. Try again."
        case "PROFILE_PIN_REQUIRED":
            return "Enter this profile's PIN."
        case "PROFILE_INVALID_PIN":
            return "The PIN must be 4 to 6 digits."
        case "PROFILE_NAME_TAKEN":
            return "Another profile already has this name."
        case "PROFILE_INVALID_NAME":
            return "Enter a name (up to 32 characters)."
        case "PROFILE_INVALID_AVATAR":
            return "Choose an avatar."
        case "PROFILE_NOT_FOUND":
        case "PROFILE_DELETED":
            return "This profile no longer exists."
        case "PROFILE_IMPORT_INVALID_USERNAME":
            return "That isn't a valid AniList user name."
        case "PROFILE_IMPORT_LIST_UNAVAILABLE":
            return "That AniList list is private or the user doesn't exist."
        case "PROFILE_IMPORT_NOTHING_TO_IMPORT":
            return "There was nothing to import."
        case "PROFILE_NO_CLIENT_ID":
            return "The server didn't recognise this TV yet. Try again."
        default:
            return null
    }
}

function formatWait(seconds: number): string {
    if (seconds < 60) return `${Math.ceil(seconds)} seconds`
    const minutes = Math.ceil(seconds / 60)
    return minutes === 1 ? "1 minute" : `${minutes} minutes`
}

/** The profiles block of /status: only a server that advertises it gets the picker. */
export function serverHasProfiles(status: { profiles?: { enabled?: boolean } | null } | null | undefined): boolean {
    return !!status?.profiles?.enabled
}

/** PIN entry: 4 to 6 digits (the server's rule). */
export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 6

export function appendPinDigit(pin: string, digit: string): string {
    if (!/^[0-9]$/.test(digit) || pin.length >= PIN_MAX_LENGTH) return pin
    return pin + digit
}
