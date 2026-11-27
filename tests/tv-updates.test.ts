import assert from "node:assert/strict"
import test from "node:test"
import {
    BANNER_FIRST_DELAY_MS,
    BANNER_IDLE_MS,
    bannerMayAppear,
    buildDescription,
    changeCountsLabel,
    formatBuildDate,
    groupChanges,
    INSTALLING_POLL_MS,
    installErrorMessage,
    lastResultLabel,
    nonEmptyGroups,
    parseActionResponse,
    parseTVUpdatesResponse,
    pendingBuildKey,
    pendingSummary,
    settingsUpdateRows,
    STATUS_POLL_MS,
    statusPollInterval,
    type TVUpdateChange,
    type TVUpdatePending,
    type TVUpdatesState,
    updateBannerDecision,
    watchInstall,
} from "../src/lib/tv-updates/tv-updates.ts"

const PENDING_SHA = "0eff7761111111111111111111111111111111aa"
const INSTALLED_SHA = "808b9ee2222222222222222222222222222222bb"

// The updater's GET /status as documented in the updater's README (contract for server #18).
function updaterStatus(overrides: Record<string, unknown> = {}) {
    return {
        channel: "nightly",
        installed: { version: "1.0.0", commit: INSTALLED_SHA, shortCommit: "808b9ee", channel: "nightly", builtAt: "2026-11-25T10:00:00.000Z" },
        pending: {
            version: "1.0.0",
            commit: PENDING_SHA,
            shortCommit: "0eff776",
            builtAt: "2026-11-26T19:03:40.416Z",
            channel: "nightly",
            changes: [
                { type: "fix", title: "Spanish subtitles selected at start", pr: 20, url: "https://example.invalid/pull/20" },
                { type: "feat", title: "Seasons tabs", pr: 21, url: "https://example.invalid/pull/21" },
                { type: "internal", title: "ci tweak", pr: 22 },
                { type: "perf", title: "Faster home", pr: 23 },
            ],
            changesComplete: true,
        },
        tvOnline: true,
        installing: false,
        installPhase: null,
        appWillClose: true,
        lastResult: { at: "2026-11-25T10:05:00.000Z", ok: true, version: "1.0.0", commit: INSTALLED_SHA, shortCommit: "808b9ee", error: null },
        ...overrides,
    }
}

function ready(overrides: Record<string, unknown> = {}): TVUpdatesState {
    return parseTVUpdatesResponse({ configured: true, reachable: true, status: updaterStatus(overrides) })
}

function changes(...types: Array<TVUpdateChange["type"]>): TVUpdateChange[] {
    return types.map((type, i) => ({ type, title: `${type} ${i + 1}`, pr: i + 1 }))
}

test("not configured, unexpected or empty answers hide all update UI", () => {
    assert.deepEqual(parseTVUpdatesResponse({ configured: false }), { kind: "not-configured" })
    assert.deepEqual(parseTVUpdatesResponse(undefined), { kind: "not-configured" })
    assert.deepEqual(parseTVUpdatesResponse("<html>"), { kind: "not-configured" })
    assert.deepEqual(parseTVUpdatesResponse({}), { kind: "not-configured" })
})

test("an unreachable updater keeps the server's error", () => {
    assert.deepEqual(
        parseTVUpdatesResponse({ configured: true, reachable: false, error: "dial tcp: connection refused" }),
        { kind: "unreachable", error: "dial tcp: connection refused" },
    )
    const noError = parseTVUpdatesResponse({ configured: true, reachable: false })
    assert.equal(noError.kind, "unreachable")
})

test("the updater status is read field by field; internal changes are dropped, unknown types are other", () => {
    const state = ready()
    assert.equal(state.kind, "ready")
    if (state.kind !== "ready") return
    const { status } = state
    assert.equal(status.channel, "nightly")
    assert.equal(status.installed?.shortCommit, "808b9ee")
    assert.equal(status.pending?.commit, PENDING_SHA)
    assert.deepEqual(status.pending?.changes.map(c => c.type), ["fix", "feat", "other"])
    assert.equal(status.pending?.changesComplete, true)
    assert.equal(status.tvOnline, true)
    assert.equal(status.installing, false)
    assert.equal(status.lastResult?.ok, true)
})

