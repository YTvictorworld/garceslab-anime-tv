import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { appUpdateNoticeAllowed, formatBuildLabel, readBuildIdentity } from "../src/lib/build-identity.ts"
import { buildIdentityEnv, resolveBuildIdentity } from "../webos/build-identity.mjs"

// The build identity (docs/releasing.md, "Release channels"): webos/build.mjs resolves it,
// embeds it in the app and writes build.json; Settings and the update notice read it.
const SHA = "0123456789abcdef0123456789abcdef01234567"
const NOW = new Date("2026-11-25T12:00:00.000Z")

test("Settings: stable shows only the version, nightly the short commit, dev says dev", () => {
    assert.equal(formatBuildLabel({ version: "1.0.0", channel: "stable", commit: SHA }), "v1.0.0")
    assert.equal(formatBuildLabel({ version: "1.0.0", channel: "nightly", commit: SHA }), "v1.0.0 · nightly (0123456)")
    assert.equal(formatBuildLabel({ version: "1.0.0", channel: "nightly", commit: null }), "v1.0.0 · nightly")
    assert.equal(formatBuildLabel({ version: "1.0.0", channel: "dev", commit: SHA }), "v1.0.0 · dev")
})

test("reading the embedded identity: unknown or missing values are a dev build", () => {
    assert.deepEqual(readBuildIdentity({}, "1.0.0"), { version: "1.0.0", channel: "dev", commit: null })
    assert.deepEqual(readBuildIdentity({ version: "1.2.3", channel: "nightly", commit: SHA.toUpperCase() }, "1.0.0"),
        { version: "1.2.3", channel: "nightly", commit: SHA })
    assert.equal(readBuildIdentity({ channel: "Stable" }, "1.0.0").channel, "dev")
    assert.equal(readBuildIdentity({ channel: "beta" }, "1.0.0").channel, "dev")
    assert.equal(readBuildIdentity({ channel: "stable", commit: "not-a-sha" }, "1.0.0").commit, null)
    // An empty embedded value (EXPO_PUBLIC_BUILD_COMMIT="") is no commit.
    assert.equal(readBuildIdentity({ channel: "dev", commit: "" }, "1.0.0").commit, null)
})

test("update notice: only stable TV builds check GitHub's latest release", () => {
    const identity = (channel: string) => readBuildIdentity({ channel, commit: SHA }, "1.0.0")
    assert.equal(appUpdateNoticeAllowed(identity("stable"), true), true)
    assert.equal(appUpdateNoticeAllowed(identity("nightly"), true), false)
    assert.equal(appUpdateNoticeAllowed(identity("dev"), true), false)
    assert.equal(appUpdateNoticeAllowed(identity(""), true), false)
    // Phone and native TV builds embed no channel and keep the check as before.
    assert.equal(appUpdateNoticeAllowed(identity(""), false), true)
})

test("the update prompt and Settings use the build identity", () => {
    const prompt = fs.readFileSync(new URL("../src/lib/app-release-updates.ts", import.meta.url), "utf8")
    assert.match(prompt, /appUpdateNoticeAllowed\(identity, Platform\.OS === "web"\)/)
    assert.match(prompt, /isManualOfflineModeEnabled\(\) \|\| !updateNoticeAllowed\(\)/)
    const settings = fs.readFileSync(new URL("../src/components/tv/tv-settings-screen.tsx", import.meta.url), "utf8")
    assert.match(settings, /formatBuildLabel\(embeddedBuildIdentity\(/)
    // Expo only inlines EXPO_PUBLIC_* read with dotted access.
    const source = fs.readFileSync(new URL("../src/lib/build-identity.ts", import.meta.url), "utf8")
    for (const name of Object.keys(buildIdentityEnv({ version: "1.0.0", channel: "dev", commit: null }))) {
        assert.match(source, new RegExp(`process\\.env\\.${name}\\b`))
    }
})

test("build: local builds are dev with the git commit, CI builds name their channel", () => {
    assert.deepEqual(resolveBuildIdentity({ version: "1.0.0", gitCommit: () => SHA, now: NOW }), {
        version: "1.0.0", channel: "dev", commit: SHA, shortCommit: "0123456", builtAt: "2026-11-25T12:00:00.000Z",
    })
    assert.deepEqual(resolveBuildIdentity({ version: "1.0.0", gitCommit: () => null, now: NOW }).commit, null)
    const nightly = resolveBuildIdentity({
        version: "1.0.0",
        env: { GARCESLAB_BUILD_CHANNEL: "nightly", GARCESLAB_BUILD_COMMIT: SHA },
        gitCommit: () => "f".repeat(40),
        now: NOW,
    })
    assert.equal(nightly.channel, "nightly")
    assert.equal(nightly.commit, SHA)
    assert.deepEqual(buildIdentityEnv(nightly), {
        EXPO_PUBLIC_BUILD_VERSION: "1.0.0", EXPO_PUBLIC_BUILD_CHANNEL: "nightly", EXPO_PUBLIC_BUILD_COMMIT: SHA,
    })
})

test("build: refuses an unknown channel, a bad commit and a stable/nightly build without a commit", () => {
    const resolve = (env: Record<string, string>, version = "1.0.0") => () => resolveBuildIdentity({ version, env, now: NOW })
    assert.throws(resolve({ GARCESLAB_BUILD_CHANNEL: "beta" }), /not one of stable, nightly, dev/)
    assert.throws(resolve({ GARCESLAB_BUILD_CHANNEL: "nightly" }), /needs GARCESLAB_BUILD_COMMIT/)
    assert.throws(resolve({ GARCESLAB_BUILD_CHANNEL: "stable" }), /needs GARCESLAB_BUILD_COMMIT/)
    assert.throws(resolve({ GARCESLAB_BUILD_CHANNEL: "stable", GARCESLAB_BUILD_COMMIT: "abc1234" }), /full 40-character/)
    assert.throws(resolve({}, "1.0.0-nightly"), /not MAJOR.MINOR.PATCH/)
})

test("build.mjs embeds the identity and writes build.json; the workflows set the channel", () => {
    const build = fs.readFileSync(new URL("../webos/build.mjs", import.meta.url), "utf8")
    assert.match(build, /Object\.assign\(process\.env, buildIdentityEnv\(identity\)\)/)
    assert.match(build, /path\.join\(appDir, "build\.json"\)/)
    // appinfo.json keeps the numeric package.json version.
    assert.match(build, /appinfo\.version = pkg\.version/)
    const release = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")
    assert.match(release, /GARCESLAB_BUILD_CHANNEL: stable\n\s+GARCESLAB_BUILD_COMMIT: \$\{\{ github\.sha \}\}/)
    const nightly = fs.readFileSync(new URL("../.github/workflows/nightly.yml", import.meta.url), "utf8")
    assert.match(nightly, /GARCESLAB_BUILD_CHANNEL: nightly\n\s+GARCESLAB_BUILD_COMMIT: \$\{\{ github\.sha \}\}/)
})
