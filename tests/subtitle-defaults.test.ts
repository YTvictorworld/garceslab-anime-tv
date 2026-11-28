import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { readMkvIndex } from "../src/lib/player/mkv/mkv-demux.ts"
import { createPlayerPrefsSync } from "../src/lib/player/player-prefs-sync.ts"
import {
    DEFAULT_SUBTITLE_LANGUAGES,
    isPreviousSubtitleDefault,
    migrateDeviceSubtitleDefault,
    PREVIOUS_DEFAULT_SUBTITLE_LANGUAGES,
} from "../src/lib/player/subtitle-defaults.ts"
import { createSubtitleAutoSelect } from "../src/lib/player/track-matching.ts"

/*
 * Issue #11 follow-up: Spanish (Latin America first) is the default subtitle
 * language, and devices and profiles that still have the previous English-only
 * default get it once, without touching values someone chose.
 */

const IGNORED = "signs & songs, signs, songs, sign, song"

test("the default is Latin American Spanish, any Spanish, then English", () => {
    assert.equal(DEFAULT_SUBTITLE_LANGUAGES, "es-419, spa, es, spanish, eng, en, english")
    assert.equal(PREVIOUS_DEFAULT_SUBTITLE_LANGUAGES, "eng, en, english")
})

test("with the default, the MultiSub fixture (English first and default) starts in es-419", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/mkv/multisub.mkv", import.meta.url)))
    const index = await readMkvIndex({
        read: async (start, length) => bytes.subarray(start, Math.min(bytes.length, start + length)),
        size: () => bytes.length,
    })
    const tracks = index.tracks.filter(track => track.kind === "subtitle").map((track, i) => ({
        id: i + 1,
        language: track.languageIETF || track.language,
        title: track.name,
        forced: track.forced,
        selected: false,
    }))
    const choice = createSubtitleAutoSelect().decide(tracks, { showSubtitles: true, preferredSubtitleLanguages: DEFAULT_SUBTITLE_LANGUAGES, ignoredSubtitleLabels: IGNORED })
    assert.equal(choice, 2)
    assert.equal(tracks[1].language, "es-419")
})

test("the previous default is recognised whatever its case and spacing, nothing else is", () => {
    for (const v of ["eng, en, english", "eng,en,english", " ENG , En ,English ", "eng, en, english,"]) assert.equal(isPreviousSubtitleDefault(v), true, v)
    for (const v of ["eng, en", "jpn", "english, eng, en", "spa, es", "", undefined, 3]) assert.equal(isPreviousSubtitleDefault(v), false, String(v))
})

test("device: the previous default is migrated once; other values are only marked", () => {
    const old = { preferredSubtitleLanguages: "eng, en, english", speed: 1.5, preferredAudioLanguages: "jpn, jp, ja, japanese" }
    const migrated = migrateDeviceSubtitleDefault(old)!
    assert.equal(migrated.preferredSubtitleLanguages, DEFAULT_SUBTITLE_LANGUAGES)
    assert.equal(migrated.speed, 1.5)
    assert.equal(migrated.preferredAudioLanguages, "jpn, jp, ja, japanese")
    // Idempotent: a migrated device is left alone, even if English is set again by hand later.
    assert.equal(migrateDeviceSubtitleDefault(migrated), null)
    assert.equal(migrateDeviceSubtitleDefault({ ...migrated, preferredSubtitleLanguages: "eng, en, english" }), null)

    const custom = migrateDeviceSubtitleDefault({ preferredSubtitleLanguages: "jpn" })!
    assert.equal(custom.preferredSubtitleLanguages, "jpn")
    assert.equal(custom.subtitleDefaultVersion, 2)
})

function profile(server: Record<string, unknown> | null, local: Record<string, unknown> = { preferredSubtitleLanguages: DEFAULT_SUBTITLE_LANGUAGES, speed: 1 }) {
    let store = { ...local }
    const saved: Array<Record<string, unknown>> = []
    let checked = false
    let failSaves = false
    const deps = {
        fetchPrefs: async () => (server ? { tv: server } : {}),
        savePrefs: async (tv: Record<string, unknown>) => {
            if (failSaves) throw new Error("offline")
            saved.push(tv)
            if (server) server = { ...server, ...tv }
        },
        getLocal: () => store,
        setLocal: (next: Record<string, unknown>) => {
            store = next
        },
        schedule: () => () => undefined,
        subtitleDefault: { isChecked: () => checked, markChecked: () => { checked = true } },
    }
    return {
        deps,
        saved,
        store: () => store,
        server: () => server,
        checked: () => checked,
        failSaves: (v: boolean) => { failSaves = v },
        setServer: (v: Record<string, unknown>) => { server = v },
    }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test("profile: a new profile gets the Spanish-first default from this TV", async () => {
    const p = profile(null)
    await createPlayerPrefsSync(p.deps).load()
    await flush()
    assert.equal(p.saved[0].preferredSubtitleLanguages, DEFAULT_SUBTITLE_LANGUAGES)
    assert.equal(p.checked(), true)
})

test("profile: the previous default saved on the server is migrated once, through the sync, and nothing else changes", async () => {
    const p = profile({ preferredSubtitleLanguages: "eng, en, english", subtitleFontSize: 60, preferredAudioLanguages: "jpn" })
    await createPlayerPrefsSync(p.deps).load()
    await flush()
    assert.equal(p.store().preferredSubtitleLanguages, DEFAULT_SUBTITLE_LANGUAGES)
    assert.equal(p.store().subtitleFontSize, 60)
    assert.deepEqual(p.saved, [{ preferredSubtitleLanguages: DEFAULT_SUBTITLE_LANGUAGES }], "only the subtitle languages are written")
    assert.equal(p.checked(), true)

    // Idempotent: loading again saves nothing.
    await createPlayerPrefsSync(p.deps).load()
    await flush()
    assert.equal(p.saved.length, 1)

    // English chosen again by hand afterwards stays English.
    p.setServer({ ...p.server(), preferredSubtitleLanguages: "eng, en, english" })
    await createPlayerPrefsSync(p.deps).load()
    await flush()
    assert.equal(p.store().preferredSubtitleLanguages, "eng, en, english")
    assert.equal(p.saved.length, 1)
})

test("profile: customised languages are never touched", async () => {
    for (const value of ["eng, en", "jpn", "english, eng", "spa, es"]) {
        const p = profile({ preferredSubtitleLanguages: value })
        await createPlayerPrefsSync(p.deps).load()
        await flush()
        assert.equal(p.store().preferredSubtitleLanguages, value)
        assert.equal(p.saved.length, 0, value)
        assert.equal(p.checked(), true, "checked, so a later change to English is kept")
    }
})

test("profile: a migration whose save failed is tried again on the next load", async () => {
    const p = profile({ preferredSubtitleLanguages: "ENG,EN,ENGLISH" })
    p.failSaves(true)
    await createPlayerPrefsSync(p.deps).load()
    await flush()
    assert.equal(p.checked(), false)
    p.failSaves(false)
    await createPlayerPrefsSync(p.deps).load()
    await flush()
    assert.deepEqual(p.saved, [{ preferredSubtitleLanguages: DEFAULT_SUBTITLE_LANGUAGES }])
    assert.equal(p.checked(), true)
})

test("profile: without the migration hook (old callers) the sync behaves as before", async () => {
    const p = profile({ preferredSubtitleLanguages: "eng, en, english" })
    const { subtitleDefault: _, ...deps } = p.deps
    await createPlayerPrefsSync(deps).load()
    assert.equal(p.store().preferredSubtitleLanguages, "eng, en, english")
    assert.equal(p.saved.length, 0)
})
