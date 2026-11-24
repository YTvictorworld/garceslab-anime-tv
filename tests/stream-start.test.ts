import assert from "node:assert/strict"
import test from "node:test"
import { createStreamStartRegistry, startBlockReason } from "../src/lib/player/stream-start.ts"

test("a new start replaces the current one; ending it clears it", () => {
    const starts = createStreamStartRegistry()
    assert.equal(starts.current(), null)
    const first = starts.begin()
    const second = starts.begin()
    assert.ok(second > first)
    assert.equal(starts.isCurrent(first), false)
    assert.equal(starts.isCurrent(second), true)
    // An old start's end doesn't end the new one.
    starts.end(first)
    assert.equal(starts.current(), second)
    starts.end()
    assert.equal(starts.current(), null)
    assert.equal(starts.lastIssued(), second)
})

test("listeners hear begins and ends", () => {
    const starts = createStreamStartRegistry()
    let calls = 0
    const unsubscribe = starts.subscribe(() => calls++)
    starts.begin()
    starts.end()
    starts.end()
    unsubscribe()
    starts.begin()
    assert.equal(calls, 2)
})

test("a start that can't go ahead says why", () => {
    assert.equal(startBlockReason({ hasAniDBEpisode: true, mediaId: 1 }), null)
    assert.match(startBlockReason({ selectionLocked: true }) ?? "", /already starting/)
    assert.match(startBlockReason({ resuming: true }) ?? "", /resumed/)
    assert.match(startBlockReason({ checkingRelease: true }) ?? "", /checking the releases/)
    assert.match(startBlockReason({ hasAniDBEpisode: false, mediaId: 1 }) ?? "", /AniDB/)
    assert.match(startBlockReason({ hasAniDBEpisode: true, mediaId: 0 }) ?? "", /isn't loaded/)
})
