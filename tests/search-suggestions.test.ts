import assert from "node:assert/strict"
import test from "node:test"
import { completedSearchTitle, pickSuggestions, suggestionDetail, suggestionFromAnilist } from "../src/lib/search/search-suggestions.ts"

const bleach = { mediaId: 269, title: "Bleach", year: 2004, format: "TV", episodes: 366 }
const aot = { mediaId: 16498, title: "Shingeki no Kyojin", matched: "Attack on Titan", year: 2013, format: "TV" }
const anilistBleach = { id: 269, title: { userPreferred: "BLEACH", romaji: "Bleach" }, format: "TV", seasonYear: 2004 } as any

test("the title index wins when it has suggestions", () => {
    const { items, fromIndex } = pickSuggestions({ index: [bleach, aot], indexFailed: false, anilist: [anilistBleach] }, 6)
    assert.equal(fromIndex, true)
    assert.deepEqual(items.map(item => item.id), [269, 16498])
    assert.equal(items[1].matched, "Attack on Titan")
})

test("AniList is the fallback when the index has nothing, failed or is still loading", () => {
    for (const sources of [
        { index: [], indexFailed: false },
        { index: [bleach], indexFailed: true },
        { index: undefined, indexFailed: false },
    ]) {
        const { items, fromIndex } = pickSuggestions({ ...sources, anilist: [anilistBleach] }, 6)
        assert.equal(fromIndex, false)
        assert.deepEqual(items, [{ id: 269, title: "BLEACH", format: "TV", year: 2004 }])
    }
})

test("suggestions are capped", () => {
    const index = Array.from({ length: 10 }, (_, i) => ({ mediaId: i + 1, title: `T${i}` }))
    assert.equal(pickSuggestions({ index, indexFailed: false, anilist: [] }, 6).items.length, 6)
})

test("the detail line shows the matched synonym, the format and the year", () => {
    assert.equal(suggestionDetail({ id: 1, title: "x", matched: "Attack on Titan", format: "TV_SHORT", year: 2013 }), "Attack on Titan · TV SHORT · 2013")
    assert.equal(suggestionDetail(suggestionFromAnilist({ id: 2, title: { romaji: "R" }, startDate: { year: 1999 } } as any)), "1999")
})

test("completedSearchTitle searches the first index suggestion when AniList found nothing", () => {
    const base = { title: "blea", primaryDone: true, primaryCount: 0, fromIndex: true, firstSuggestion: "Bleach" }
    assert.equal(completedSearchTitle(base), "Bleach")
    assert.equal(completedSearchTitle({ ...base, primaryCount: 3 }), null, "AniList already has results")
    assert.equal(completedSearchTitle({ ...base, primaryDone: false }), null, "AniList still searching")
    assert.equal(completedSearchTitle({ ...base, fromIndex: false }), null, "suggestions are AniList's own")
    assert.equal(completedSearchTitle({ ...base, firstSuggestion: "BLEA" }), null, "same title")
    assert.equal(completedSearchTitle({ ...base, title: "  " }), null, "nothing typed")
})
