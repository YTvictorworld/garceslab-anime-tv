import assert from "node:assert/strict"
import test from "node:test"
import type { Continuity_WatchHistory } from "../src/api/generated/types.ts"
import { getWatchHistoryResumePercent, getWatchHistoryResumePosition } from "../src/lib/player/resume-position.ts"

const history = (episodeNumber: number, currentTime: number, duration = 1440): Continuity_WatchHistory => ({
    154587: { kind: "mediastream", filepath: "/a.mkv", mediaId: 154587, episodeNumber, currentTime, duration },
})

test("resumes the same episode between 2 % and 90 %", () => {
    assert.equal(getWatchHistoryResumePosition(history(4, 600), { mediaId: 154587, episodeNumber: 4 }), 600)
})

test("starts over near the beginning or the end, or for another episode", () => {
    assert.equal(getWatchHistoryResumePosition(history(4, 10), { mediaId: 154587, episodeNumber: 4 }), null)
    assert.equal(getWatchHistoryResumePosition(history(4, 1400), { mediaId: 154587, episodeNumber: 4 }), null)
    assert.equal(getWatchHistoryResumePosition(history(3, 600), { mediaId: 154587, episodeNumber: 4 }), null)
    assert.equal(getWatchHistoryResumePosition(history(4, 600, 0), { mediaId: 154587, episodeNumber: 4 }), null)
    assert.equal(getWatchHistoryResumePosition(undefined, { mediaId: 154587, episodeNumber: 4 }), null)
})

test("the progress bar shows exactly when there is a position to resume", () => {
    const at = (time: number) => getWatchHistoryResumePercent(history(4, time), { mediaId: 154587, episodeNumber: 4 })
    // 57 s of 24 min: resumed, so the bar shows (the old 5 % rule hid it).
    assert.equal(at(57), 4)
    assert.equal(at(29), 2)
    assert.equal(at(10), 0)
    assert.equal(at(1400), 0)
    assert.equal(getWatchHistoryResumePercent(history(3, 600), { mediaId: 154587, episodeNumber: 4 }), 0)
})
