import assert from "node:assert/strict"
import test from "node:test"

const { revealSpan } = await import("../src/lib/webos/reveal-span.ts")

// A 1080 px tall page scroller with the 200 px margin spatial-navigation uses.
const SIZE = 1080
const MARGIN = 200

test("an element already shown with its margin doesn't scroll", () => {
    assert.equal(revealSpan(0, SIZE, 600, 850, MARGIN), 0)
    assert.equal(revealSpan(1000, SIZE, 1400, 1700, MARGIN), 1000)
})

test("moving down scrolls just enough to show the element and its margin", () => {
    assert.equal(revealSpan(0, SIZE, 1100, 1400, MARGIN), 1400 + MARGIN - SIZE)
})

test("moving up scrolls just enough without snapping (horizontal rows)", () => {
    assert.equal(revealSpan(900, SIZE, 700, 760, MARGIN), 500)
    assert.equal(revealSpan(900, SIZE, 440, 500, MARGIN), 240)
})

test("never asks for a negative offset", () => {
    assert.equal(revealSpan(300, SIZE, 50, 100, MARGIN), 0)
})

test("snapToStart: the hero's buttons, reached from a lower row, bring the page back to the top", () => {
    // Coming up from "Continue watching" with the page scrolled to 900.
    assert.equal(revealSpan(900, SIZE, 440, 500, MARGIN, true), 0)
    // The page rested part way down (the bug seen on the TV): still back to 0.
    assert.equal(revealSpan(250, SIZE, 440, 500, MARGIN, true), 0)
})

test("snapToStart: the first row under the hero also counts as the top of the page", () => {
    assert.equal(revealSpan(600, SIZE, 620, 860, MARGIN, true), 0)
})

test("snapToStart: an element below the first screen scrolls as before", () => {
    assert.equal(revealSpan(1500, SIZE, 1200, 1500, MARGIN, true), 1000)
    assert.equal(revealSpan(0, SIZE, 1100, 1400, MARGIN, true), 1400 + MARGIN - SIZE)
})

test("snapToStart: a page already at the top stays put", () => {
    assert.equal(revealSpan(0, SIZE, 440, 500, MARGIN, true), 0)
})
