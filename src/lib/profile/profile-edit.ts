/**
 * Garceslab Anime: the rules of "Edit profile" on the TV, kept free of React
 * Native so they can be unit tested. The server checks the same things; these
 * only spare a request and give the message right away.
 */

/** The server's limit (profiles.MaxNameLength), in characters. */
export const PROFILE_NAME_MAX_LENGTH = 32

/** How long a deleted profile stays in the server's trash (profiles.TrashRetention). */
export const PROFILE_TRASH_DAYS = 30

export type NameCheck = { ok: true; name: string } | { ok: false; message: string }

/**
 * The name to save, or why it can't be. Names are unique without regard to
 * case among the other profiles (the server's COLLATE NOCASE).
 */
export function checkProfileName(input: string, otherNames: readonly string[]): NameCheck {
    const name = input.trim()
    if (!name) return { ok: false, message: "Enter a name." }
    if (Array.from(name).length > PROFILE_NAME_MAX_LENGTH) {
        return { ok: false, message: `Use up to ${PROFILE_NAME_MAX_LENGTH} characters.` }
    }
    const lower = name.toLowerCase()
    if (otherNames.some(other => other.trim().toLowerCase() === lower)) {
        return { ok: false, message: "Another profile already has this name." }
    }
    return { ok: true, name }
}

/** What changed, as the PATCH body, or null when there is nothing to send. */
export function profilePatch(
    current: { name: string; avatarId: string },
    next: { name?: string; avatarId?: string },
): { name?: string; avatarId?: string } | null {
    const patch: { name?: string; avatarId?: string } = {}
    if (next.name !== undefined && next.name.trim() !== current.name) patch.name = next.name.trim()
    if (next.avatarId !== undefined && next.avatarId !== current.avatarId) patch.avatarId = next.avatarId
    return Object.keys(patch).length > 0 ? patch : null
}

/** The delete confirmation, matching the server's trash. */
export function deleteProfileQuestion(name: string) {
    return {
        title: `Delete ${name}?`,
        text: `${name} goes to the trash with its list, history and settings. `
            + `It can be restored from the web (Settings, Profiles) for ${PROFILE_TRASH_DAYS} days, then it is deleted for good.`,
    }
}

/** The PIN row of "Edit profile": what it says and what OK does. */
export function pinActions(hasPin: boolean): { kind: "set" | "change" | "remove"; label: string; detail: string }[] {
    if (!hasPin) {
        return [{ kind: "set", label: "Add a PIN", detail: "Asked before entering or editing this profile" }]
    }
    return [
        { kind: "change", label: "Change the PIN", detail: "Type a new 4 to 6 digit PIN" },
        { kind: "remove", label: "Remove the PIN", detail: "Anyone can then enter this profile" },
    ]
}
