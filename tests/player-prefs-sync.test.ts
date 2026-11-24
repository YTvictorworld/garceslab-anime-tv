import assert from "node:assert/strict"
import test from "node:test"
import {
    changedSyncedPlayerPrefs,
    createPlayerPrefsSync,
    mergeServerPlayerPrefs,
    pickSyncedPlayerPrefs,
    SYNCED_PLAYER_PREF_KEYS,
} from "../src/lib/player/player-prefs-sync.ts"

const local = {
    speed: 1,
    subtitleFontSize: 48,
    preferredAudioLanguages: "jpn",
    preferredSubtitleLanguages: "eng",
    autoNextEpisode: true,
    wyzieApiKey: "secret",
    externalPlayerTemplate: null,
    androidVideoOutput: "gpu-next",
    subtitleDelay: 0.5,
}

test("only profile preferences are synced, never device ones", () => {
    const picked = pickSyncedPlayerPrefs(local) as Record<string, unknown>
    assert.equal(picked.preferredAudioLanguages, "jpn")
    assert.equal(picked.subtitleFontSize, 48)
    for (const key of ["wyzieApiKey", "externalPlayerTemplate", "androidVideoOutput", "subtitleDelay"]) {
        assert.equal(key in picked, false, key)
        assert.equal(SYNCED_PLAYER_PREF_KEYS.includes(key as never), false, key)
    }
    assert.deepEqual(pickSyncedPlayerPrefs({ speed: "fast", subtitleFontSize: Number.NaN }), {})
})

test("the profile's saved values replace the device's, wrong types are ignored", () => {
    const merged = mergeServerPlayerPrefs(local, { preferredAudioLanguages: "spa", speed: "x" as never })
    assert.equal(merged.preferredAudioLanguages, "spa")
    assert.equal(merged.speed, 1)
    assert.equal(merged.wyzieApiKey, "secret")
    assert.equal(mergeServerPlayerPrefs(local, null), local)
})

test("changes are the synced values that differ", () => {
    assert.equal(changedSyncedPlayerPrefs({ speed: 1 }, { speed: 1 }), null)
    assert.deepEqual(changedSyncedPlayerPrefs({ speed: 1, autoPlay: true }, { speed: 1.5, autoPlay: true }), { speed: 1.5 })
})

function fakeDeps(server: Record<string, unknown> | null | Error) {
    let store: Record<string, unknown> = { ...local }
    const saved: unknown[] = []
    const timers: Array<() => void> = []
    return {
        saved,
        timers,
        store: () => store,
        deps: {
            fetchPrefs: async () => {
                if (server instanceof Error) throw server
                return server ? { tv: server } : {}
            },
            savePrefs: async (tv: unknown) => {
                saved.push(tv)
            },
            getLocal: () => store,
            setLocal: (next: Record<string, unknown>) => {
                store = next
            },
            schedule: (fn: () => void) => {
                timers.push(fn)
                return () => {
                    const i = timers.indexOf(fn)
                    if (i >= 0) timers.splice(i, 1)
                }
            },
        },
        edit: (update: Record<string, unknown>) => {
            store = { ...store, ...update }
        },
    }
}

test("entering a profile loads its preferences, then saves only changes", async () => {
    const f = fakeDeps({ preferredSubtitleLanguages: "spa", subtitleFontSize: 60 })
    const sync = createPlayerPrefsSync(f.deps)
    assert.equal(await sync.load(), true)
    assert.equal(f.store().preferredSubtitleLanguages, "spa")
    assert.equal(f.store().subtitleFontSize, 60)
    assert.equal(f.store().wyzieApiKey, "secret")
    assert.equal(f.saved.length, 0, "loading doesn't save")

    // Applying the server's values is not a change.
    sync.localChanged()
    f.timers.shift()?.()
    assert.equal(f.saved.length, 0)

    f.edit({ speed: 1.25 })
    sync.localChanged()
    f.edit({ speed: 1.5 })
    sync.localChanged()
    assert.equal(f.timers.length, 1, "debounced")
    f.timers.shift()?.()
    assert.deepEqual(f.saved, [{ speed: 1.5 }])

    // A device-only change is not sent.
    f.edit({ wyzieApiKey: "other" })
    sync.localChanged()
    f.timers.shift()?.()
    assert.equal(f.saved.length, 1)
})

test("a profile without saved preferences takes this TV's as its first copy", async () => {
    const f = fakeDeps(null)
    const sync = createPlayerPrefsSync(f.deps)
    await sync.load()
    assert.equal(f.saved.length, 1)
    const first = f.saved[0] as Record<string, unknown>
    assert.equal(first.preferredAudioLanguages, "jpn")
    assert.equal("wyzieApiKey" in first, false)
})

test("an old server keeps the device's preferences and never saves", async () => {
    const f = fakeDeps(new Error("404"))
    const sync = createPlayerPrefsSync(f.deps)
    assert.equal(await sync.load(), false)
    f.edit({ speed: 2 })
    sync.localChanged()
    assert.equal(f.timers.length, 0)
    assert.equal(f.saved.length, 0)
})

test("after leaving the profile nothing is saved to it", async () => {
    const f = fakeDeps({ speed: 1 })
    const sync = createPlayerPrefsSync(f.deps)
    await sync.load()
    f.edit({ speed: 2 })
    sync.localChanged()
    sync.stop()
    assert.equal(f.timers.length, 0)
    assert.equal(f.saved.length, 0)
    assert.equal(sync.isLoaded(), false)
})
