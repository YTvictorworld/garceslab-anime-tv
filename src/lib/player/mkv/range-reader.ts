/**
 * HTTP Range reads for the direct-play spike's MKV parser, with errors that
 * say what went wrong (CORS, a server without Range support, an expired
 * link) so the TV can show it rather than fall back quietly.
 * Kept free of React Native (and of `@/` imports) so the tests load it.
 */
import type { RangeReader } from "./mkv-demux.ts"

export type RangeFetchErrorKind = "cors" | "network" | "http" | "no-range" | "timeout" | "relay" | "rate-limit"

export class RangeFetchError extends Error {
    readonly kind: RangeFetchErrorKind
    readonly status?: number
    /** From a Retry-After header, when the response let us read it. */
    readonly retryAfterMs?: number

    constructor(kind: RangeFetchErrorKind, message: string, status?: number, retryAfterMs?: number) {
        super(message)
        this.name = "RangeFetchError"
        this.kind = kind
        this.status = status
        this.retryAfterMs = retryAfterMs
    }
}

/** The CDN asks us to slow down (429 Too Many Requests, 503 Service Unavailable). */
export function isRateLimited(error: unknown) {
    return error instanceof RangeFetchError && (error.kind === "rate-limit" || error.status === 429 || error.status === 503)
}

/** Retry-After as milliseconds: delay-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
    if (!value) return undefined
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
    const date = Date.parse(trimmed)
    return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

/** Errors that another try won't fix: stop and say so. */
export function isFatalRangeError(error: unknown) {
    if (!(error instanceof RangeFetchError)) return false
    if (error.kind === "cors" || error.kind === "no-range") return true
    return error.kind === "http" && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429
}

/** "bytes 0-99/1234" → 1234 */
export function totalFromContentRange(value: string | null | undefined): number | null {
    const match = value ? /\/(\d+)\s*$/.exec(value) : null
    return match ? Number(match[1]) : null
}

export type ReaderEvent = { start: number; length: number; ms: number; bytes: number; error?: string }

type FetchLike = typeof fetch

export type FetchRangeReaderOptions = {
    timeoutMs?: number
    fetchImpl?: FetchLike
    onRead?: (event: ReaderEvent) => void
    now?: () => number
}

/**
 * Reads with `fetch` and a Range header. A failed fetch is told apart as
 * CORS (the host answers a no-cors request) or network (it doesn't).
 */
