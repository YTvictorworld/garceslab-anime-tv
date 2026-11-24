import assert from "node:assert/strict"
import test from "node:test"
import {
    EPISODE_TAG_LABELS,
    EPISODE_TAGS_MAX_POLLS,
    EPISODE_TAGS_POLL_MS,
    episodeTagFor,
    episodeTagsRefetchInterval,
    visibleEpisodeTags,
} from "../src/lib/episode-tags/episode-tags.ts"

const bleach = {
    status: "ready" as const,
    malId: 269,
    hasNonCanon: true,
    episodes: { "1": "canon", "33": "filler", "50": "filler", "64": "filler", "110": "recap" } as Record<string, any>,
}

test("tags show when the anime has a filler or recap episode", () => {
    const tags = visibleEpisodeTags(bleach)
    assert.ok(tags)
    assert.equal(episodeTagFor(tags, 1), "canon")
    assert.equal(episodeTagFor(tags, 33), "filler")
    assert.equal(episodeTagFor(tags, 110), "recap")
    assert.equal(episodeTagFor(tags, 2), undefined, "an episode the source doesn't list has no tag")
})

test("an all-canon anime shows nothing", () => {
    assert.equal(visibleEpisodeTags({ ...bleach, hasNonCanon: false, episodes: { "1": "canon", "2": "canon" } }), null)
})

test("no data, pending, unavailable or an error show nothing", () => {
    assert.equal(visibleEpisodeTags(undefined), null)
    assert.equal(visibleEpisodeTags(null), null)
    assert.equal(visibleEpisodeTags({ status: "pending", malId: 269, hasNonCanon: false, episodes: {} }), null)
    assert.equal(visibleEpisodeTags({ status: "unavailable", malId: 0, hasNonCanon: false, episodes: {} }), null)
    assert.equal(visibleEpisodeTags({ status: "ready", malId: 1, hasNonCanon: false }), null)
})

test("mixed counts as non-canon and unknown kinds or keys are ignored", () => {
    const tags = visibleEpisodeTags({ status: "ready", malId: 1, hasNonCanon: true, episodes: { "1": "canon", "2": "mixed", "x": "filler", "3": "special" } as any })
    assert.ok(tags)
    assert.equal(tags.size, 2)
    assert.equal(episodeTagFor(tags, 2), "mixed")
    assert.equal(EPISODE_TAG_LABELS.mixed, "MIX")
    assert.equal(EPISODE_TAG_LABELS.canon, "CANON")
})

test("episodeTagFor tolerates missing tags and numbers", () => {
    assert.equal(episodeTagFor(null, 1), undefined)
    assert.equal(episodeTagFor(visibleEpisodeTags(bleach), undefined), undefined)
    assert.equal(episodeTagFor(visibleEpisodeTags(bleach), 0), undefined)
})

test("polls only while pending, and not forever", () => {
    const pending = { status: "pending" as const, malId: 269, hasNonCanon: false, episodes: {} }
    assert.equal(episodeTagsRefetchInterval(pending, 0), EPISODE_TAGS_POLL_MS)
    assert.equal(episodeTagsRefetchInterval(pending, EPISODE_TAGS_MAX_POLLS), false)
    assert.equal(episodeTagsRefetchInterval(bleach, 1), false)
    assert.equal(episodeTagsRefetchInterval(undefined, 0), false)
})
