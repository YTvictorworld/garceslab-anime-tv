import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"
import zlib from "node:zlib"
import { inflateRaw, inflateZlib } from "../src/lib/player/mkv/inflate.ts"
import { parseBlock, readMkvIndex, type RangeReader, toMkvMetadata, utf8ToAssText } from "../src/lib/player/mkv/mkv-demux.ts"
import { chunkedReader, createFetchRangeReader, createPacedReader } from "../src/lib/player/mkv/range-reader.ts"
import { chooseStrategy, coalesceRanges, createSubtitleExtractor } from "../src/lib/player/mkv/subtitle-extractor.ts"
import { describeStreamCodecs } from "../src/lib/player/direct-stream-format.ts"
import type { MpvStreamedSubtitleLine } from "../modules/expo-mpv-player/src/MpvPlayer.types.ts"

/*
 * Samples made by tests/fixtures/mkv/make-fixtures.sh: 60 s of testsrc (H.264), two
 * AAC tracks (jpn, eng), a Spanish ASS track (30 lines, 2 s apart from 0.5 s)
 * and an English SRT track (20 lines, 3 s apart from 1 s); the mkvmerge
 * remuxes add a font attachment, zlib-compressed subtitles, or drop cues.
 */
const FIXTURES = new URL("./fixtures/mkv/", import.meta.url)

function fileReader(name: string) {
    const bytes = new Uint8Array(readFileSync(new URL(name, FIXTURES)))
    const calls: Array<[number, number]> = []
    const reader: RangeReader & { calls: typeof calls; bytes: Uint8Array } = {
        calls,
        bytes,
        read: async (start, length) => {
            calls.push([start, length])
            return bytes.subarray(start, Math.min(bytes.length, start + length))
        },
        size: () => bytes.length,
    }
    return reader
}

