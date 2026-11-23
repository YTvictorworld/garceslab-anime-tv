import assert from "node:assert/strict"
import test from "node:test"
import {
    formatAiringTime,
    formatTimeUntil,
    hasAired,
    nextLabelUpdateDelay,
    pickUpcomingEpisodes,
} from "../src/components/tv/tv-upcoming-episodes.ts"

type Media = {
    id: number
    status?: string
    isAdult?: boolean
    nextAiringEpisode?: { airingAt: number; episode: number }
}

const entry = (id: number, progress: number, next?: { airingAt: number; episode: number }, extra: Partial<Media> = {}) => ({
    media: { id, status: "RELEASING", isAdult: false, nextAiringEpisode: next, ...extra } as Media,
    listData: { progress },
})

test("caught-up airing shows get their next episode, soonest first", () => {
    const lists = [
        {
            type: "CURRENT",
            entries: [
                entry(1, 7, { airingAt: 2000, episode: 8 }),
                entry(2, 3, { airingAt: 1000, episode: 4 }),
                // Behind: the server lists it to continue.
                entry(3, 2, { airingAt: 500, episode: 6 }),
                // Not airing any more.
                entry(4, 12),
                null,
            ],
        },
        { type: "PLANNING", entries: [entry(5, 0, { airingAt: 100, episode: 1 })] },
    ]
    const items = pickUpcomingEpisodes(lists, new Set())
    assert.deepEqual(items.map(item => [item.media.id, item.episodeNumber, item.airingAt]), [[2, 4, 1000], [1, 8, 2000]])
})

test("shows already in continue watching, adult shows and finished shows are left out", () => {
    const lists = [{
        type: "CURRENT",
        entries: [
            entry(1, 7, { airingAt: 2000, episode: 8 }),
            entry(2, 3, { airingAt: 1000, episode: 4 }, { isAdult: true }),
            entry(3, 3, { airingAt: 1000, episode: 4 }, { status: "FINISHED" }),
            entry(1, 7, { airingAt: 2000, episode: 8 }),
        ],
    }]
    assert.deepEqual(pickUpcomingEpisodes(lists, new Set([1])), [])
    assert.deepEqual(pickUpcomingEpisodes(lists, new Set(), { allowAdult: true }).map(item => item.media.id), [2, 1])
})

test("a show not started yet counts from progress 0", () => {
    const lists = [{ type: "CURRENT", entries: [{ media: { id: 9, status: "RELEASING", nextAiringEpisode: { airingAt: 10, episode: 1 } }, listData: null }] }]
    assert.deepEqual(pickUpcomingEpisodes(lists, new Set()).map(item => item.episodeNumber), [1])
})

test("aired once the time has passed", () => {
    assert.equal(hasAired(100, 99_999), false)
    assert.equal(hasAired(100, 100_000), true)
})

test("time until airing reads in minutes, hours or days", () => {
    const now = 1_000_000 * 1000
    const at = (seconds: number) => 1_000_000 + seconds
    assert.equal(formatTimeUntil(at(30), now), "in less than a minute")
    assert.equal(formatTimeUntil(at(12 * 60), now), "in 12 min")
    assert.equal(formatTimeUntil(at(5 * 3600 + 20 * 60), now), "in 5 h 20 min")
    assert.equal(formatTimeUntil(at(3 * 3600), now), "in 3 h")
    assert.equal(formatTimeUntil(at(30 * 3600), now), "in 1 day")
    assert.equal(formatTimeUntil(at(6 * 86400 + 3600), now), "in 6 days")
})

test("airing time is shown in the given time zone", () => {
    // 2026-11-30T13:30:00Z is 9:30 AM at UTC-4 (Etc/GMT+4, no DST).
    const airingAt = Date.UTC(2026, 10, 30, 13, 30) / 1000
    assert.equal(formatAiringTime(airingAt, "Etc/GMT+4"), "Mon, Nov 30, 9:30 AM")
})

test("the label is redrawn each minute and when the episode airs", () => {
    assert.equal(nextLabelUpdateDelay(1000, 1000 * 1000), null)
    assert.equal(nextLabelUpdateDelay(1000 + 3600, 1000 * 1000), 60_000)
    assert.equal(nextLabelUpdateDelay(1000 + 10, 1000 * 1000), 10_500)
})

test("an unknown time zone falls back to the TV's", () => {
    const airingAt = Date.UTC(2026, 10, 30, 13, 30) / 1000
    assert.equal(formatAiringTime(airingAt, "Not/AZone"), formatAiringTime(airingAt))
})
