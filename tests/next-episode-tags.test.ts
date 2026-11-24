import assert from "node:assert/strict"
import test from "node:test"
import { visibleEpisodeTags } from "../src/lib/episode-tags/episode-tags.ts"
import { describeEpisodeSkip, isSkippableEpisodeTag, nextEpisodeLine, planNextEpisode } from "../src/lib/episode-tags/next-episode.ts"
import { createRequestLimiter } from "../src/lib/episode-tags/request-limit.ts"
import { mergeServerPlayerPrefs, pickSyncedPlayerPrefs } from "../src/lib/player/player-prefs-sync.ts"

// Bleach-like: 33 filler, 64–109 filler, 110 canon, 111 recap, 112 mixed, 113–114 filler, end at 114.
const episodes: Record<string, any> = { "32": "canon", "33": "filler", "34": "canon", "63": "canon", "110": "canon", "111": "recap", "112": "mixed", "113": "filler", "114": "filler" }
for (let n = 64; n <= 109; n++) episodes[String(n)] = "filler"
const tags = visibleEpisodeTags({ status: "ready", malId: 269, hasNonCanon: true, episodes })!

test("only filler and recap are skippable; MIX keeps its canon part", () => {
    assert.equal(isSkippableEpisodeTag("filler"), true)
    assert.equal(isSkippableEpisodeTag("recap"), true)
    assert.equal(isSkippableEpisodeTag("mixed"), false)
    assert.equal(isSkippableEpisodeTag("canon"), false)
    assert.equal(isSkippableEpisodeTag(undefined), false)
})

test("with skipping off, next is the natural next episode", () => {
    assert.deepEqual(planNextEpisode({ current: 63, natural: 64, tags, skipFiller: false }), { episodeNumber: 64, skip: null })
})

test("skipping jumps over a run of filler", () => {
    assert.deepEqual(planNextEpisode({ current: 63, natural: 64, tags, skipFiller: true, lastEpisode: 366 }), {
        episodeNumber: 110,
        skip: { from: 64, to: 109, kinds: "filler" },
    })
    assert.deepEqual(planNextEpisode({ current: 32, natural: 33, tags, skipFiller: true }), {
        episodeNumber: 34,
        skip: { from: 33, to: 33, kinds: "filler" },
    })
})

test("a recap is skipped, a MIX episode is not", () => {
    assert.deepEqual(planNextEpisode({ current: 110, natural: 111, tags, skipFiller: true }), {
        episodeNumber: 112,
        skip: { from: 111, to: 111, kinds: "recap" },
    })
    assert.deepEqual(planNextEpisode({ current: 111, natural: 112, tags, skipFiller: true }), { episodeNumber: 112, skip: null })
})

test("a canon next episode needs no skip", () => {
    assert.deepEqual(planNextEpisode({ current: 33, natural: 34, tags, skipFiller: true }), { episodeNumber: 34, skip: null })
})

test("an episode the source doesn't list ends the jump", () => {
    const sparse = visibleEpisodeTags({ status: "ready", malId: 1, hasNonCanon: true, episodes: { "5": "filler", "6": "filler" } })!
    assert.deepEqual(planNextEpisode({ current: 4, natural: 5, tags: sparse, skipFiller: true }), {
        episodeNumber: 7,
        skip: { from: 5, to: 6, kinds: "filler" },
    })
})

test("ending on filler, or landing on a missing file, falls back to normal", () => {
    assert.deepEqual(planNextEpisode({ current: 112, natural: 113, tags, skipFiller: true, lastEpisode: 114 }), { episodeNumber: 113, skip: null })
    assert.deepEqual(planNextEpisode({ current: 63, natural: 64, tags, skipFiller: true, available: new Set([63, 64, 65]) }), { episodeNumber: 64, skip: null })
    assert.deepEqual(planNextEpisode({ current: 63, natural: 64, tags, skipFiller: true, available: new Set([63, 64, 110]) })?.episodeNumber, 110)
})

test("no tags, no next episode or a non-adjacent next mean normal behaviour", () => {
    assert.deepEqual(planNextEpisode({ current: 63, natural: 64, tags: null, skipFiller: true }), { episodeNumber: 64, skip: null })
    assert.equal(planNextEpisode({ current: 366, natural: null, tags, skipFiller: true }), null)
    assert.deepEqual(planNextEpisode({ current: null, natural: 64, tags, skipFiller: true }), { episodeNumber: 64, skip: null })
})

test("skip and next-episode label text", () => {
    assert.equal(describeEpisodeSkip({ from: 64, to: 109, kinds: "filler" }), "skipping filler episodes 64–109")
    assert.equal(describeEpisodeSkip({ from: 12, to: 12, kinds: "recap" }), "skipping recap episode 12")
    assert.equal(describeEpisodeSkip({ from: 20, to: 22, kinds: "both" }), "skipping filler and recap episodes 20–22")
    assert.equal(nextEpisodeLine("Episode 34", "filler", null), "Next: Episode 34 · FILLER")
    assert.equal(nextEpisodeLine("Episode 34", undefined, null), "Next: Episode 34")
    assert.equal(nextEpisodeLine("Episode 112", "mixed", null, ""), "Episode 112 · MIX")
    assert.equal(
        nextEpisodeLine("Episode 110", "canon", { from: 64, to: 109, kinds: "filler" }),
        "Next: Episode 110 (skipping filler episodes 64–109)",
    )
    assert.equal(
        nextEpisodeLine("Episode 112", "mixed", { from: 111, to: 111, kinds: "recap" }),
        "Next: Episode 112 (skipping recap episode 111) · MIX",
    )
})

test("the setting follows the profile", () => {
    assert.equal(pickSyncedPlayerPrefs({ skipFillerEpisodes: true, wyzieApiKey: "x" }).skipFillerEpisodes, true)
    assert.equal(mergeServerPlayerPrefs({ skipFillerEpisodes: false }, { skipFillerEpisodes: true }).skipFillerEpisodes, true)
    assert.equal(pickSyncedPlayerPrefs({ skipFillerEpisodes: "yes" }).skipFillerEpisodes, undefined)
})

test("the request limiter runs a few at a time, in order", async () => {
    const limiter = createRequestLimiter(2)
    const started: number[] = []
    const finish: (() => void)[] = []
    const runs = [1, 2, 3, 4].map(n => limiter.run(() => new Promise<number>(resolve => {
        started.push(n)
        finish.push(() => resolve(n))
    })))
    assert.deepEqual(started, [1, 2])
    assert.equal(limiter.queued, 2)
    finish[0]()
    await runs[0]
    await Promise.resolve()
    assert.deepEqual(started, [1, 2, 3])
    finish[1]()
    finish[2]()
    await Promise.all(runs.slice(1, 3))
    await Promise.resolve()
    finish[3]()
    assert.deepEqual(await Promise.all(runs), [1, 2, 3, 4])
    assert.equal(limiter.active, 0)
})

test("an aborted request that is still waiting never starts", async () => {
    const limiter = createRequestLimiter(1)
    let release!: () => void
    const first = limiter.run(() => new Promise<void>(resolve => { release = resolve }))
    const controller = new AbortController()
    let ran = false
    const second = limiter.run(async () => { ran = true }, controller.signal)
    const third = limiter.run(async () => "third")
    controller.abort()
    release()
    await first
    await assert.rejects(second)
    assert.equal(await third, "third")
    assert.equal(ran, false)
})