test("missing pieces don't break the status: no installed app, no pending, a short SHA made from the commit", () => {
    const state = ready({ installed: null, pending: { version: "1.2.0", commit: PENDING_SHA }, lastResult: null })
    if (state.kind !== "ready") throw new Error("expected ready")
    assert.equal(state.status.installed, null)
    assert.equal(state.status.pending?.shortCommit, "0eff776")
    assert.deepEqual(state.status.pending?.changes, [])
    assert.equal(state.status.lastResult, null)
})

test("the build key is the commit, or version and build time for a stable build without one", () => {
    assert.equal(pendingBuildKey({ version: "1.0.0", commit: PENDING_SHA, shortCommit: null, channel: null, builtAt: null }), PENDING_SHA)
    assert.equal(pendingBuildKey({ version: "1.2.0", commit: null, shortCommit: null, channel: "stable", builtAt: "2026-11-26" }), "1.2.0@2026-11-26")
    assert.equal(pendingBuildKey(null), null)
})

test("changes are grouped New / Fixes / Other, newest first", () => {
    const grouped = groupChanges(changes("feat", "fix", "feat", "other", "fix"))
    assert.deepEqual(grouped.features.map(c => c.title), ["feat 3", "feat 1"])
    assert.deepEqual(grouped.fixes.map(c => c.title), ["fix 5", "fix 2"])
    assert.deepEqual(grouped.other.map(c => c.title), ["other 4"])
})

test("counts line: N new · M fixes, singular forms, other-only builds; empty without a list", () => {
    assert.equal(changeCountsLabel(changes("feat", "feat", "feat", "fix", "fix")), "3 new · 2 fixes")
    assert.equal(changeCountsLabel(changes("fix")), "1 fix")
    assert.equal(changeCountsLabel(changes("feat", "other")), "1 new · 1 other")
    assert.equal(changeCountsLabel(changes("other", "other")), "2 changes")
    assert.equal(changeCountsLabel([]), "")
})

function pendingWith(changes: TVUpdateChange[], builtAt: string | null = "2026-11-27T12:00:00.000Z"): TVUpdatePending {
    return { version: "1.0.0", commit: PENDING_SHA, shortCommit: "0eff776", channel: "nightly", builtAt, changes, changesComplete: null }
}

test("banner summary: the counts when there is a change list", () => {
    assert.equal(pendingSummary(pendingWith(changes("feat", "fix", "fix"))), "1 new · 2 fixes")
})

test("banner summary: only fixes, only new", () => {
    assert.equal(pendingSummary(pendingWith(changes("fix", "fix"))), "2 fixes")
    assert.equal(pendingSummary(pendingWith(changes("feat"))), "1 new")
})

test("banner summary: no change list gives a short date line, never 0 new · 0 fixes", () => {
    assert.equal(pendingSummary(pendingWith([])), "Built Nov 27")
})

test("banner summary: no change list and no date gives no line at all", () => {
    assert.equal(pendingSummary(pendingWith([], null)), null)
    assert.equal(pendingSummary(pendingWith([], "not a date")), null)
})

test("build dates and descriptions are human, without the commit", () => {
    assert.equal(formatBuildDate("2026-11-27T12:00:00.000Z"), "Nov 27")
    assert.equal(formatBuildDate(null), null)
    assert.equal(buildDescription(pendingWith([])), "Version 1.0.0 · nightly · built Nov 27")
    assert.equal(buildDescription({ version: "1.2.0", commit: null, shortCommit: null, channel: "stable", builtAt: null }), "Version 1.2.0 · stable")
    assert.equal(buildDescription({ version: "?", commit: "abc", shortCommit: "abc", channel: null, builtAt: null }), "Unknown build")
})

