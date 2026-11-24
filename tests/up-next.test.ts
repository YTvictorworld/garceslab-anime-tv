import assert from "node:assert/strict"
import test from "node:test"
import {
    UP_NEXT_COUNTDOWN_SECONDS,
    UP_NEXT_END_COUNTDOWN_SECONDS,
    UP_NEXT_LEAD_SECONDS,
    upNextCountdownSeconds,
    upNextStage,
} from "../src/lib/player/up-next.ts"

const duration = 1420

test("nothing during the episode", () => {
    assert.equal(upNextStage({ currentTime: 600, duration, eofReached: false }), null)
    assert.equal(upNextStage({ currentTime: 0, duration, eofReached: false }), null)
    assert.equal(upNextStage({ currentTime: 100, duration: 0, eofReached: false }), null)
})

test("the card comes up in the last seconds while it plays", () => {
    assert.equal(upNextStage({ currentTime: duration - UP_NEXT_LEAD_SECONDS - 1, duration, eofReached: false }), null)
    assert.equal(upNextStage({ currentTime: duration - UP_NEXT_LEAD_SECONDS, duration, eofReached: false }), "early")
})

test("the card comes up when the ending starts", () => {
    const outroStart = duration - 90
    assert.equal(upNextStage({ currentTime: outroStart - 1, duration, eofReached: false, outroStart }), null)
    assert.equal(upNextStage({ currentTime: outroStart, duration, eofReached: false, outroStart }), "early")
})

test("an ending far from the end, or in the first half, is ignored", () => {
    const outroStart = duration - 400
    assert.equal(upNextStage({ currentTime: outroStart + 5, duration, eofReached: false, outroStart }), null)
    assert.equal(upNextStage({ currentTime: 200, duration: 300, eofReached: false, outroStart: 100 }), null)
    assert.equal(upNextStage({ currentTime: duration - 60, duration, eofReached: false, outroStart: Number.NaN }), null)
})

test("after Watch credits it waits for the end, and comes back there", () => {
    assert.equal(upNextStage({ currentTime: duration - 5, duration, eofReached: false, outroStart: duration - 90, dismissedEarly: true }), null)
    assert.equal(upNextStage({ currentTime: duration, duration, eofReached: true, dismissedEarly: true }), "end")
})

test("an end that comes too early (a broken file) doesn't count", () => {
    assert.equal(upNextStage({ currentTime: 300, duration, eofReached: true }), null)
})

test("countdown lengths", () => {
    assert.equal(upNextCountdownSeconds("early"), UP_NEXT_COUNTDOWN_SECONDS)
    assert.equal(upNextCountdownSeconds("end"), UP_NEXT_END_COUNTDOWN_SECONDS)
    assert.ok(UP_NEXT_COUNTDOWN_SECONDS < UP_NEXT_LEAD_SECONDS, "the countdown ends before the episode does when the card comes up late")
})