export function createFetchRangeReader(url: string, options: FetchRangeReaderOptions = {}): RangeReader & { corsChecked: () => boolean } {
    const fetchImpl = options.fetchImpl ?? fetch
    const timeoutMs = options.timeoutMs ?? 15_000
    const now = options.now ?? (() => Date.now())
    let size: number | null = null
    let ok = false

    const classify = async (error: unknown): Promise<RangeFetchError> => {
        if (error instanceof RangeFetchError) return error
        // CORS hides the answer of a host that is up; a no-cors request only fails when it is not.
        const controller = typeof AbortController === "function" ? new AbortController() : null
        try {
            await fetchImpl(url, { mode: "no-cors", cache: "no-store", credentials: "omit", signal: controller?.signal })
            return new RangeFetchError("cors", "The CDN answers, but not with CORS for this app: the page can't read the bytes")
        } catch {
            return new RangeFetchError("network", `Network error: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
            // Only whether it answered was wanted, not the file.
            controller?.abort()
        }
    }

    const read = async (start: number, length: number): Promise<Uint8Array> => {
        const began = now()
        const controller = typeof AbortController === "function" ? new AbortController() : null
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            controller?.abort()
        }, timeoutMs)
        try {
            let response: Response
            try {
                response = await fetchImpl(url, {
                    headers: { Range: `bytes=${start}-${start + length - 1}` },
                    cache: "no-store",
                    credentials: "omit",
                    signal: controller?.signal,
                })
            } catch (error) {
                if (timedOut) throw new RangeFetchError("timeout", `No answer within ${timeoutMs / 1000} s`)
                throw await classify(error)
            }
            if (response.status === 200) {
                controller?.abort()
                throw new RangeFetchError("no-range", "The CDN ignored the Range header and sent the whole file", 200)
            }
            if (response.status !== 206) {
                controller?.abort()
                // Retry-After is only readable when the CDN exposes it to CORS requests.
                const retryAfter = parseRetryAfter(response.headers.get("retry-after"), now())
                throw new RangeFetchError("http", `HTTP ${response.status}`, response.status, retryAfter)
            }
            // Content-Range is only readable when the CDN exposes it to CORS requests.
            size ??= totalFromContentRange(response.headers.get("content-range"))
            const bytes = new Uint8Array(await response.arrayBuffer())
            ok = true
            options.onRead?.({ start, length, ms: now() - began, bytes: bytes.length })
            return bytes
        } catch (error) {
            const failure = error instanceof RangeFetchError ? error : timedOut
                ? new RangeFetchError("timeout", `No answer within ${timeoutMs / 1000} s`)
                : new RangeFetchError("network", error instanceof Error ? error.message : String(error))
            options.onRead?.({ start, length, ms: now() - began, bytes: 0, error: `${failure.kind}: ${failure.message}` })
            throw failure
        } finally {
            clearTimeout(timer)
        }
    }

    return { read, size: () => size, corsChecked: () => ok }
}

/** Splits reads into pieces no bigger than `max` (the relay's limit). */
export function chunkedReader(reader: RangeReader, max: number): RangeReader {
    return {
        size: reader.size,
        read: async (start, length) => {
            if (length <= max) return reader.read(start, length)
            const parts: Uint8Array[] = []
            let total = 0
            for (let at = start; at < start + length; at += max) {
                const part = await reader.read(at, Math.min(max, start + length - at))
                parts.push(part)
                total += part.length
                if (part.length < Math.min(max, start + length - at)) break
            }
            const out = new Uint8Array(total)
            let offset = 0
            for (const part of parts) {
                out.set(part, offset)
                offset += part.length
            }
            return out
        },
    }
}

export function base64ToBytes(data: string): Uint8Array {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

export type PacedReaderStats = {
    /** Requests sent to the CDN (retries included). */
    requests: number
    /** 429 and 503 answers. */
    rateLimited: number
    retries: number
    bytes: number
    /** Size of the read in flight, or null. */
    currentRead: number | null
    /** While backing off: until when (epoch ms) and why. */
    backoffUntil: number | null
    backoffReason: string | null
    /** Reads waiting their turn. */
    queued: number
    lastError: string | null
}

export type PacedReaderOptions = {
    /** Least time between two requests. */
    minGapMs?: number
    /** Tries per read before giving up (429/503 and network errors). */
    maxAttempts?: number
    baseBackoffMs?: number
    maxBackoffMs?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    onStats?: (stats: PacedReaderStats) => void
}

/**
 * One read at a time, at least `minGapMs` apart: the debrid CDN throttles
 * a client that sends many requests while its <video> streams from it too.
 * A 429 or 503 waits for Retry-After (or 2 s, 4 s, … up to 60 s) and tries
 * again quietly; a network error too. Errors another try won't fix (CORS,
 * no Range support, an expired link) are thrown at once.
 */
export function createPacedReader(reader: RangeReader, options: PacedReaderOptions = {}): RangeReader & { stats: () => PacedReaderStats } {
    const minGapMs = options.minGapMs ?? 1000
    const maxAttempts = options.maxAttempts ?? 6
    const baseBackoffMs = options.baseBackoffMs ?? 2000
    const maxBackoffMs = options.maxBackoffMs ?? 60_000
    const now = options.now ?? (() => Date.now())
    const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
    const stats: PacedReaderStats = {
        requests: 0, rateLimited: 0, retries: 0, bytes: 0, currentRead: null, backoffUntil: null, backoffReason: null, queued: 0, lastError: null,
    }
    const report = () => options.onStats?.({ ...stats })
    let lastRequestAt = -Infinity
    let chain: Promise<unknown> = Promise.resolve()

    const run = async (start: number, length: number): Promise<Uint8Array> => {
        for (let attempt = 1; ; attempt++) {
            const wait = lastRequestAt + minGapMs - now()
            if (wait > 0) await sleep(wait)
            lastRequestAt = now()
            stats.requests++
            stats.currentRead = length
            report()
            try {
                const bytes = await reader.read(start, length)
                stats.bytes += bytes.length
                stats.currentRead = null
                stats.backoffUntil = null
                stats.backoffReason = null
                report()
                return bytes
            } catch (error) {
                stats.currentRead = null
                const limited = isRateLimited(error)
                const retryable = limited || (error instanceof RangeFetchError && (error.kind === "network" || error.kind === "timeout"))
                    || (error instanceof RangeFetchError && error.kind === "http" && (error.status ?? 0) >= 500)
                stats.lastError = error instanceof Error ? error.message : String(error)
                if (limited) stats.rateLimited++
                if (!retryable || attempt >= maxAttempts) {
                    stats.backoffUntil = null
                    stats.backoffReason = null
                    report()
                    if (limited) {
                        throw new RangeFetchError("rate-limit", `The CDN kept answering ${(error as RangeFetchError).status ?? 429} after ${attempt} tries`, (error as RangeFetchError).status)
                    }
                    throw error
                }
                const hinted = error instanceof RangeFetchError ? error.retryAfterMs : undefined
                const delay = Math.min(maxBackoffMs, hinted ?? baseBackoffMs * 2 ** (attempt - 1))
                stats.retries++
                stats.backoffUntil = now() + delay
                stats.backoffReason = limited ? `HTTP ${(error as RangeFetchError).status ?? 429}${hinted !== undefined ? " (Retry-After)" : ""}` : stats.lastError
                report()
                await sleep(delay)
                // The wait was the gap.
                lastRequestAt = -Infinity
            }
        }
    }

    return {
        size: reader.size,
        stats: () => ({ ...stats }),
        read: (start, length) => {
            stats.queued++
            const result = chain.then(() => {
                stats.queued--
                return run(start, length)
            })
            // The next read waits for this one, whether it worked or not.
            chain = result.catch(() => undefined)
            return result
        },
    }
}
