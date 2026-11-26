/**
 * The build identity of a TV build: which version, release channel and commit it is.
 *
 *   stable   a release vX.Y.Z (.github/workflows/release.yml)
 *   nightly  the "nightly" pre-release, built from every push to main (nightly.yml)
 *   dev      any other build, e.g. `npm run build:webos` on a laptop (the default)
 *
 * webos/build.mjs embeds it in the app (EXPO_PUBLIC_BUILD_*, read by
 * src/lib/build-identity.ts for Settings and the update notice) and writes it as
 * build.json next to appinfo.json, so tools outside the app (a self-hoster's updater)
 * can read it from the installed app. Format: docs/releasing.md#release-channels.
 *
 * Inputs (environment): GARCESLAB_BUILD_CHANNEL (stable | nightly | dev, default dev) and
 * GARCESLAB_BUILD_COMMIT (the full commit SHA; required for stable and nightly, read from
 * git for dev builds when it isn't given).
 */
import { spawnSync } from "node:child_process"

export const BUILD_CHANNELS = ["stable", "nightly", "dev"]
const COMMIT_RE = /^[0-9a-f]{40}$/

/** The commit checked out in `cwd`, or null when git isn't there (e.g. a source tarball). */
export function gitHeadCommit(cwd) {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" })
    const commit = result.status === 0 ? result.stdout.trim() : ""
    return COMMIT_RE.test(commit) ? commit : null
}

/**
 * The identity of this build. Throws with a message when the channel is unknown or a
 * stable/nightly build has no valid commit, so CI never publishes an unidentified build.
 *
 * @param {{ version: string, env?: Record<string, string | undefined>, gitCommit?: () => string | null, now?: Date }} options
 */
export function resolveBuildIdentity({ version, env = {}, gitCommit = () => null, now = new Date() }) {
    const channel = (env.GARCESLAB_BUILD_CHANNEL ?? "").trim() || "dev"
    if (!BUILD_CHANNELS.includes(channel)) {
        throw new Error(`GARCESLAB_BUILD_CHANNEL "${channel}" is not one of ${BUILD_CHANNELS.join(", ")}`)
    }
    if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
        throw new Error(`The version "${version}" is not MAJOR.MINOR.PATCH`)
    }
    const given = (env.GARCESLAB_BUILD_COMMIT ?? "").trim().toLowerCase()
    if (given && !COMMIT_RE.test(given)) {
        throw new Error(`GARCESLAB_BUILD_COMMIT "${given}" is not a full 40-character commit SHA`)
    }
    const commit = given || (channel === "dev" ? gitCommit() : null)
    if (!commit && channel !== "dev") {
        throw new Error(`A ${channel} build needs GARCESLAB_BUILD_COMMIT (the full commit SHA it is built from)`)
    }
    return {
        version,
        channel,
        commit: commit ?? null,
        shortCommit: commit ? commit.slice(0, 7) : null,
        builtAt: now.toISOString(),
    }
}

/** Variables inlined into the app by the Expo export (only EXPO_PUBLIC_* are). */
export function buildIdentityEnv(identity) {
    return {
        EXPO_PUBLIC_BUILD_VERSION: identity.version,
        EXPO_PUBLIC_BUILD_CHANNEL: identity.channel,
        EXPO_PUBLIC_BUILD_COMMIT: identity.commit ?? "",
    }
}
