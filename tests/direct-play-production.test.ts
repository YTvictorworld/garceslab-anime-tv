import assert from "node:assert/strict"
import test from "node:test"
import {
    directPlayFailureAction,
    directPlayFlags,
    RELAY_NOTICE,
    SUBTITLES_NOTICE,
    VIDEO_FAILED_MESSAGE,
    viewerSessionEndedAction,
} from "../src/lib/player/direct-play-policy.ts"
import { errorCode, lanesFullMessage, profileErrorMessage } from "../src/lib/profile/profile-errors.ts"

test("direct play is the default on webOS only, and can be turned off", () => {
    assert.deepEqual(directPlayFlags({ platform: "web" }), { enabled: true, loud: false })
    assert.deepEqual(directPlayFlags({ platform: "web", appId: "app.seanime.tenji" }), { enabled: true, loud: false })
    assert.deepEqual(directPlayFlags({ platform: "web", directPlay: "0" }), { enabled: false, loud: false })
    assert.deepEqual(directPlayFlags({ platform: "android" }), { enabled: false, loud: false })
    assert.deepEqual(directPlayFlags({ platform: "ios", directPlayTest: "1" }), { enabled: false, loud: false })
})

test("the side-by-side test build keeps the loud dialog", () => {
    assert.deepEqual(directPlayFlags({ platform: "web", appId: "app.garceslab.anime.directtest" }), { enabled: true, loud: true })
    assert.deepEqual(directPlayFlags({ platform: "web", directPlayTest: "1", directPlay: "0" }), { enabled: true, loud: true })
    const action = directPlayFailureAction("video", { loud: true, relayTried: false, canRetry: true, playedSec: 0 })
    assert.deepEqual(action, { type: "dialog" })
})

test("a link the TV can't play falls back to the server once, quietly", () => {
    const first = directPlayFailureAction("video", { loud: false, relayTried: false, canRetry: true, playedSec: 0 })
    assert.deepEqual(first, { type: "retry-relay", notice: RELAY_NOTICE })
    const again = directPlayFailureAction("video", { loud: false, relayTried: true, canRetry: true, playedSec: 0 })
    assert.deepEqual(again, { type: "error", message: VIDEO_FAILED_MESSAGE })
})

test("a video failure well into the episode shows the error screen", () => {
    const late = directPlayFailureAction("video", { loud: false, relayTried: false, canRetry: true, playedSec: 600 })
    assert.equal(late.type, "error")
})

test("an unreadable header goes through the server; subtitles failing later only say so", () => {
    assert.equal(directPlayFailureAction("header", { loud: false, relayTried: false, canRetry: true, playedSec: 0 }).type, "retry-relay")
    assert.deepEqual(directPlayFailureAction("header", { loud: false, relayTried: true, canRetry: true, playedSec: 0 }), { type: "notice", notice: SUBTITLES_NOTICE })
    assert.deepEqual(directPlayFailureAction("subtitles", { loud: false, relayTried: false, canRetry: true, playedSec: 30 }), { type: "notice", notice: SUBTITLES_NOTICE })
})

test("without a way to start the stream again there is no relay", () => {
    assert.equal(directPlayFailureAction("video", { loud: false, relayTried: false, canRetry: false, playedSec: 0 }).type, "error")
})

test("LANES_FULL reads as a sentence that names who is watching", () => {
    const raw = "LANES_FULL: All 3 viewing slots are in use (Ana, Bob and Carl)"
    assert.equal(errorCode(raw), "LANES_FULL")
    assert.equal(profileErrorMessage(raw), "All 3 viewing slots are in use (Ana, Bob and Carl). Try again when someone stops watching.")
    assert.equal(lanesFullMessage("LANES_FULL"), "All viewing slots are in use. Try again when someone stops watching.")
    assert.equal(profileErrorMessage("PLAYBACK_BUSY"), "Another playback is in progress. Stop it first, then try again.")
    assert.equal(profileErrorMessage("Failed to add torrent: boom"), null)
    assert.equal(errorCode("Error: something"), "Error: something")
})

test("the server ending this device's session", () => {
    const playing = { mediaId: 10, episodeNumber: 3 }
    const ev = (reason: string, mediaId = 10, episodeNumber = 3) => ({ sessionId: "s", reason, mediaId, episodeNumber })
    assert.equal(viewerSessionEndedAction(ev("admin"), playing).type, "leave")
    assert.equal(viewerSessionEndedAction(ev("replaced"), playing).type, "leave")
    assert.equal(viewerSessionEndedAction(ev("profile-gone"), playing).type, "leave")
    assert.deepEqual(viewerSessionEndedAction(ev("idle"), playing), { type: "reclaim" })
    assert.deepEqual(viewerSessionEndedAction(ev("disconnected"), playing), { type: "reclaim" })
    assert.deepEqual(viewerSessionEndedAction(ev("failed"), playing), { type: "none" })
    // Another episode (a late event of the previous one) or no player: nothing.
    assert.deepEqual(viewerSessionEndedAction(ev("admin", 10, 2), playing), { type: "none" })
    assert.deepEqual(viewerSessionEndedAction(ev("admin", 11, 3), playing), { type: "none" })
    assert.deepEqual(viewerSessionEndedAction(ev("admin"), null), { type: "none" })
})