async function extractAll(name: string, strategy: "auto" | "cues" | "scan" = "auto", seekTo = 0, extra: Partial<Parameters<typeof createSubtitleExtractor>[0]> = {}) {
    const reader = fileReader(name)
    const index = await readMkvIndex(reader)
    const lines: MpvStreamedSubtitleLine[] = []
    const extractor = createSubtitleExtractor({ reader, index, strategy, lookaheadSec: 1000, backgroundGapMs: 0, onLines: received => lines.push(...received), ...extra })
    extractor.seek(seekTo)
    await extractor.idle()
    // The scan reads up to the lookahead from the seek point; keep going to the end.
    for (let i = 0; i < 50 && !extractor.stats().finished && extractor.stats().strategy === "scan"; i++) {
        extractor.update(seekTo)
        await extractor.idle()
    }
    lines.sort((a, b) => a.trackNumber - b.trackNumber || a.start - b.start)
    return { index, lines, stats: extractor.stats(), reader }
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.011

function checkLines(lines: MpvStreamedSubtitleLine[], assTrack: number, srtTrack: number) {
    const ass = lines.filter(line => line.trackNumber === assTrack)
    const srt = lines.filter(line => line.trackNumber === srtTrack)
    assert.equal(ass.length, 30)
    assert.equal(srt.length, 20)
    assert.ok(near(ass[0].start, 0.5) && near(ass[0].end, 2), `ASS 1 at ${ass[0].start}-${ass[0].end}`)
    assert.ok(near(ass[29].start, 58.5))
    assert.equal(ass[0].text, "Línea 1, con coma{\\i1} y acentos ñ{\\i0}")
    assert.equal(ass[0].style, "Default")
    assert.equal(ass[4].style, "Top")
    assert.equal(ass[0].ass?.name, "Hablante")
    assert.ok(near(srt[0].start, 1) && near(srt[0].end, 3))
    assert.equal(srt[0].text, "Line 1\\N{\\i1}second row{\\i0}")
    assert.ok(near(srt[19].start, 58))
}

test("inflate matches node's zlib", () => {
    for (const level of [0, 1, 9]) {
        const input = Buffer.from("Dialogue: 0,Default,,0,0,0,,Hola ñ ".repeat(200))
        assert.deepEqual(Buffer.from(inflateZlib(zlib.deflateSync(input, { level }))), input)
        assert.deepEqual(Buffer.from(inflateRaw(zlib.deflateRawSync(input, { level }))), input)
    }
})

test("the header gives tracks, languages, codecs, cues and attachments", async () => {
    const { index } = await extractAll("mkvmerge-sample.mkv")
    assert.equal(index.docType, "matroska")
    assert.ok(Math.abs(index.durationSec - 60) < 0.2)
    assert.deepEqual(index.tracks.map(track => [track.number, track.kind, track.codecId]), [
        [1, "video", "V_MPEG4/ISO/AVC"],
        [2, "audio", "A_AAC"],
        [3, "audio", "A_AAC"],
        [4, "subtitle", "S_TEXT/ASS"],
        [5, "subtitle", "S_TEXT/UTF8"],
    ])
    assert.equal(index.tracks[1].language, "jpn")
    assert.equal(index.tracks[3].name, "Español (ASS)")
    assert.deepEqual(index.attachments.map(file => [file.name, file.mediaType, file.size]), [["Test.ttf", "font/ttf", 3000]])
    const metadata = toMkvMetadata(index)
    assert.match(metadata.subtitleTracks![0].codecPrivate!, /\[V4\+ Styles\]/)
    const codecs = describeStreamCodecs(metadata)
    assert.equal(codecs.video, "H.264")
    assert.equal(codecs.resolution, "160×90")
    assert.equal(codecs.audioTracks.length, 2)
    assert.equal(metadata.attachments![0].type, "font")
})

test("the header reads without touching the clusters", async () => {
    const reader = fileReader("ffmpeg-sample.mkv")
    const index = await readMkvIndex(reader)
    const firstCluster = index.firstClusterPosition!
    assert.ok(firstCluster > 0)
    // ffmpeg writes Cues at the end; the only read past the head is for them.
    const pastHead = reader.calls.filter(([start]) => start > 128 * 1024)
    assert.ok(pastHead.length <= 2, JSON.stringify(reader.calls))
    assert.ok(index.cues.length > 0)
})

for (const name of ["ffmpeg-sample.mkv", "mkvmerge-sample.mkv", "mkvmerge-zlib.mkv"]) {
    test(`${name}: every line is read from the Cues alone`, async () => {
        const { lines, stats, index, reader } = await extractAll(name)
        assert.equal(stats.strategy, "cues")
        checkLines(lines, 4, 5)
        assert.equal(stats.errors.length, 0, stats.errors.join("; "))
        // The CDN rate-limits many small reads: the blocks of this small file merge into one or two.
        assert.ok(stats.requests <= 2, `${stats.requests} requests for ${stats.total} blocks`)
        if (name === "mkvmerge-zlib.mkv") assert.equal(index.tracks[3].compression?.algo, 0)
    })
}

for (const name of ["mkvmerge-nosubcues.mkv", "mkvmerge-nocues.mkv"]) {
    test(`${name}: falls back to scanning clusters`, async () => {
        const reader = fileReader(name)
        const index = await readMkvIndex(reader)
        const tracks = index.tracks.filter(track => track.kind === "subtitle")
        assert.equal(chooseStrategy(index, tracks).strategy, "scan")
        const { lines, stats } = await extractAll(name)
        assert.equal(stats.strategy, "scan")
        checkLines(lines, 4, 5)
    })
}

test("scanning gives the same lines as the Cues", async () => {
    const cues = await extractAll("mkvmerge-sample.mkv", "cues")
    const scan = await extractAll("mkvmerge-sample.mkv", "scan")
    assert.deepEqual(scan.lines, cues.lines)
})

test("a seek far ahead reads lines there first", async () => {
    const reader = fileReader("mkvmerge-sample.mkv")
    const index = await readMkvIndex(reader)
    const batches: MpvStreamedSubtitleLine[][] = []
    // Small reads, so the order shows.
    const extractor = createSubtitleExtractor({ reader, index, mergeGapBytes: 0, maxReadBytes: 64 * 1024, backgroundGapMs: 0, onLines: lines => batches.push(lines) })
    extractor.seek(45)
    await extractor.idle()
    assert.ok(batches[0].every(line => line.start >= 35), JSON.stringify(batches[0].map(line => line.start)))
    assert.equal(batches.flat().length, 50)
})

test("a scan seek without Cues finds a cluster near the time", async () => {
    const reader = fileReader("mkvmerge-nocues.mkv")
    const index = await readMkvIndex(reader)
    const lines: MpvStreamedSubtitleLine[] = []
    const extractor = createSubtitleExtractor({ reader, index, lookaheadSec: 10, onLines: received => lines.push(...received) })
    extractor.seek(40)
    await extractor.idle()
    assert.ok(lines.length > 0)
    assert.ok(lines.every(line => line.start >= 15), JSON.stringify(lines.map(line => line.start)))
    assert.ok(lines.some(line => line.start >= 40 && line.start <= 50))
})

test("a fatal read error stops reading and is reported", async () => {
    const reader = fileReader("mkvmerge-sample.mkv")
    const index = await readMkvIndex(reader)
    const failing: RangeReader = { read: async () => { throw new Error("CORS") }, size: () => null }
    let fatal: unknown = null
    const extractor = createSubtitleExtractor({ reader: failing, index, isFatal: () => true, onFatal: error => fatal = error, onLines: () => {} })
    extractor.seek(0)
    await extractor.idle()
    assert.equal((fatal as Error).message, "CORS")
    assert.equal(extractor.stats().stopped, true)
})

test("laced blocks split into frames", () => {
    // Track 1, time 0, Xiph lacing, 3 frames of 2, 3 and 1 bytes.
    const block = new Uint8Array([0x81, 0, 0, 0x02, 2, 2, 3, 1, 1, 2, 2, 2, 3])
    assert.deepEqual(parseBlock(block).frames.map(frame => Array.from(frame)), [[1, 1], [2, 2, 2], [3]])
})

test("SRT markup becomes ASS overrides", () => {
    assert.equal(utf8ToAssText("<b>Hi</b> &amp; <font color=\"#fff\">bye</font>\r\nnext"), "{\\b1}Hi{\\b0} & bye\\Nnext")
})

for (const name of ["ffmpeg-sample.mkv", "mkvmerge-sample.mkv", "mkvmerge-zlib.mkv"]) {
    test(`${name}: one read per block (nothing merged) still finds every block`, async () => {
        // Each read starts after its cluster's header, whose length is then found from the block.
        const { lines, stats } = await extractAll(name, "cues", 0, { mergeGapBytes: 0, maxReadBytes: 16 * 1024 })
        checkLines(lines, 4, 5)
        assert.equal(stats.errors.length, 0, stats.errors.join("; "))
        assert.ok(stats.requests >= 20, `${stats.requests} requests`)
    })
}

test("nearby ranges merge up to the size cap, far ones don't", () => {
    const ranges = [
        { minStart: 0, maxEnd: 100 },
        { minStart: 500, maxEnd: 600 },
        { minStart: 5000, maxEnd: 5100 },
        { minStart: 5200, maxEnd: 9000 },
        { minStart: 9100, maxEnd: 9200 },
    ]
    assert.deepEqual(coalesceRanges(ranges, 1000, 10_000).map(read => [read.start, read.end, read.items.length]), [[0, 600, 2], [5000, 9200, 3]])
    assert.deepEqual(coalesceRanges(ranges, 1000, 4000).map(read => [read.start, read.end]), [[0, 600], [5000, 9000], [9100, 9200]])
    assert.deepEqual(coalesceRanges(ranges, 100_000, 100_000).map(read => read.items.length), [5])
})

test("the scan reads the file in large chunks", async () => {
    const { lines, stats } = await extractAll("mkvmerge-nocues.mkv", "scan", 0, { scanChunkBytes: 128 * 1024 })
    checkLines(lines, 4, 5)
    assert.ok(stats.requests <= 6, `${stats.requests} requests`)
})

test("while the video buffers, only the playhead's lines are read", async () => {
    const reader = fileReader("mkvmerge-sample.mkv")
    const index = await readMkvIndex(reader)
    const lines: MpvStreamedSubtitleLine[] = []
    const extractor = createSubtitleExtractor({
        reader, index, mergeGapBytes: 0, maxReadBytes: 16 * 1024, foregroundSec: 10, backgroundGapMs: 0,
        onLines: received => lines.push(...received),
    })
    extractor.setBackgroundPaused(true)
    extractor.seek(30)
    await extractor.idle()
    assert.ok(lines.length > 0)
    assert.ok(lines.every(line => line.start >= 20 && line.start <= 40), JSON.stringify(lines.map(line => line.start)))
    extractor.setBackgroundPaused(false)
    await extractor.idle()
    assert.equal(lines.length, 50)
})

/** Serves one fixture with Range support, like the debrid CDN. */
async function withRangeServer(name: string, run: (url: string, ranges: string[]) => Promise<void>) {
    const bytes = new Uint8Array(readFileSync(new URL(name, FIXTURES)))
    const ranges: string[] = []
    const server = http.createServer((request, response) => {
        const match = /bytes=(\d+)-(\d+)/.exec(request.headers.range ?? "")
        if (!match) {
            response.writeHead(416)
            response.end()
            return
        }
        ranges.push(request.headers.range!)
        const start = Number(match[1])
        const end = Math.min(bytes.length - 1, Number(match[2]))
        response.writeHead(206, { "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": end - start + 1 })
        response.end(Buffer.from(bytes.subarray(start, end + 1)))
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    try {
        await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/${name}`, ranges)
    } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
    }
}

const MULTISUB_TRACKS = [
    [3, "en", undefined, "English", true],
    [4, "es-419", "spa", "Spanish (Latin America)", false],
    [5, "es-ES", "spa", "Spanish (Spain)", false],
    [6, "pt-BR", "por", "Portuguese (Brazil)", false],
    [7, "fr", "fre", "French", false],
    [8, "de", "ger", "German", false],
    [9, "it", "ita", "Italian", false],
    [10, "ar", "ara", "Arabic", false],
    [11, "ru", "rus", "Russian", false],
]

// An Erai-raws-like MultiSub file: Tracks (~400 KiB of ASS headers) is much longer than the first 128 KiB read.
for (const relay of [false, true]) {
    test(`MultiSub: every subtitle track of a Tracks element past the first read is listed${relay ? " (relay-sized reads)" : ""}`, () => withRangeServer("multisub.mkv", async (url, ranges) => {
        const paced = createPacedReader(createFetchRangeReader(url), { minGapMs: 0 })
        const reader = relay ? chunkedReader(paced, 64 * 1024) : paced
        const index = await readMkvIndex(reader)
        const subtitles = index.tracks.filter(track => track.kind === "subtitle")
        assert.deepEqual(subtitles.map(track => [track.number, track.languageIETF, track.language, track.name, track.default]), MULTISUB_TRACKS)
        assert.ok(subtitles.every(track => track.codecId === "S_TEXT/ASS" && track.codecPrivate!.length > 40 * 1024))
        assert.equal(index.tracks.filter(track => track.kind === "audio").length, 1)
        const metadata = toMkvMetadata(index)
        assert.equal(metadata.subtitleTracks!.length, 9)
        assert.ok(metadata.subtitleTracks!.every(track => /\[Events\]/.test(track.codecPrivate!)), "each script header is complete")
        assert.ok(ranges.length <= (relay ? 16 : 8), ranges.join(" "))

        const lines: MpvStreamedSubtitleLine[] = []
        const extractor = createSubtitleExtractor({ reader, index, backgroundGapMs: 0, onLines: received => lines.push(...received) })
        extractor.seek(0)
        await extractor.idle()
        for (const [number] of MULTISUB_TRACKS) assert.equal(lines.filter(line => line.trackNumber === number).length, 5, `track ${number}`)
    }))
}
