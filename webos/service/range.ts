/**
 * Byte ranges of a remote file for the direct-play spike (`range` method of the app's
 * JS service, see service.ts).
 *
 * The app reads the subtitle blocks of a debrid MKV with Range requests. If the CDN
 * doesn't answer CORS for the app's `file://` origin, the page can't read those
 * responses, but Node can: this method fetches one range and hands the bytes back over
 * the Luna bus as base64. Only for subtitle and header bytes (small reads); the video
 * itself always goes from the CDN to the TV's player directly.
 *
 *   range {url, start, length} → {returnValue: true, status, contentRange, data}
 *                                or {returnValue: false, errorCode: "range:…", errorText}
 *
 * The URL is never logged: debrid links carry the account's access token.
 */

/** The parts of Node's http/https modules this uses. */
export type HttpModule = {
    get: (url: string, options: Record<string, unknown>, callback: (response: HttpResponse) => void) => HttpRequest
}
export type HttpResponse = {
    statusCode?: number
    headers: Record<string, string | string[] | undefined>
    on: (event: string, listener: (chunk?: unknown) => void) => unknown
    resume: () => void
    destroy: () => void
}
export type HttpRequest = {
    on: (event: string, listener: (error: unknown) => void) => unknown
    setTimeout: (ms: number, listener: () => void) => unknown
    abort?: () => void
    destroy?: () => void
}

export type RangeMessage = {
    payload: Record<string, unknown>
    respond: (response: Record<string, unknown>) => unknown
}

/** Luna messages are kept small; the app splits bigger reads. */
export const MAX_RANGE_BYTES = 1024 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 20_000

type BufferLike = { length: number; toString: (encoding: "base64") => string }
// Node's Buffer; typed loosely so the tests can pass their own.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BufferStatic = { concat: (chunks: any[]) => BufferLike }

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

export function createRangeHandler(modules: {
    http: HttpModule
    https: HttpModule
    Buffer: BufferStatic
    /** Node 8 has no global URL: `require("url").resolve`. */
    resolveUrl: (from: string, to: string) => string
}, log: (line: string) => void = () => {}) {
    const fetchRange = (url: string, start: number, length: number, redirects: number, message: RangeMessage) => {
        const client = /^https:/i.test(url) ? modules.https : modules.http
        let settled = false
        const answer = (response: Record<string, unknown>) => {
            if (settled) return
            settled = true
            message.respond(response)
        }
        const fail = (code: string, text: string) => answer({ returnValue: false, errorCode: `range:${code}`, errorText: text })

        let request: HttpRequest
        try {
            request = client.get(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } }, (response) => {
                const status = response.statusCode ?? 0
                const location = response.headers.location
                if (status >= 300 && status < 400 && typeof location === "string") {
                    response.resume()
                    if (redirects >= MAX_REDIRECTS) return fail("redirects", "Too many redirects")
                    settled = true
                    fetchRange(modules.resolveUrl(url, location), start, length, redirects + 1, message)
                    return
                }
                if (status !== 206) {
                    // A 200 is the whole file: stop at once rather than download it.
                    response.destroy()
                    return fail(status === 200 ? "no-range" : "http", `HTTP ${status}`)
                }
                const chunks: BufferLike[] = []
                let size = 0
                response.on("data", (chunk) => {
                    const buffer = chunk as BufferLike
                    size += buffer.length
                    if (size > length + 1024) {
                        response.destroy()
                        fail("too-long", "The server sent more than the range asked for")
                        return
                    }
                    chunks.push(buffer)
                })
                response.on("end", () => {
                    const contentRange = response.headers["content-range"]
                    answer({
                        returnValue: true,
                        status,
                        contentRange: typeof contentRange === "string" ? contentRange : null,
                        data: modules.Buffer.concat(chunks).toString("base64"),
                    })
                })
                response.on("error", error => fail("network", errorText(error)))
            })
        } catch (error) {
            return fail("url", errorText(error))
        }
        request.on("error", (error) => {
            log(`range: request failed: ${errorText(error)}`)
            fail("network", errorText(error))
        })
        request.setTimeout(TIMEOUT_MS, () => {
            fail("timeout", "No answer in time")
            if (request.destroy) request.destroy()
            else request.abort?.()
        })
    }

    return function range(message: RangeMessage) {
        const { url, start, length } = message.payload
        if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
            return message.respond({ returnValue: false, errorCode: "range:url", errorText: "url must be an http(s) URL" })
        }
        if (typeof start !== "number" || typeof length !== "number" || start < 0 || length <= 0 || length > MAX_RANGE_BYTES) {
            return message.respond({ returnValue: false, errorCode: "range:args", errorText: `start and length (1..${MAX_RANGE_BYTES}) are required` })
        }
        fetchRange(url, Math.floor(start), Math.floor(length), 0, message)
    }
}
