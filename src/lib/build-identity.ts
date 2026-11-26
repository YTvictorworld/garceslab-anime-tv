// Which build of the app this is: version, release channel and commit (docs/releasing.md,
// "Release channels"). webos/build.mjs embeds them at build time (EXPO_PUBLIC_BUILD_*,
// computed by webos/build-identity.mjs) and writes the same values to build.json in the app
// directory. Pure (no react-native imports) so tests/build-identity.test.ts can import it.

export type BuildChannel = "stable" | "nightly" | "dev"

export type BuildIdentity = {
    version: string
    channel: BuildChannel
    /** Full commit SHA, or null when the build didn't know it (a dev build without git). */
    commit: string | null
}

type RawBuildIdentity = {
    version?: string
    channel?: string
    commit?: string
}

const CHANNELS: readonly BuildChannel[] = ["stable", "nightly", "dev"]

/**
 * The identity from the embedded values. Anything missing or unknown counts as a dev build,
 * so a build that wasn't made by CI never claims to be stable (and never shows the stable
 * update notice).
 */
export function readBuildIdentity(raw: RawBuildIdentity, fallbackVersion: string): BuildIdentity {
    const channel = CHANNELS.find(value => value === raw.channel?.trim()) ?? "dev"
    const commit = raw.commit?.trim().toLowerCase() ?? ""
    return {
        version: raw.version?.trim() || fallbackVersion,
        channel,
        commit: /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
    }
}

/** The version line in Settings: "v1.0.0", "v1.0.0 · nightly (abc1234)" or "v1.0.0 · dev". */
export function formatBuildLabel(identity: BuildIdentity): string {
    const version = `v${identity.version}`
    switch (identity.channel) {
        case "stable":
            return version
        case "nightly":
            return identity.commit ? `${version} · nightly (${identity.commit.slice(0, 7)})` : `${version} · nightly`
        default:
            return `${version} · dev`
    }
}

/**
 * Whether the in-app "App update available" check (app-release-updates.ts, which follows
 * this repository's latest stable release) may run. On the TV builds only a stable build
 * does: a nightly is newer than the latest stable release by definition, and a dev build
 * is someone's own build. Phone and native TV builds don't embed a channel and keep the
 * check as before.
 */
export function appUpdateNoticeAllowed(identity: BuildIdentity, isWebBuild: boolean): boolean {
    return !isWebBuild || identity.channel === "stable"
}

/** This build's identity, as embedded by the Expo export (dotted access so it is inlined). */
export function embeddedBuildIdentity(fallbackVersion: string): BuildIdentity {
    return readBuildIdentity({
        version: process.env.EXPO_PUBLIC_BUILD_VERSION,
        channel: process.env.EXPO_PUBLIC_BUILD_CHANNEL,
        commit: process.env.EXPO_PUBLIC_BUILD_COMMIT,
    }, fallbackVersion)
}
