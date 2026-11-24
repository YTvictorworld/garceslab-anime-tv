import assert from "node:assert/strict"
import test from "node:test"
import {
    buildScheduleWeek,
    dayKey,
    smallCoverUrl,
    weekStartKey,
    formatAiringClock,
    groupScheduleByDay,
    initialScheduleFocus,
    nextDayKeys,
    scheduleFromCollection,
} from "../src/lib/tv/schedule-days.ts"

const item = (mediaId: number, episodeNumber: number, dateTime: string | undefined, title = `Show ${mediaId}`) =>
    ({ mediaId, episodeNumber, dateTime, title, image: `cover-${mediaId}` })

// Tuesday 2026-11-24 10:00 in La Paz (UTC-4) = 14:00 UTC.
const NOW = Date.parse("2026-11-24T14:00:00Z")
const LA_PAZ = "America/La_Paz"
const TOKYO = "Asia/Tokyo"

test("day keys follow the time zone", () => {
    const lateEvening = Date.parse("2026-11-25T02:30:00Z")
    assert.equal(dayKey(lateEvening, LA_PAZ), "2026-11-24")
    assert.equal(dayKey(lateEvening, TOKYO), "2026-11-25")
    assert.equal(dayKey(lateEvening, "UTC"), "2026-11-25")
})

test("calendar days step over month ends and DST changes", () => {
    assert.deepEqual(nextDayKeys("2026-11-29", 3), ["2026-11-29", "2026-11-30", "2026-12-01"])
    assert.deepEqual(nextDayKeys("2026-03-07", 3), ["2026-03-07", "2026-03-08", "2026-03-09"])
})

test("episodes are grouped by local day with Today / Tomorrow / weekday labels", () => {
    const days = groupScheduleByDay([
        item(1, 5, "2026-11-24T12:00:00Z"), // 08:00 today, aired
        item(2, 3, "2026-11-25T02:30:00Z"), // 22:30 today (still the 24th in La Paz)
        item(3, 9, "2026-11-25T15:00:00Z"), // tomorrow
        item(4, 1, "2026-11-27T01:00:00Z"), // Thursday 21:00 local
        item(5, 2, "2026-12-05T01:00:00Z"), // outside the week
        item(6, 2, "2026-11-20T01:00:00Z"), // last week
        item(7, 1, undefined), // no time
    ], { now: NOW, timeZone: LA_PAZ })

    assert.equal(days.length, 7)
    assert.deepEqual(days.map(day => day.label), ["Today", "Tomorrow", "Thursday", "Friday", "Saturday", "Sunday", "Monday"])
    assert.equal(days[0].dateLabel, "Nov 24")
    assert.deepEqual(days[0].items.map(entry => entry.item.mediaId), [1, 2])
    assert.deepEqual(days[0].items.map(entry => entry.aired), [true, false])
    assert.deepEqual(days[1].items.map(entry => entry.item.mediaId), [3])
    assert.deepEqual(days[2].items.map(entry => entry.item.mediaId), [4])
    assert.equal(days.flatMap(day => day.items).length, 4)
})

test("the same items fall on other days in another time zone", () => {
    const days = groupScheduleByDay([item(2, 3, "2026-11-25T02:30:00Z")], { now: NOW, timeZone: TOKYO })
    // In Tokyo it is already the 24th at 23:00; the episode is on the 25th.
    assert.deepEqual(days[1].items.map(entry => entry.item.mediaId), [2])
    assert.equal(days[0].items.length, 0)
})

test("duplicates count once, items sort by time then title, watched follows progress", () => {
    const days = groupScheduleByDay([
        item(9, 4, "2026-11-24T20:00:00Z", "Zeta"),
        item(8, 2, "2026-11-24T20:00:00Z", "Alpha"),
        item(9, 4, "2026-11-24T20:00:00Z", "Zeta"),
        item(7, 6, "2026-11-24T18:00:00Z", "Mid"),
    ], { now: NOW, timeZone: LA_PAZ, progressOf: id => (id === 9 ? 4 : id === 7 ? 2 : undefined) })
    assert.deepEqual(days[0].items.map(entry => entry.item.title), ["Mid", "Alpha", "Zeta"])
    assert.deepEqual(days[0].items.map(entry => entry.watched), [false, false, true])
})

test("an unknown time zone falls back to the TV's own", () => {
    assert.doesNotThrow(() => groupScheduleByDay([item(1, 1, "2026-11-24T20:00:00Z")], { now: NOW, timeZone: "Not/AZone" }))
    assert.match(formatAiringClock(Date.parse("2026-11-25T01:30:00Z"), LA_PAZ), /^9:30\sPM$/)
    assert.match(formatAiringClock(Date.parse("2026-11-25T01:30:00Z"), TOKYO), /^10:30\sAM$/)
})

