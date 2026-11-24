/**
 * HTTP Range reads for the direct-play spike's MKV parser, with errors that
 * say what went wrong (CORS, a server without Range support, an expired
 * link) so the TV can show it rather than fall back quietly.
 * Kept free of React Native (and of `@/` imports) so the tests load it.
 */
import type { RangeReader } from "./mkv-demux.ts"

export type RangeFetchErrorKind = "cors" | "network" | "http" | "no-range" | "timeout" | "relay"

export class RangeFetchError extends Error {
    readonly kind: RangeFetchErrorKind
    readonly status?: number

    constructor(kind: RangeFetchErrorKind, message: string, status?: number) {
        super(message)
        this.name = "RangeFetchError"
        this.kind = kind
        this.status = status
    }
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
                throw new RangeFetchError("http", `HTTP ${response.status}`, response.status)
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
