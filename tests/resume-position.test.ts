import assert from "node:assert/strict"
import test from "node:test"
import type { Continuity_WatchHistory } from "../src/api/generated/types.ts"
import { getWatchHistoryResumePercent, getWatchHistoryResumePosition, WEB_TV_RESUME_RULE } from "../src/lib/player/resume-position.ts"

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

test("web TVs resume from 10 seconds in, up to 90 %", () => {
    const at = (time: number, duration = 1440) => getWatchHistoryResumePosition(history(4, time, duration), { mediaId: 154587, episodeNumber: 4 }, WEB_TV_RESUME_RULE)
    assert.equal(at(9.9), null)
    assert.equal(at(10), 10)
    assert.equal(at(57), 57)
    assert.equal(at(1295), 1295)
    assert.equal(at(1296), null)
    assert.equal(at(30, 0), null)
    assert.equal(getWatchHistoryResumePosition(history(3, 600), { mediaId: 154587, episodeNumber: 4 }, WEB_TV_RESUME_RULE), null)
})

test("the progress bar shows exactly when there is a position to resume", () => {
    const at = (time: number) => getWatchHistoryResumePercent(history(4, time), { mediaId: 154587, episodeNumber: 4 }, WEB_TV_RESUME_RULE)
    // 57 s of 24 min: resumed, so the bar shows (the old 5 % rule hid it).
    assert.equal(at(57), 4)
    // 12 s is under 1 %: still a bar, at the minimum width.
    assert.equal(at(12), 1)
    assert.equal(at(9), 0)
    assert.equal(at(1400), 0)
    assert.equal(getWatchHistoryResumePercent(history(3, 600), { mediaId: 154587, episodeNumber: 4 }, WEB_TV_RESUME_RULE), 0)
    // Other platforms keep 2 %.
    assert.equal(getWatchHistoryResumePercent(history(4, 12), { mediaId: 154587, episodeNumber: 4 }), 0)
    assert.equal(getWatchHistoryResumePercent(history(4, 29), { mediaId: 154587, episodeNumber: 4 }), 2)
})
