import assert from "node:assert/strict"
import test from "node:test"
import {
    DIRECT_PLAY_RETRIES,
    DIRECT_RETRY_BACKOFF_MS,
    DIRECT_RETRY_RESET_AFTER_SEC,
    directPlayFailureAction,
    type DirectPlayFailureKind,
    directRetriesSoFar,
    directRetryNotice,
    isRetryableDirectFailure,
    mediaErrorCause,
    readFailureCause,
    RELAY_NOTICE,
    SUBTITLES_NOTICE,
    VIDEO_FAILED_MESSAGE,
} from "../src/lib/player/direct-play-policy.ts"
import { directPlayDiagnostics, summarizeDiagnostics } from "../src/lib/player/direct-play-diagnostics.ts"

const base = { loud: false, relayTried: false, canRetry: true, playedSec: 0, canRetryDirect: true }

test("three direct retries, 2 s, 4 s and 8 s apart, then the relay", () => {
    assert.equal(DIRECT_PLAY_RETRIES, 3)
    const delays: number[] = []
    for (let done = 0; done < DIRECT_PLAY_RETRIES; done++) {
        const action = directPlayFailureAction("video", { ...base, cause: "network", directRetries: done })
        assert.equal(action.type, "retry-direct")
        if (action.type !== "retry-direct") return
        assert.equal(action.attempt, done + 1)
        assert.equal(action.of, 3)
        assert.equal(action.notice, `Retrying direct play (${done + 1}/3)…`)
        delays.push(action.delayMs)
    }
    assert.deepEqual(delays, [...DIRECT_RETRY_BACKOFF_MS])
    assert.deepEqual(delays, [2000, 4000, 8000])
    // The fourth failure: through the server, with the usual notice.
    assert.deepEqual(directPlayFailureAction("video", { ...base, cause: "network", directRetries: 3 }), { type: "retry-relay", notice: RELAY_NOTICE })
})

test("a retry waits at least as long as the CDN asked (429 Retry-After)", () => {
    const action = directPlayFailureAction("header", { ...base, cause: "timeout", directRetries: 0, cdnBackoffMs: 15_000 })
    assert.equal(action.type === "retry-direct" && action.delayMs, 15_000)
})

test("a mid-episode failure retries at its position, then offers the server", () => {
    const action = directPlayFailureAction("video", { ...base, playedSec: 754.5, cause: "network", directRetries: 1 })
    assert.equal(action.type, "retry-direct")
    assert.equal(action.type === "retry-direct" && action.resumeAtSec, 754.5)
    // After three, the error screen (with "Retry via server"), as before.
    assert.deepEqual(directPlayFailureAction("video", { ...base, playedSec: 754.5, cause: "network", directRetries: 3 }), { type: "error", message: VIDEO_FAILED_MESSAGE })
})

test("the retry count starts again once the episode played a while", () => {
    assert.equal(directRetriesSoFar(undefined, 10), 0)
    assert.equal(directRetriesSoFar({ count: 2, resumedAtSec: 100 }, 130), 2)
    assert.equal(directRetriesSoFar({ count: 3, resumedAtSec: 100 }, 100 + DIRECT_RETRY_RESET_AFTER_SEC), 0)
})

test("without the release and file, no direct retry (no auto-select again): the relay as before", () => {
    assert.deepEqual(directPlayFailureAction("video", { ...base, canRetryDirect: false, cause: "network" }), { type: "retry-relay", notice: RELAY_NOTICE })
})

test("which failures a fresh link can fix", () => {
    const check = (kind: DirectPlayFailureKind, cause: Parameters<typeof isRetryableDirectFailure>[1], headerRead = false, videoProblems = 0) =>
        isRetryableDirectFailure(kind, cause, { headerRead, videoProblems })
    // The link or the network.
    assert.equal(check("header", "link"), true)
    assert.equal(check("header", "network"), true)
    assert.equal(check("header", "timeout"), true)
    assert.equal(check("video", "network"), true)
    assert.equal(check("video", "aborted"), true)
    assert.equal(check("video", "unknown"), true)
    // "Source not supported" before the TV read anything is a dead link too.
    assert.equal(check("video", "unsupported", false), true)
    // The format, not the link: straight to the relay.
    assert.equal(check("video", "unsupported", true), false)
    assert.equal(check("video", "unsupported", false, 1), false)
    assert.equal(check("video", "decode", false), false)
    assert.equal(check("header", "blocked"), false)
    // Subtitles and a rate-limited header never retry.
    assert.equal(check("subtitles", "network"), false)
    assert.equal(check("header", "rate-limit"), false)
})

