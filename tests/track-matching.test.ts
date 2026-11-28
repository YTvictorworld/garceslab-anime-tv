import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { streamedSubtitleTracks } from "../src/lib/player/direct-stream-format.ts"
import { readMkvIndex, type RangeReader } from "../src/lib/player/mkv/mkv-demux.ts"
import { chooseSubtitleTrack, createSubtitleAutoSelect, findFallbackTrack, findPreferredTrack, normalizeLanguage, trackLanguages } from "../src/lib/player/track-matching.ts"

/*
 * Issue #11: Spanish subtitles must be selected at start when the release has
 * a full Spanish track and the profile prefers Spanish, whatever the file's
 * default flag says and however the track is tagged or named.
 */

const IGNORED = "signs & songs, signs, songs, sign, song"

type Track = { id: number; language?: string; title?: string; forced?: boolean }

/** Tracks listed in file order, ids from 1, as the web player lists them. */
function tracks(...list: Array<Omit<Track, "id">>): Track[] {
    return list.map((track, i) => ({ id: i + 1, ...track }))
}

function fixtureReader(name: string): RangeReader {
    const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/mkv/${name}`, import.meta.url)))
    return {
        read: async (start, length) => bytes.subarray(start, Math.min(bytes.length, start + length)),
        size: () => bytes.length,
    }
}

/** The fixture's subtitle tracks as direct play hands them to the web player (direct-play-session.ts). */
async function multisubTracks() {
    const index = await readMkvIndex(fixtureReader("multisub.mkv"))
    const subs = index.tracks.filter(track => track.kind === "subtitle")
    // The model of the real case: English first and flagged default, Spanish after it.
    assert.equal(subs[0].languageIETF, "en")
    assert.equal(subs[0].default, true)
    assert.equal(subs[1].languageIETF, "es-419")
    assert.equal(subs[1].default, false)
    return subs.map((track, i) => ({
        id: i + 1,
        language: track.languageIETF || track.language,
        title: track.name,
        forced: track.forced,
    }))
}

test("MultiSub fixture: a Spanish preference picks es-419 although English is first and default", async () => {
    const list = await multisubTracks()
    for (const pref of ["spa, es, spanish", "es, spa, spanish", "spanish", "español", "es-419", "spa, es-419, es-es, spanish, español"]) {
        assert.equal(findPreferredTrack(list, pref, IGNORED), 2, pref)
    }
    // es-ES alone asks for Spain's track.
    assert.equal(findPreferredTrack(list, "es-es", IGNORED), 3)
    // The default preference keeps choosing English.
    assert.equal(findPreferredTrack(list, "eng, en, english", IGNORED), 1)
})

test("a bare \"es\" doesn't match Portuguese, Japanese, Chinese or Czech", () => {
    const legacy = tracks(
        { language: "eng", title: "English" },
        { language: "por", title: "Portuguese (Brazil)" },
        { language: "spa", title: "Spanish (Latin America)" },
    )
    assert.equal(findPreferredTrack(legacy, "es, spa, spanish", IGNORED), 3)

    const japaneseFirst = tracks(
        { language: "jpn", title: "Japanese" },
        { language: "por" },
        { language: "spa" },
    )
    assert.equal(findPreferredTrack(japaneseFirst, "es, spa, spanish", IGNORED), 3)

    const noSpanish = tracks(
        { language: "chi", title: "Chinese (Simplified)" },
        { language: "ces", title: "Czech" },
        { language: "jpn", title: "Japanese" },
        { language: "por", title: "Portuguese" },
        { language: "des", title: "Description" },
    )
    assert.equal(findPreferredTrack(noSpanish, "es, spa, spanish", IGNORED), null)
})

test("every common way of tagging or naming Spanish is recognised", () => {
    const cases: Array<Omit<Track, "id">> = [
        { language: "es" },
        { language: "es-419" },
        { language: "es-ES" },
        { language: "es-MX" },
        { language: "es_419" },
        { language: "spa" },
        { language: "SPA" },
        { language: "esp" },
        { language: "und", title: "Español" },
        { title: "Spanish (Latin America)" },
        { title: "Español (España)" },
        { title: "Espanol" },
        { title: "[Latino] Full Subs" },
        { title: "Castellano" },
    ]
    for (const spanish of cases) {
        const list = tracks({ language: "en", title: "English" }, { language: "pt-BR", title: "Portuguese (Brazil)" }, spanish)
        for (const pref of ["es", "spa", "spanish", "español"]) {
            assert.equal(findPreferredTrack(list, pref, IGNORED), 3, `${JSON.stringify(spanish)} with "${pref}"`)
        }
    }
})

test("a Spanish-named track that Matroska left tagged \"eng\" (its default) is Spanish too", () => {
    // Matroska's Language defaults to "eng" when the muxer didn't write one.
    const list = tracks({ language: "eng", title: "English" }, { language: "eng", title: "Spanish" })
    assert.equal(findPreferredTrack(list, "spa, es, spanish", IGNORED), 2)
})

test("a full Spanish track wins over a forced or signs-only Spanish track listed before it", () => {
    const forcedFlag = tracks(
        { language: "en", title: "English" },
        { language: "es-419", title: "Spanish", forced: true },
        { language: "es-419", title: "Spanish" },
    )
    assert.equal(findPreferredTrack(forcedFlag, "spa, es, spanish", IGNORED), 3)

    const forcedName = tracks(
        { language: "spa", title: "Spanish (Forced)" },
        { language: "spa", title: "Spanish" },
    )
    assert.equal(findPreferredTrack(forcedName, "es", IGNORED), 2)

    const signs = tracks(
        { language: "en", title: "English" },
        { language: "spa", title: "Signs & Songs [Spanish]" },
        { language: "spa", title: "Full Subtitles [Spanish]" },
    )
    assert.equal(findPreferredTrack(signs, "spa, es, spanish", IGNORED), 3)
})

test("only forced or signs Spanish: the next preferred language is used, then the fallback", () => {
    const list = tracks(
        { language: "es", title: "Signs" },
        { language: "es", forced: true },
        { language: "en", title: "English" },
    )
    assert.equal(findPreferredTrack(list, "spa, es, eng", IGNORED), 3)
    assert.equal(findPreferredTrack(list, "spa, es", IGNORED), null)
    assert.equal(findFallbackTrack(list, IGNORED), 3)
})

test("no Spanish in the file: falls back as before", () => {
    const list = tracks({ language: "en", title: "English" }, { language: "fr", title: "French" })
    assert.equal(findPreferredTrack(list, "spa, es, spanish", IGNORED), null)
    assert.equal(findPreferredTrack(list, "spa, es, spanish, eng, en, english", IGNORED), 1)
    assert.equal(findFallbackTrack(list, IGNORED), 1)
    // The fallback skips signs & songs and forced tracks.
    const signsFirst = tracks({ language: "en", title: "Signs & Songs" }, { language: "en", forced: true }, { language: "en", title: "Dialogue" })
    assert.equal(findFallbackTrack(signsFirst, IGNORED), 3)
})

test("the English default keeps working with IETF and legacy tags", () => {
    assert.equal(findPreferredTrack(tracks({ language: "ja" }, { language: "en-US" }), "eng, en, english", IGNORED), 2)
    assert.equal(findPreferredTrack(tracks({ language: "jpn" }, { language: "eng" }), "eng, en, english", IGNORED), 2)
    assert.equal(findPreferredTrack(tracks({ title: "Japanese" }, { title: "English Subtitles" }), "eng, en, english", IGNORED), 2)
})

test("the preference order is kept: the first preferred language in the file wins", () => {
    const list = tracks({ language: "en" }, { language: "es-419" })
    assert.equal(findPreferredTrack(list, "spa, es, eng", IGNORED), 2)
    assert.equal(findPreferredTrack(list, "eng, spa", IGNORED), 1)
})

test("audio: Japanese preference matches jpn, ja and \"Japanese\" without matching other names", () => {
    const audio = tracks({ language: "eng", title: "English" }, { language: "jpn", title: "Japanese" })
    assert.equal(findPreferredTrack(audio, "jpn, jp, ja, japanese"), 2)
    assert.equal(findPreferredTrack(tracks({ language: "en" }, { language: "ja" }), "jpn, jp, ja, japanese"), 2)
    assert.equal(findPreferredTrack(tracks({ language: "en" }), "jpn, jp, ja, japanese"), null)
})

test("empty input picks nothing", () => {
    assert.equal(findPreferredTrack([], "spa"), null)
    assert.equal(findPreferredTrack(tracks({ language: "es" }), "  "), null)
    assert.equal(findFallbackTrack([], IGNORED), null)
})

test("language normalisation: codes, IETF tags and names", () => {
    for (const v of ["es", "spa", "SPA", "es-419", "es_ES", "Español", "espanol", "Spanish"]) assert.equal(normalizeLanguage(v), "es", v)
    for (const v of ["", "und", "zxx", undefined]) assert.equal(normalizeLanguage(v), "")
    assert.equal(normalizeLanguage("por"), "pt")
    assert.deepEqual(trackLanguages({ language: "eng", title: "Spanish (Latin America)" }), ["en", "es"])
    assert.deepEqual(trackLanguages({ language: "por", title: "Portuguese" }), ["pt"])
})

const SPANISH = { showSubtitles: true, preferredSubtitleLanguages: "spa, es, spanish", ignoredSubtitleLabels: IGNORED }
const ENGLISH = { showSubtitles: true, preferredSubtitleLanguages: "eng, en, english", ignoredSubtitleLabels: IGNORED }

const selected = <T extends Track>(list: T[], id: number | null) => list.map(track => ({ ...track, selected: track.id === id }))

test("mpv started on the file's default (English): the preferred Spanish track replaces it", () => {
    const list = selected(tracks({ language: "en", title: "English" }, { language: "es-419", title: "Spanish (Latin America)" }), 1)
    assert.equal(chooseSubtitleTrack(list, SPANISH), 2)
    // Already on the preferred one, or subtitles off: nothing to do.
    assert.equal(chooseSubtitleTrack(selected(list, 2), SPANISH), null)
    assert.equal(chooseSubtitleTrack(list, { ...SPANISH, showSubtitles: false }), null)
    // No preferred track: the file's default stays (mpv), none selected gets the first full one (web).
    assert.equal(chooseSubtitleTrack(list, { ...SPANISH, preferredSubtitleLanguages: "ger" }), null)
    assert.equal(chooseSubtitleTrack(selected(list, null), { ...SPANISH, preferredSubtitleLanguages: "ger" }), 1)
})

test("auto-select: runs when tracks appear and again when more appear", () => {
    const auto = createSubtitleAutoSelect()
    const english = tracks({ language: "en", title: "English" })
    // The server's list may arrive before the file's header with every track.
    assert.equal(auto.decide(selected(english, null), SPANISH), 1)
    assert.equal(auto.decide(selected(english, 1), SPANISH), null)
    const all = tracks({ language: "en", title: "English" }, { language: "es-419", title: "Spanish (Latin America)" })
    assert.equal(auto.decide(selected(all, 1), SPANISH), 2)
    assert.equal(auto.decide(selected(all, 2), SPANISH), null)
})

test("auto-select: the profile's preferences arriving after the tracks re-apply the choice once", () => {
    const auto = createSubtitleAutoSelect()
    const list = tracks({ language: "en", title: "English" }, { language: "es-419", title: "Spanish (Latin America)" })
    // The device's defaults first (English)...
    assert.equal(auto.decide(selected(list, null), ENGLISH), 1)
    assert.equal(auto.decide(selected(list, 1), ENGLISH), null)
    // ...then the profile sync brings Spanish.
    assert.equal(auto.decide(selected(list, 1), SPANISH), 2)
    // Once: the same preferences and tracks don't switch again.
    assert.equal(auto.decide(selected(list, 1), SPANISH), null)
})

test("auto-select: never overrides the viewer's own choice", () => {
    const auto = createSubtitleAutoSelect()
    const list = tracks({ language: "en", title: "English" }, { language: "es-419", title: "Spanish (Latin America)" })
    assert.equal(auto.decide(selected(list, null), ENGLISH), 1)
    auto.userChose()
    assert.equal(auto.hasUserChosen(), true)
    // Preferences that arrive later, or more tracks, leave the viewer's track alone.
    assert.equal(auto.decide(selected(list, 1), SPANISH), null)
    const more = [...list, { id: 3, language: "es-ES", title: "Spanish (Spain)" }]
    assert.equal(auto.decide(selected(more, 1), SPANISH), null)
})

test("auto-select: subtitles turned off are respected until they are turned on", () => {
    const auto = createSubtitleAutoSelect()
    const list = tracks({ language: "es" })
    assert.equal(auto.decide(selected(list, null), { ...SPANISH, showSubtitles: false }), null)
    assert.equal(auto.decide(selected(list, null), SPANISH), 1)
})

test("auto-select: a new URL (direct play -> transcode) lists the same tracks again and they are chosen again", () => {
    const auto = createSubtitleAutoSelect()
    const list = tracks({ language: "en" }, { language: "es-419" })
    assert.equal(auto.decide(selected(list, null), SPANISH), 2)
    auto.userChose()
    // The reloaded player starts with none selected and as many tracks as before.
    auto.reset()
    assert.equal(auto.hasUserChosen(), false)
    assert.equal(auto.decide(selected(list, null), SPANISH), 2)
})

test("relayed play lists the server's tracks with their IETF tag and forced flag, and the same choice is made", () => {
    const metadata = {
        subtitleTracks: [
            { number: 3, name: "English", language: "eng", languageIETF: "en", codecID: "S_TEXT/ASS", default: true, forced: false },
            { number: 4, name: "Spanish (Signs)", language: "spa", languageIETF: "es-419", codecID: "S_TEXT/ASS", default: false, forced: true },
            { number: 5, name: "Spanish (Latin America)", language: "eng", languageIETF: "es-419", codecID: "S_TEXT/ASS", default: false, forced: false },
        ],
    } as unknown as Parameters<typeof streamedSubtitleTracks>[0]
    const listed = streamedSubtitleTracks(metadata)
    assert.deepEqual(listed.map(track => [track.lang, track.forced]), [["en", undefined], ["es-419", true], ["es-419", undefined]])
    // The web player numbers them from 1 in this order.
    const list = listed.map((track, i) => ({ id: i + 1, language: track.lang, title: track.title, forced: track.forced }))
    assert.equal(findPreferredTrack(list, "spa, es, spanish", IGNORED), 3)
})

test("a regional preference picks that region first, by tag or by name, then any Spanish", () => {
    const spainFirst = tracks(
        { language: "en", title: "English" },
        { language: "es-ES", title: "Spanish (Spain)" },
        { language: "es-419", title: "Spanish (Latin America)" },
    )
    assert.equal(findPreferredTrack(spainFirst, "es-419, spa, es, spanish, eng", IGNORED), 3)
    assert.equal(findPreferredTrack(spainFirst, "spa, es, spanish", IGNORED), 2)
    // Legacy tags only: the region comes from the name.
    const byName = tracks({ language: "spa", title: "Castellano" }, { language: "spa", title: "Español Latino" })
    assert.equal(findPreferredTrack(byName, "es-419, es", IGNORED), 2)
    assert.equal(findPreferredTrack(byName, "es-es, es", IGNORED), 1)
    // Only the other region: still Spanish.
    assert.equal(findPreferredTrack(tracks({ language: "en" }, { language: "es-ES" }), "es-419, eng", IGNORED), 2)
})
