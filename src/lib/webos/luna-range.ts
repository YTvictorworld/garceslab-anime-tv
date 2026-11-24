/**
 * Range reads through the app's JS service (`range`, webos/service/range.ts), for the
 * direct-play spike when the CDN's CORS keeps the page from reading subtitle bytes itself.
 */
import { base64ToBytes, parseRetryAfter, RangeFetchError, totalFromContentRange, type ReaderEvent } from "@/lib/player/mkv/range-reader"
import type { RangeReader } from "@/lib/player/mkv/mkv-demux"
import { hasLunaBridge, lunaRequest } from "./luna"
import { RELAY_SERVICE_ID } from "./luna-websocket"

export function canUseRelayRanges() {
    return hasLunaBridge()
}

/** One call per read, at most 1 MiB (the service's limit): the caller splits and paces bigger reads. */
export function createRelayRangeReader(url: string, onRead?: (event: ReaderEvent) => void): RangeReader {
    let size: number | null = null
    const single: RangeReader = {
        size: () => size,
        read: async (start, length) => {
            const began = Date.now()
            const response = await lunaRequest(`luna://${RELAY_SERVICE_ID}/range`, { url, start, length }, { timeoutMs: 25_000 })
            if (!response) {
                onRead?.({ start, length, ms: Date.now() - began, bytes: 0, error: "relay: no answer" })
                throw new RangeFetchError("relay", "The app's service did not answer the range request")
            }
            if (response.returnValue === false || typeof response.data !== "string") {
                const code = String(response.errorCode ?? "error")
                const text = String(response.errorText ?? "failed")
                onRead?.({ start, length, ms: Date.now() - began, bytes: 0, error: `relay: ${code} ${text}` })
                if (code === "range:no-range") throw new RangeFetchError("no-range", `The CDN ignored the Range header (via the service)`, 200)
                const status = typeof response.status === "number" ? response.status : Number(/HTTP (\d+)/.exec(text)?.[1]) || undefined
                const retryAfter = parseRetryAfter(typeof response.retryAfter === "string" ? response.retryAfter : null)
                if (code === "range:network" || code === "range:timeout") throw new RangeFetchError(code === "range:timeout" ? "timeout" : "network", `Service: ${code} ${text}`)
                throw new RangeFetchError(status ? "http" : "relay", `Service: ${code} ${text}`, status, retryAfter)
            }
            size ??= totalFromContentRange(typeof response.contentRange === "string" ? response.contentRange : null)
            const bytes = base64ToBytes(response.data)
            onRead?.({ start, length, ms: Date.now() - began, bytes: bytes.length })
            return bytes
        },
    }
    return single
}