test("a codec the TV can't play skips the retries", () => {
    const retryable = isRetryableDirectFailure("video", "unsupported", { headerRead: true, videoProblems: 0 })
    assert.deepEqual(directPlayFailureAction("video", { ...base, cause: "unsupported", retryable, directRetries: 0 }), { type: "retry-relay", notice: RELAY_NOTICE })
})

test("429s on subtitle or header reads never send the episode through the server", () => {
    assert.deepEqual(directPlayFailureAction("subtitles", { ...base, cause: "rate-limit", retryable: false, playedSec: 300 }), { type: "notice", notice: SUBTITLES_NOTICE })
    assert.deepEqual(directPlayFailureAction("header", { ...base, cause: "rate-limit", retryable: false }), { type: "notice", notice: SUBTITLES_NOTICE })
})

test("causes from read errors and MediaErrors", () => {
    assert.equal(readFailureCause({ kind: "rate-limit", status: 429 }), "rate-limit")
    assert.equal(readFailureCause({ kind: "http", status: 503 }), "rate-limit")
    assert.equal(readFailureCause({ kind: "http", status: 403 }), "link")
    assert.equal(readFailureCause({ kind: "http", status: 500 }), "network")
    assert.equal(readFailureCause({ kind: "cors" }), "blocked")
    assert.equal(readFailureCause({ kind: "timeout" }), "timeout")
    assert.equal(readFailureCause(new Error("Reading the file's header took longer than 25 s")), "timeout")
    assert.equal(readFailureCause("x"), "unknown")
    assert.deepEqual([1, 2, 3, 4, 0].map(mediaErrorCause), ["aborted", "network", "decode", "unsupported", "unknown"])
})

test("the diagnostics panel shows the retry count", () => {
    directPlayDiagnostics.reset("s1")
    assert.ok(summarizeDiagnostics(directPlayDiagnostics.get()).includes("direct retries: 0/3"))
    directPlayDiagnostics.update({ directRetries: 2, failure: "Direct play failed: x", failureCause: "network" })
    const lines = summarizeDiagnostics(directPlayDiagnostics.get())
    assert.ok(lines.includes("direct retries: 2/3 (fresh link for the same file)"))
    assert.ok(lines.includes("FAILURE: Direct play failed: x [network]"))
    assert.equal(directRetryNotice(2), "Retrying direct play (2/3)…")
})

test("each retry asks for a fresh link to the release and file the server resolved", async () => {
    const starts = await import("../src/lib/player/direct-play-starts.ts")
    const episode = { episodeNumber: 5 } as never
    const torrent = { name: "[Group] Show - 05", infoHash: "abc" } as never
    // Auto-select: nothing to retry until the server's link names the release.
    starts.rememberDebridStart({ mediaId: 7, episodeNumber: 5, episode, kind: "auto-select" })
    assert.equal(starts.directRetrySelection(starts.lastDebridStartFor(7, 5)), null)
    starts.rememberResolvedDebridRelease(7, 5, torrent, "3")
    assert.deepEqual(starts.directRetrySelection(starts.lastDebridStartFor(7, 5)), { torrent, fileId: "3" })
    // Another episode's link doesn't touch it.
    starts.rememberResolvedDebridRelease(7, 6, { name: "other" } as never, "9")
    assert.deepEqual(starts.directRetrySelection(starts.lastDebridStartFor(7, 5)), { torrent, fileId: "3" })
    // A file picked by hand is known without the server's help.
    starts.rememberDebridStart({ mediaId: 8, episodeNumber: 1, episode, kind: "manual", manual: { torrent, fileId: "2" } })
    assert.deepEqual(starts.directRetrySelection(starts.lastDebridStartFor(8, 1)), { torrent, fileId: "2" })
})

test("the next link for the episode is the retry: once, from where it failed", async () => {
    const starts = await import("../src/lib/player/direct-play-starts.ts")
    starts.requestDirectRetry({ mediaId: 7, episodeNumber: 5, attempt: 2, resumeAtSec: 300 })
    assert.equal(starts.takeDirectRetry(7, 6), null)
    assert.deepEqual(starts.takeDirectRetry(7, 5), { mediaId: 7, episodeNumber: 5, attempt: 2, resumeAtSec: 300 })
    assert.equal(starts.takeDirectRetry(7, 5), null)
    starts.requestDirectRetry({ mediaId: 7, episodeNumber: 5, attempt: 1, resumeAtSec: 0 })
    starts.clearDirectRetry()
    assert.equal(starts.takeDirectRetry(7, 5), null)
})