test("See changes renders only the groups that have changes", () => {
    assert.deepEqual(nonEmptyGroups([]), [])
    assert.deepEqual(nonEmptyGroups(changes("fix", "fix")).map(g => g.title), ["Fixes"])
    assert.deepEqual(nonEmptyGroups(changes("feat")).map(g => g.title), ["New"])
    assert.deepEqual(nonEmptyGroups(changes("other", "feat", "fix")).map(g => [g.title, g.changes.length]), [["New", 1], ["Fixes", 1], ["Other", 1]])
})

test("Settings → Updates: every row, when there is data for it", () => {
    const state = ready()
    if (state.kind !== "ready") throw new Error("expected ready")
    assert.deepEqual(settingsUpdateRows(state.status, false), ["installed", "pending", "install", "skip", "last-result"])
})

test("Settings → Updates: unknown installed version and no install yet leave no empty rows", () => {
    const state = ready({ installed: null, lastResult: null })
    if (state.kind !== "ready") throw new Error("expected ready")
    assert.deepEqual(settingsUpdateRows(state.status, false), ["pending", "install", "skip"])
})

test("Settings → Updates: up to date has no install or skip row", () => {
    const state = ready({ pending: null })
    if (state.kind !== "ready") throw new Error("expected ready")
    assert.deepEqual(settingsUpdateRows(state.status, false), ["installed", "up-to-date", "last-result"])
})

test("Settings → Updates: while installing there is no skip row", () => {
    const state = ready({ installing: true })
    if (state.kind !== "ready") throw new Error("expected ready")
    assert.deepEqual(settingsUpdateRows(state.status, false), ["installed", "pending", "install", "last-result"])
    const idle = ready()
    if (idle.kind !== "ready") throw new Error("expected ready")
    assert.deepEqual(settingsUpdateRows(idle.status, true), ["installed", "pending", "install", "last-result"])
})

test("unknown installed version: the description still reads well", () => {
    const state = ready({ installed: { version: "1.0.0", commit: null } })
    if (state.kind !== "ready" || !state.status.installed) throw new Error("expected installed")
    assert.equal(state.status.installed.shortCommit, null)
    assert.equal(buildDescription(state.status.installed, state.status.channel), "Version 1.0.0 · nightly")
})

test("last install result: success with age, failure with the error", () => {
    const now = Date.parse("2026-11-25T12:05:00.000Z")
    assert.equal(
        lastResultLabel({ at: "2026-11-25T10:05:00.000Z", ok: true, version: "1.0.0", shortCommit: "808b9ee", error: null }, now),
        "Installed v1.0.0 (808b9ee) · 2 h ago",
    )
    assert.equal(
        lastResultLabel({ at: "2026-11-25T12:00:00.000Z", ok: false, version: null, shortCommit: null, error: "TV did not answer" }, now),
        "Failed: TV did not answer · 5 min ago",
    )
    assert.equal(lastResultLabel(null, now), "No install yet")
})

// ---- banner visibility rules ----

const base = { seenKey: null, playing: false, installRequested: false }

test("banner: hidden when the updater isn't configured or the status isn't known yet", () => {
    assert.deepEqual(updateBannerDecision({ ...base, state: { kind: "not-configured" } }), { show: false, reason: "not-configured" })
    assert.deepEqual(updateBannerDecision({ ...base, state: undefined }), { show: false, reason: "not-configured" })
})

test("banner: hidden when the updater is unreachable", () => {
    assert.deepEqual(updateBannerDecision({ ...base, state: { kind: "unreachable", error: "x" } }), { show: false, reason: "unreachable" })
})

test("banner: hidden without a pending build", () => {
    assert.deepEqual(updateBannerDecision({ ...base, state: ready({ pending: null }) }), { show: false, reason: "no-pending" })
})

test("banner: shown for a pending build", () => {
    const decision = updateBannerDecision({ ...base, state: ready() })
    assert.equal(decision.show, true)
    if (decision.show) assert.equal(decision.key, PENDING_SHA)
})

test("banner: shown once per build; a newer build shows it again", () => {
    assert.deepEqual(updateBannerDecision({ ...base, seenKey: PENDING_SHA, state: ready() }), { show: false, reason: "seen" })
    assert.equal(updateBannerDecision({ ...base, seenKey: INSTALLED_SHA, state: ready() }).show, true)
})

