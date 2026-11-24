import assert from "node:assert/strict"
import test from "node:test"
import { NOTHING_STARTED_MS, ownsPreparing, STALLED_MS, startOutcome, type StartSignals, startStatusLabel } from "../src/components/tv/tv-continue-start.ts"

const base: StartSignals = {
    now: 10_000,
    pressedAt: 10_000,
    lastProgressAt: 10_000,
    preparing: false,
    sawPreparing: false,
    playerOpen: false,
    pickerOpen: false,
    error: null,
}

test("waits right after the press and while the server prepares", () => {
    assert.deepEqual(startOutcome(base), { kind: "wait" })
    assert.deepEqual(startOutcome({ ...base, now: 40_000, preparing: true, sawPreparing: true, lastProgressAt: 35_000 }), { kind: "wait" })
})

test("the player opening ends the start, even over an error", () => {
    assert.deepEqual(startOutcome({ ...base, playerOpen: true, error: "late" }), { kind: "playing" })
})

test("an error from the server or the request fails it with that message", () => {
    assert.deepEqual(startOutcome({ ...base, sawPreparing: true, error: "No torrents found" }), { kind: "failed", message: "No torrents found" })
})

test("the release list opening hands over to the show's page", () => {
    assert.deepEqual(startOutcome({ ...base, pickerOpen: true }), { kind: "needs-page" })
})

test("preparing that stops without a player is a failure", () => {
    assert.equal(startOutcome({ ...base, sawPreparing: true, preparing: false }).kind, "failed")
})

test("nothing started, or no news for too long, is a failure", () => {
    assert.equal(startOutcome({ ...base, now: base.pressedAt + NOTHING_STARTED_MS - 1 }).kind, "wait")
    assert.deepEqual(startOutcome({ ...base, now: base.pressedAt + NOTHING_STARTED_MS + 1 }), { kind: "failed", message: "The stream didn't start" })
    const stalled = { ...base, preparing: true, sawPreparing: true, now: 10_000 + STALLED_MS + 1 }
    assert.deepEqual(startOutcome(stalled), { kind: "failed", message: "Timed out waiting for the stream" })
})

test("the status shows the server's most specific step", () => {
    assert.equal(startStatusLabel({ directMessage: "Loading metadata...", debridMessage: "Selecting best torrent..." }), "Loading metadata...")
    assert.equal(startStatusLabel({ debridMessage: "Awaiting stream: 100%", sessionMessage: "x" }), "Awaiting stream: 100%")
    assert.equal(startStatusLabel({ sessionMessage: null }), "Starting stream...")
})

test("a press that started nothing fails at once with its reason", () => {
    assert.deepEqual(startOutcome({ ...base, blocked: "No live connection to the server" }), { kind: "failed", message: "No live connection to the server" })
    assert.equal(startOutcome({ ...base, blocked: "x", playerOpen: true }).kind, "playing")
})

test("a 'preparing' an earlier session left isn't this start's", () => {
    // The atom says preparing, but no start begun after the press is in flight.
    assert.equal(ownsPreparing({ preparing: true, currentStartId: null, issuedBeforePress: 4 }), false)
    assert.equal(ownsPreparing({ preparing: true, currentStartId: 4, issuedBeforePress: 4 }), false)
    assert.equal(ownsPreparing({ preparing: true, currentStartId: 5, issuedBeforePress: 4 }), true)
    assert.equal(ownsPreparing({ preparing: false, currentStartId: 5, issuedBeforePress: 4 }), false)
    // So a dead start fails after 12 s, not after the 2-minute stall rule.
    const stale = { ...base, preparing: false, sawPreparing: false, now: base.pressedAt + NOTHING_STARTED_MS + 1 }
    assert.deepEqual(startOutcome(stale), { kind: "failed", message: "The stream didn't start" })
})

test("an earlier session's status message isn't shown on the card", () => {
    assert.equal(startStatusLabel({ startInFlight: false, debridMessage: "Selecting best torrent...", sessionMessage: "Streaming" }), "Starting stream...")
    assert.equal(startStatusLabel({ startInFlight: true, debridMessage: "Selecting best torrent..." }), "Selecting best torrent...")
})