test("focus starts on the next episode to air, else the last one that aired", () => {
    const days = groupScheduleByDay([
        item(1, 5, "2026-11-24T12:00:00Z"),
        item(2, 3, "2026-11-25T02:30:00Z"),
    ], { now: NOW, timeZone: LA_PAZ })
    assert.deepEqual(initialScheduleFocus(days), { day: 0, index: 1 })

    const allAired = groupScheduleByDay([item(1, 5, "2026-11-24T12:00:00Z")], { now: NOW, timeZone: LA_PAZ })
    assert.deepEqual(initialScheduleFocus(allAired), { day: 0, index: 0 })
    assert.equal(initialScheduleFocus(groupScheduleByDay([], { now: NOW })), null)
})

test("an older server's schedule comes from the collection's next episodes", () => {
    const media = (id: number, airingAt: number | null, extra = {}) => ({
        id,
        title: { userPreferred: `Show ${id}` },
        coverImage: { large: `large-${id}`, medium: `medium-${id}` },
        episodes: 12,
        nextAiringEpisode: airingAt ? { airingAt, episode: 12 } : null,
        ...extra,
    })
    const items = scheduleFromCollection([
        { status: "CURRENT", entries: [{ media: media(1, 1795800000) }, { media: media(2, null) }] },
        { status: "PLANNING", entries: [{ media: media(1, 1795800000) }, { media: media(3, 1795900000, { format: "MOVIE" }) }] },
        { status: "DROPPED", entries: [{ media: media(4, 1795800000) }] },
    ])
    assert.deepEqual(items.map(entry => entry.mediaId), [1, 3])
    assert.equal(items[0].dateTime, new Date(1795800000 * 1000).toISOString())
    assert.equal(items[0].image, "large-1")
    assert.equal(items[0].isSeasonFinale, true)
    assert.equal(items[1].isMovie, true)
})

test("weeks start on Monday like the web's calendar, or on Sunday", () => {
    assert.equal(weekStartKey("2026-11-24"), "2026-11-23") // Tuesday -> Monday
    assert.equal(weekStartKey("2026-11-23"), "2026-11-23")
    assert.equal(weekStartKey("2026-11-29"), "2026-11-23") // Sunday ends the week
    assert.equal(weekStartKey("2026-11-29", 0, 0), "2026-11-29")
    assert.equal(weekStartKey("2026-11-24", 1), "2026-11-30")
    assert.equal(weekStartKey("2026-11-24", -1), "2026-11-16")
    assert.equal(weekStartKey("2026-12-31", 1), "2027-01-04")
})

test("the week grid has seven days with today marked and episodes per day", () => {
    const week = buildScheduleWeek([
        item(1, 5, "2026-11-23T20:00:00Z"), // Monday, aired
        item(2, 3, "2026-11-25T02:30:00Z"), // Tuesday 22:30 in La Paz
        item(3, 9, "2026-11-29T15:00:00Z"), // Sunday
        item(4, 1, "2026-11-30T15:00:00Z"), // next Monday
    ], { now: NOW, timeZone: LA_PAZ, progressOf: id => (id === 1 ? 5 : undefined) })
    assert.equal(week.label, "Nov 23 – 29, 2026")
    assert.equal(week.isCurrent, true)
    assert.deepEqual(week.days.map(day => day.weekday), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    assert.deepEqual(week.days.map(day => day.isToday), [false, true, false, false, false, false, false])
    assert.deepEqual(week.days.map(day => day.isPast), [true, false, false, false, false, false, false])
    assert.deepEqual(week.days.map(day => day.items.map(entry => entry.item.mediaId)), [[1], [2], [], [], [], [], [3]])
    assert.equal(week.days[0].items[0].watched, true)
    assert.equal(week.days[0].dateLabel, "Nov 23")
})

test("the next and previous weeks, across months and years", () => {
    const next = buildScheduleWeek([item(4, 1, "2026-11-30T15:00:00Z")], { now: NOW, timeZone: LA_PAZ, weekOffset: 1 })
    assert.equal(next.label, "Nov 30 – Dec 6, 2026")
    assert.equal(next.isCurrent, false)
    assert.deepEqual(next.days[0].items.map(entry => entry.item.mediaId), [4])
    assert.ok(next.days.every(day => !day.isToday && !day.isPast))

    const newYear = buildScheduleWeek([], { now: Date.parse("2026-12-30T12:00:00Z"), timeZone: "UTC" })
    assert.equal(newYear.label, "Dec 28, 2026 – Jan 3, 2027")

    const previous = buildScheduleWeek([], { now: NOW, timeZone: LA_PAZ, weekOffset: -1 })
    assert.ok(previous.days.every(day => day.isPast))
})

test("focus in the week grid starts on the next episode to air", () => {
    const week = buildScheduleWeek([
        item(1, 5, "2026-11-23T20:00:00Z"),
        item(3, 9, "2026-11-29T15:00:00Z"),
    ], { now: NOW, timeZone: LA_PAZ })
    assert.deepEqual(initialScheduleFocus(week.days), { day: 6, index: 0 })
})

test("thumbnails use AniList's medium cover", () => {
    assert.equal(
        smallCoverUrl("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-abc.png"),
        "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1-abc.png",
    )
    assert.equal(smallCoverUrl("https://example.com/x.png"), "https://example.com/x.png")
    assert.equal(smallCoverUrl(""), undefined)
})
