import assert from "node:assert/strict"
import test from "node:test"
import {
    DEFAULT_TV_VISUAL_FLAGS,
    resolveTVVisualFlags,
    TV_VISUAL_FLAG_INFO,
    TV_VISUAL_FLAG_NAMES,
} from "../src/lib/tv/visual-flags.ts"

test("every visual effect is on by default and documented", () => {
    assert.deepEqual(Object.keys(DEFAULT_TV_VISUAL_FLAGS).sort(), [...TV_VISUAL_FLAG_NAMES].sort())
    for (const name of TV_VISUAL_FLAG_NAMES) {
        assert.equal(DEFAULT_TV_VISUAL_FLAGS[name], true, name)
        assert.ok(TV_VISUAL_FLAG_INFO[name].effect.length > 20, `${name} effect`)
        assert.ok(TV_VISUAL_FLAG_INFO[name].cost.length > 3, `${name} cost`)
    }
    assert.deepEqual(resolveTVVisualFlags(undefined), DEFAULT_TV_VISUAL_FLAGS)
    assert.deepEqual(resolveTVVisualFlags(""), DEFAULT_TV_VISUAL_FLAGS)
})

test("named effects turn off, in any case and separator, unknown names are ignored", () => {
    const flags = resolveTVVisualFlags(" AmbientBackdrop, cardgradients  bogus ")
    assert.equal(flags.ambientBackdrop, false)
    assert.equal(flags.cardGradients, false)
    assert.equal(flags.animeBackdrop, true)
    assert.equal(flags.releasingBadge, true)
    assert.equal(flags.typography, true)
    assert.equal(flags.scheduleTab, true)
})

test("`all` turns every effect off without touching the defaults", () => {
    const flags = resolveTVVisualFlags("all")
    for (const name of TV_VISUAL_FLAG_NAMES) assert.equal(flags[name], false, name)
    assert.equal(DEFAULT_TV_VISUAL_FLAGS.animeBackdrop, true)
})