test("banner: never during playback", () => {
    assert.deepEqual(updateBannerDecision({ ...base, playing: true, state: ready() }), { show: false, reason: "playing" })
})

test("banner: hidden while installing (on the updater or asked from this TV)", () => {
    assert.deepEqual(updateBannerDecision({ ...base, state: ready({ installing: true, installPhase: "installing" }) }), { show: false, reason: "installing" })
    assert.deepEqual(updateBannerDecision({ ...base, installRequested: true, state: ready() }), { show: false, reason: "installing" })
})

test("banner timing: waits for the app to settle and for the remote to be idle", () => {
    const eligible = 1_000_000
    assert.equal(bannerMayAppear(eligible + BANNER_FIRST_DELAY_MS - 1, eligible, 0), false)
    assert.equal(bannerMayAppear(eligible + BANNER_FIRST_DELAY_MS, eligible, 0), true)
    const now = eligible + BANNER_FIRST_DELAY_MS + 5000
    assert.equal(bannerMayAppear(now, eligible, now - BANNER_IDLE_MS + 1), false)
    assert.equal(bannerMayAppear(now, eligible, now - BANNER_IDLE_MS), true)
})

// ---- polling and installing ----

test("polling: every 30 minutes, every few seconds while an install runs", () => {
    assert.equal(statusPollInterval(ready(), false), STATUS_POLL_MS)
    assert.equal(statusPollInterval({ kind: "not-configured" }, false), STATUS_POLL_MS)
    assert.equal(statusPollInterval(ready({ installing: true }), false), INSTALLING_POLL_MS)
    assert.equal(statusPollInterval(undefined, true), INSTALLING_POLL_MS)
    assert.equal(STATUS_POLL_MS, 30 * 60 * 1000)
})

test("install/later answers: ok, or the updater's error", () => {
    assert.deepEqual(parseActionResponse({ ok: true, result: { queued: true } }), { ok: true, error: null })
    assert.deepEqual(parseActionResponse({ ok: false, result: { error: "no pending build" } }), { ok: false, error: "no pending build" })
    assert.equal(parseActionResponse(undefined).ok, false)
})

test("install refused during playback says so", () => {
    assert.match(installErrorMessage({ error: "PLAYBACK_ACTIVE", status: 409 }), /Something is playing/)
    assert.match(installErrorMessage({ error: "PLAYBACK_ACTIVE: a video is playing on the TV", status: 409 }), /Something is playing/)
    assert.equal(installErrorMessage({ error: "updater unreachable", status: 502 }), "updater unreachable")
    assert.equal(installErrorMessage({ status: 404 }), "This server doesn't support TV updates")
})

test("after asking to install: a lost server or an older result keeps 'Installing…'", () => {
    const requestedAt = Date.parse("2026-11-26T20:00:00.000Z")
    assert.deepEqual(watchInstall(undefined, requestedAt), { phase: "installing" })
    assert.deepEqual(watchInstall({ kind: "unreachable", error: "x" }, requestedAt), { phase: "installing" })
    assert.deepEqual(watchInstall(ready({ installing: true, installPhase: "waiting-tv" }), requestedAt), { phase: "installing" })
    // the result in the status is the previous install's
    assert.deepEqual(watchInstall(ready(), requestedAt), { phase: "installing" })
})

test("after asking to install: a new result ends it, failed or installed", () => {
    const requestedAt = Date.parse("2026-11-26T20:00:00.000Z")
    const failed = ready({ lastResult: { at: "2026-11-26T20:01:00.000Z", ok: false, error: "ares-install failed" } })
    assert.deepEqual(watchInstall(failed, requestedAt), { phase: "failed", error: "ares-install failed" })
    const done = ready({ pending: null, lastResult: { at: "2026-11-26T20:01:00.000Z", ok: true, version: "1.0.0", commit: PENDING_SHA } })
    assert.deepEqual(watchInstall(done, requestedAt), { phase: "installed" })
})
