import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import http from "node:http"
import https from "node:https"
import type { AddressInfo } from "node:net"
import test from "node:test"
import { resolve as resolveUrl } from "node:url"
import { describeRanges, directPlayDiagnostics, summarizeDiagnostics } from "../src/lib/player/direct-play-diagnostics.ts"
import { readMkvIndex } from "../src/lib/player/mkv/mkv-demux.ts"
import { chunkedReader, createFetchRangeReader, isFatalRangeError, RangeFetchError, totalFromContentRange } from "../src/lib/player/mkv/range-reader.ts"
import { createSubtitleExtractor } from "../src/lib/player/mkv/subtitle-extractor.ts"
import { createRangeHandler } from "../webos/service/range.ts"

const SAMPLE = new Uint8Array(readFileSync(new URL("./fixtures/mkv/mkvmerge-sample.mkv", import.meta.url)))

/** A file server like a CDN: Range support (or not), a redirect, and an expired link. */
async function withServer(run: (base: string, hits: string[]) => Promise<void>, { ranges = true } = {}) {
    const hits: string[] = []
    const server = http.createServer((request, response) => {
        hits.push(`${request.method} ${request.url} ${request.headers.range ?? ""}`)
        if (request.url === "/expired.mkv") {
            response.writeHead(403)
            response.end()
            return
        }
        if (request.url === "/redirect.mkv") {
            response.writeHead(302, { location: "/file.mkv" })
            response.end()
            return
        }
        const match = /bytes=(\d+)-(\d+)?/.exec(request.headers.range ?? "")
        if (!ranges || !match) {
            response.writeHead(200, { "content-length": SAMPLE.length })
            response.end(Buffer.from(SAMPLE))
            return
        }
        const start = Number(match[1])
        const end = Math.min(SAMPLE.length - 1, match[2] ? Number(match[2]) : SAMPLE.length - 1)
        response.writeHead(206, { "content-range": `bytes ${start}-${end}/${SAMPLE.length}`, "content-length": end - start + 1 })
        response.end(Buffer.from(SAMPLE.subarray(start, end + 1)))
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    try {
        await run(`http://127.0.0.1:${port}`, hits)
    } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
    }
}

test("the fetch reader reads ranges and learns the size", () => withServer(async (base) => {
    const reader = createFetchRangeReader(`${base}/file.mkv`)
    const bytes = await reader.read(0, 4)
    assert.deepEqual(Array.from(bytes), [0x1a, 0x45, 0xdf, 0xa3])
    assert.equal(reader.size(), SAMPLE.length)
    const index = await readMkvIndex(reader)
    assert.equal(index.tracks.length, 5)
}))

test("a CDN that ignores Range is a fatal error, not a whole-file download", () => withServer(async (base) => {
    const reader = createFetchRangeReader(`${base}/file.mkv`)
    await assert.rejects(reader.read(0, 4), (error: unknown) => error instanceof RangeFetchError && error.kind === "no-range" && isFatalRangeError(error))
}, { ranges: false }))

test("an expired link is fatal; a network failure is not", () => withServer(async (base) => {
    await assert.rejects(createFetchRangeReader(`${base}/expired.mkv`).read(0, 4), (error: unknown) => error instanceof RangeFetchError && error.status === 403 && isFatalRangeError(error))
    const nowhere = createFetchRangeReader("http://127.0.0.1:9/file.mkv", { timeoutMs: 2000 })
    await assert.rejects(nowhere.read(0, 4), (error: unknown) => error instanceof RangeFetchError && error.kind === "network" && !isFatalRangeError(error))
}))

test("a fetch TypeError on a host that answers no-cors requests is reported as CORS", async () => {
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
        if (init?.mode === "no-cors") return new Response(null, { status: 200 })
        throw new TypeError("Failed to fetch")
    }) as typeof fetch
    const reader = createFetchRangeReader("https://cdn.example/file.mkv", { fetchImpl: fakeFetch })
    await assert.rejects(reader.read(0, 4), (error: unknown) => error instanceof RangeFetchError && error.kind === "cors" && isFatalRangeError(error))
})

function callService(handler: ReturnType<typeof createRangeHandler>, payload: Record<string, unknown>) {
    return new Promise<Record<string, unknown>>(resolve => handler({ payload, respond: resolve }))
}

const serviceModules = { http, https, Buffer, resolveUrl } as unknown as Parameters<typeof createRangeHandler>[0]

test("the service's range method follows redirects and returns base64", () => withServer(async (base, hits) => {
    const handler = createRangeHandler(serviceModules)
    const answer = await callService(handler, { url: `${base}/redirect.mkv`, start: 0, length: 16 })
    assert.equal(answer.returnValue, true)
    assert.equal(answer.status, 206)
    assert.equal(totalFromContentRange(answer.contentRange as string), SAMPLE.length)
    assert.deepEqual(Array.from(Buffer.from(answer.data as string, "base64")), Array.from(SAMPLE.subarray(0, 16)))
    assert.ok(hits.some(hit => hit.startsWith("GET /file.mkv bytes=0-15")))
}))

test("the service refuses bad arguments and reports a server without Range", () => withServer(async (base) => {
    const handler = createRangeHandler(serviceModules)
    assert.equal((await callService(handler, { url: "file:///etc/passwd", start: 0, length: 4 })).errorCode, "range:url")
    assert.equal((await callService(handler, { url: `${base}/file.mkv`, start: 0, length: 5 * 1024 * 1024 })).errorCode, "range:args")
    assert.equal((await callService(handler, { url: `${base}/file.mkv`, start: 0, length: 4 })).errorCode, "range:no-range")
    assert.equal((await callService(handler, { url: `${base}/expired.mkv`, start: 0, length: 4 })).errorCode, "range:http")
}, { ranges: false }))

test("subtitles read end to end over HTTP, through the chunked reader", () => withServer(async (base) => {
    const reader = chunkedReader(createFetchRangeReader(`${base}/file.mkv`), 1024)
    const index = await readMkvIndex(reader)
    let count = 0
    const extractor = createSubtitleExtractor({ reader, index, onLines: lines => count += lines.length })
    extractor.seek(0)
    await extractor.idle()
    assert.equal(count, 50)
}))

test("the diagnostics summary names every finding without the URL", () => {
    directPlayDiagnostics.reset("source-1")
    directPlayDiagnostics.update({
        readerPath: "relay",
        cors: ["fetch with Range is blocked by CORS"],
        audioApi: { available: true, count: 2, enabled: 1, changes: 1, lastChange: "#1 eng" },
        lastSeek: { from: 10, to: 900, seekedMs: 850, playingMs: 1400 },
        failure: "Direct play failed: reading subtitles: CORS on subtitle fetch",
    })
    const text = summarizeDiagnostics(directPlayDiagnostics.get()).join("\n")
    assert.match(text, /via relay/)
    assert.match(text, /FAILURE: Direct play failed/)
    assert.match(text, /audioTracks API: yes, 2 tracks, enabled #1, 1 switches/)
    assert.match(text, /last seek: 10 → 900 s, seeked after 850 ms, playing after 1400 ms/)
    assert.doesNotMatch(text, /https?:/)
    assert.equal(describeRanges({ length: 2, start: i => [0, 100][i], end: i => [35.25, 130][i] }), "0.0–35.3, 100.0–130.0")
})
