/**
 * Reads what the direct-play spike needs from a Matroska file over HTTP
 * Range requests: the header (Info, Tracks, Cues, Chapters, the attachment
 * list) and single subtitle blocks. Never reads video or audio data.
 * Kept free of React Native (and of `@/` imports) so the tests load it.
 */
import type { MKVParser_Metadata, MKVParser_TrackInfo } from "@/api/generated/types"
import type { MpvStreamedSubtitleLine } from "expo-mpv-player"
import {
    type ByteWindow,
    children,
    dataOf,
    EbmlError,
    type ElementHeader,
    hasData,
    ID,
    readElementHeader,
    readFloat,
    readInt16,
    readString,
    readUint,
    readVint,
} from "./ebml.ts"
import { inflateZlib } from "./inflate.ts"

/** Reads `length` bytes from `start` (fewer at the end of the file). */
export type RangeReader = {
    read: (start: number, length: number) => Promise<Uint8Array>
    /** The file's size once a response said it, else null. */
    size: () => number | null
}

export type MkvTrackKind = "video" | "audio" | "subtitle" | "other"

export type MkvTrack = {
    number: number
    kind: MkvTrackKind
    codecId: string
    codecPrivate?: Uint8Array
    name?: string
    language?: string
    languageIETF?: string
    default: boolean
    forced: boolean
    video?: { width: number; height: number }
    audio?: { channels: number; samplingFrequency: number }
    /** ContentCompression of the frames: 0 zlib, 3 header stripping (with the stripped bytes). */
    compression?: { algo: number; settings?: Uint8Array }
    /** The track uses an encoding the parser can't undo (encryption, bzlib, lzo). */
    unsupportedEncoding?: string
}

/** One CueTrackPositions entry, with absolute file offsets. */
export type MkvCue = {
    /** In the segment's timestamp units. */
    time: number
    track: number
    clusterPosition: number
    /** Offset of the block from the cluster's data start, when the muxer wrote it. */
    relativePosition?: number
    duration?: number
}

export type MkvAttachment = { name: string; mediaType: string; dataStart: number; size: number }

export type MkvIndex = {
    docType: string
    segmentDataStart: number
    /** Absolute end of the segment, or null for an unknown size. */
    segmentEnd: number | null
    /** Nanoseconds per timestamp unit. */
    timestampScale: number
    durationSec: number
    muxingApp?: string
    writingApp?: string
    title?: string
    tracks: MkvTrack[]
    cues: MkvCue[]
    /** The file has a Cues element at all. */
    hasCues: boolean
    /** Listed when the Attachments element was in the header reads; see readAttachedFiles. */
    attachments: MkvAttachment[]
    /** Where the Attachments element is, for reading the fonts later. */
    attachmentsElement: { start: number; dataStart: number; size: number } | null
    chapters: Array<{ start: number; title?: string }>
    /** Where the first Cluster starts, when the header walk reached it. */
    firstClusterPosition: number | null
}

export class MkvError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "MkvError"
    }
}

const HEAD_BYTES = 128 * 1024
/** A header element bigger than this is not what we think it is. */
const MAX_HEADER_ELEMENT = 16 * 1024 * 1024
const MAX_ATTACHMENTS = 200

const SUBTITLE_CODECS = new Set(["S_TEXT/ASS", "S_TEXT/SSA", "S_TEXT/UTF8", "S_TEXT/WEBVTT"])

/** Subtitle codecs this parser turns into lines (PGS and VobSub are images, which the spike skips). */
export function isTextSubtitle(track: Pick<MkvTrack, "codecId">) {
    return SUBTITLE_CODECS.has(track.codecId)
}

async function readWindow(reader: RangeReader, start: number, length: number): Promise<ByteWindow> {
    return { offset: start, bytes: await reader.read(start, length) }
}

/** The element at `at` with all of its data, fetching more when `window` doesn't hold it. */
async function readElement(reader: RangeReader, at: number, window?: ByteWindow): Promise<{ header: ElementHeader; window: ByteWindow }> {
    let current = window && at >= window.offset && at < window.offset + window.bytes.length ? window : await readWindow(reader, at, 4096)
    let header = readElementHeader(current, at)
    if (!header) {
        current = await readWindow(reader, at, 64)
        header = readElementHeader(current, at)
    }
    if (!header) throw new MkvError(`No element at ${at}`)
    if (header.size === null) throw new MkvError(`Element ${header.id.toString(16)} at ${at} has an unknown size`)
    if (header.size > MAX_HEADER_ELEMENT) throw new MkvError(`Element ${header.id.toString(16)} at ${at} is too big (${header.size} bytes)`)
    if (!hasData(current, header)) current = await readWindow(reader, at, header.dataStart - at + header.size)
    if (!hasData(current, header)) throw new MkvError(`Element ${header.id.toString(16)} at ${at} is cut short`)
    return { header, window: current }
}

function trackKind(type: number): MkvTrackKind {
    if (type === 1) return "video"
    if (type === 2) return "audio"
    if (type === 0x11) return "subtitle"
    return "other"
}

function parseTracks(window: ByteWindow, tracks: ElementHeader): MkvTrack[] {
    const out: MkvTrack[] = []
    for (const entry of children(window, tracks)) {
        if (entry.id !== ID.TrackEntry) continue
        const track: MkvTrack = { number: 0, kind: "other", codecId: "", default: true, forced: false }
        let type = 0
        for (const field of children(window, entry)) {
            const data = dataOf(window, field)
            switch (field.id) {
                case ID.TrackNumber: track.number = readUint(data); break
                case ID.TrackType: type = readUint(data); break
                case ID.FlagDefault: track.default = readUint(data) === 1; break
                case ID.FlagForced: track.forced = readUint(data) === 1; break
                case ID.Name: track.name = readString(data); break
                case ID.Language: track.language = readString(data); break
                case ID.LanguageIETF: track.languageIETF = readString(data); break
                case ID.CodecID: track.codecId = readString(data); break
                case ID.CodecPrivate: track.codecPrivate = data.slice(); break
                case ID.Video: {
                    const video = { width: 0, height: 0 }
                    for (const item of children(window, field)) {
                        if (item.id === ID.PixelWidth) video.width = readUint(dataOf(window, item))
                        if (item.id === ID.PixelHeight) video.height = readUint(dataOf(window, item))
                    }
                    track.video = video
                    break
                }
                case ID.Audio: {
                    const audio = { channels: 1, samplingFrequency: 8000 }
                    for (const item of children(window, field)) {
                        if (item.id === ID.Channels) audio.channels = readUint(dataOf(window, item))
                        if (item.id === ID.SamplingFrequency) audio.samplingFrequency = readFloat(dataOf(window, item))
                    }
                    track.audio = audio
                    break
                }
                case ID.ContentEncodings:
                    parseEncodings(window, field, track)
                    break
            }
        }
        track.kind = trackKind(type)
        out.push(track)
    }
    return out
}

function parseEncodings(window: ByteWindow, encodings: ElementHeader, track: MkvTrack) {
    for (const encoding of children(window, encodings)) {
        if (encoding.id !== ID.ContentEncoding) continue
        let type = 0
        let scope = 1
        let compression: MkvTrack["compression"] | undefined
        for (const item of children(window, encoding)) {
            if (item.id === ID.ContentEncodingType) type = readUint(dataOf(window, item))
            if (item.id === ID.ContentEncodingScope) scope = readUint(dataOf(window, item))
            if (item.id === ID.ContentCompression) {
                compression = { algo: 0 }
                for (const field of children(window, item)) {
                    if (field.id === ID.ContentCompAlgo) compression.algo = readUint(dataOf(window, field))
                    if (field.id === ID.ContentCompSettings) compression.settings = dataOf(window, field).slice()
                }
            }
        }
        // Scope bit 1: the frames. Only CodecPrivate (bit 2) leaves frames as they are.
        if (!(scope & 1)) continue
        if (type !== 0) {
            track.unsupportedEncoding = "encrypted"
        } else if (compression && compression.algo !== 0 && compression.algo !== 3) {
            track.unsupportedEncoding = compression.algo === 1 ? "bzlib" : compression.algo === 2 ? "lzo" : `compression ${compression.algo}`
        } else if (compression) {
            track.compression = compression
        }
    }
}

function parseCues(window: ByteWindow, cues: ElementHeader, segmentDataStart: number): MkvCue[] {
    const out: MkvCue[] = []
    for (const point of children(window, cues)) {
        if (point.id !== ID.CuePoint) continue
        let time = 0
        const positions: Array<Omit<MkvCue, "time">> = []
        for (const item of children(window, point)) {
            if (item.id === ID.CueTime) time = readUint(dataOf(window, item))
            if (item.id !== ID.CueTrackPositions) continue
            const position: Omit<MkvCue, "time"> = { track: 0, clusterPosition: 0 }
            for (const field of children(window, item)) {
                const value = readUint(dataOf(window, field))
                if (field.id === ID.CueTrack) position.track = value
                if (field.id === ID.CueClusterPosition) position.clusterPosition = segmentDataStart + value
                if (field.id === ID.CueRelativePosition) position.relativePosition = value
                if (field.id === ID.CueDuration) position.duration = value
            }
            positions.push(position)
        }
        for (const position of positions) out.push({ time, ...position })
    }
    return out
}

function parseChapters(window: ByteWindow, chapters: ElementHeader): MkvIndex["chapters"] {
    const out: MkvIndex["chapters"] = []
    for (const edition of children(window, chapters)) {
        if (edition.id !== ID.EditionEntry) continue
        for (const atom of children(window, edition)) {
            if (atom.id !== ID.ChapterAtom) continue
            let start = 0
            let title: string | undefined
            for (const item of children(window, atom)) {
                if (item.id === ID.ChapterTimeStart) start = readUint(dataOf(window, item)) / 1e9
                if (item.id === ID.ChapterDisplay && title === undefined) {
                    for (const display of children(window, item)) {
                        if (display.id === ID.ChapString) title = readString(dataOf(window, display))
                    }
                }
            }
            out.push({ start, title })
        }
        // The first (default) edition is enough.
        if (out.length > 0) break
    }
    return out
}

/** The AttachedFile entries in `window` (names and where their data is), without reading more. */
function parseAttachments(window: ByteWindow, attachments: ElementHeader): MkvAttachment[] {
    const out: MkvAttachment[] = []
    for (const file of children(window, attachments)) {
        if (file.id !== ID.AttachedFile || out.length >= MAX_ATTACHMENTS) continue
        const entry: MkvAttachment = { name: "", mediaType: "", dataStart: 0, size: 0 }
        for (const field of children(window, file)) {
            if (field.id === ID.FileData) {
                entry.dataStart = field.dataStart
                entry.size = field.size ?? 0
            } else if (field.id === ID.FileName) {
                entry.name = readString(dataOf(window, field))
            } else if (field.id === ID.FileMediaType) {
                entry.mediaType = readString(dataOf(window, field))
            }
        }
        if (entry.size > 0) out.push(entry)
    }
    return out
}

export type AttachedFile = MkvAttachment & { data: Uint8Array }

/**
 * Reads the Attachments element in a few large reads (the CDN rate-limits
 * many small ones) and returns its files. Null when it is bigger than
 * `maxBytes`, or the file has none.
 */
export async function readAttachedFiles(reader: RangeReader, index: MkvIndex, { maxBytes = 40 * 1024 * 1024, chunkBytes = 8 * 1024 * 1024 } = {}): Promise<AttachedFile[] | null> {
    const element = index.attachmentsElement
    if (!element) return []
    const total = element.dataStart - element.start + element.size
    if (total > maxBytes) return null
    const bytes = new Uint8Array(total)
    let filled = 0
    while (filled < total) {
        const part = await reader.read(element.start + filled, Math.min(chunkBytes, total - filled))
        if (part.length === 0) break
        bytes.set(part.subarray(0, total - filled), filled)
        filled += part.length
    }
    const window = { offset: element.start, bytes: bytes.subarray(0, filled) }
    const header = readElementHeader(window, element.start)
    if (!header || header.id !== ID.Attachments) throw new MkvError("No Attachments element where the SeekHead said")
    const files = parseAttachments(window, header)
    index.attachments = files
    return files
        .filter(file => file.dataStart + file.size <= window.offset + window.bytes.length)
        .map(file => ({ ...file, data: window.bytes.slice(file.dataStart - window.offset, file.dataStart - window.offset + file.size) }))
}

/** Whether an attachment is a font libass can use. */
export function isFontAttachment(attachment: Pick<MkvAttachment, "name" | "mediaType">) {
    return /font|truetype|opentype|sfnt/i.test(attachment.mediaType) || /\.(ttf|otf|ttc|woff2?)$/i.test(attachment.name)
}

/**
 * Reads the file's header: the EBML header, the Segment's top-level
 * elements up to the first Cluster, and whatever the SeekHead points at
 * past them (Cues at the end of the file, usually). Attachments are only
 * located; readAttachedFiles reads them.
 */
export async function readMkvIndex(reader: RangeReader): Promise<MkvIndex> {
    const head = await readWindow(reader, 0, HEAD_BYTES)
    const ebml = readElementHeader(head, 0)
    if (!ebml || ebml.id !== ID.EBML || ebml.size === null) throw new MkvError("Not a Matroska file (no EBML header)")
    let docType = ""
    for (const item of children(head, ebml)) {
        if (item.id === ID.DocType) docType = readString(dataOf(head, item))
    }
    if (docType !== "matroska" && docType !== "webm") throw new MkvError(`Not a Matroska file (DocType "${docType}")`)

    const segment = readElementHeader(head, ebml.dataStart + ebml.size)
    if (!segment || segment.id !== ID.Segment) throw new MkvError("No Segment after the EBML header")
    const segmentDataStart = segment.dataStart
    const segmentEnd = segment.size === null ? null : segment.dataStart + segment.size

    const index: MkvIndex = {
        docType,
        segmentDataStart,
        segmentEnd,
        timestampScale: 1_000_000,
        durationSec: 0,
        tracks: [],
        cues: [],
        hasCues: false,
        attachments: [],
        attachmentsElement: null,
        chapters: [],
        firstClusterPosition: null,
    }

    const seen = new Set<number>()
    const wanted = new Map<number, number>()
    let durationTicks = 0
    let infoSeen = false

    const handle = async (header: ElementHeader, window: ByteWindow) => {
        if (seen.has(header.start)) return
        seen.add(header.start)
        switch (header.id) {
            case ID.SeekHead:
                for (const seek of children(window, header)) {
                    if (seek.id !== ID.Seek) continue
                    let id = 0
                    let position = -1
                    for (const item of children(window, seek)) {
                        if (item.id === ID.SeekID) id = readUint(dataOf(window, item))
                        if (item.id === ID.SeekPosition) position = readUint(dataOf(window, item))
                    }
                    if (position >= 0) wanted.set(segmentDataStart + position, id)
                }
                break
            case ID.Info:
                infoSeen = true
                for (const item of children(window, header)) {
                    const data = dataOf(window, item)
                    if (item.id === ID.TimestampScale) index.timestampScale = readUint(data)
                    if (item.id === ID.Duration) durationTicks = readFloat(data)
                    if (item.id === ID.MuxingApp) index.muxingApp = readString(data)
                    if (item.id === ID.WritingApp) index.writingApp = readString(data)
                    if (item.id === 0x7ba9) index.title = readString(data)
                }
                break
            case ID.Tracks:
                index.tracks = parseTracks(window, header)
                break
            case ID.Cues:
                index.hasCues = true
                index.cues = parseCues(window, header, segmentDataStart)
                break
            case ID.Chapters:
                index.chapters = parseChapters(window, header)
                break
            case ID.Attachments:
                // No reads here: the fonts are read later in large pieces (readAttachedFiles).
                if (header.size !== null) index.attachmentsElement = { start: header.start, dataStart: header.dataStart, size: header.size }
                if (hasData(window, header)) index.attachments = parseAttachments(window, header)
                break
        }
    }

    // Walk the top-level elements at the start of the segment.
    const headerIds = new Set<number>([ID.SeekHead, ID.Info, ID.Tracks, ID.Cues, ID.Chapters])
    let at = segmentDataStart
    for (let guard = 0; guard < 64; guard++) {
        if (segmentEnd !== null && at >= segmentEnd) break
        let header: ElementHeader | null = null
        try {
            header = readElementHeader(head, at)
        } catch (error) {
            if (error instanceof EbmlError) break
            throw error
        }
        if (!header) {
            const more = await readWindow(reader, at, 64)
            header = readElementHeader(more, at)
        }
        if (!header || header.size === null) break
        if (header.id === ID.Cluster) {
            index.firstClusterPosition = header.start
            break
        }
        if (headerIds.has(header.id)) {
            const { header: full, window } = await readElement(reader, at, head)
            await handle(full, window)
        } else if (header.id === ID.Attachments) {
            await handle(header, head)
        }
        at = header.dataStart + header.size
    }

    // Then what the SeekHead points at beyond them (a second SeekHead included).
    for (let round = 0; round < 3; round++) {
        const pending = [...wanted.entries()].filter(([position, id]) => !seen.has(position)
            && (headerIds.has(id) || id === ID.Attachments))
        if (pending.length === 0) break
        for (const [position, id] of pending) {
            if (id === ID.Attachments) {
                const window = await readWindow(reader, position, 64)
                const header = readElementHeader(window, position)
                if (header?.id === ID.Attachments) await handle(header, window)
                else seen.add(position)
                continue
            }
            try {
                const { header, window } = await readElement(reader, position)
                if (header.id === id) await handle(header, window)
                else seen.add(position)
            } catch (error) {
                seen.add(position)
                if (id === ID.Tracks) throw error
            }
        }
    }

    if (!infoSeen) throw new MkvError("No Info element found")
    if (index.tracks.length === 0) throw new MkvError("No Tracks element found")
    index.durationSec = durationTicks * index.timestampScale / 1e9
    return index
}

/** The parts of a Block or SimpleBlock the subtitle reader uses. */
export type MkvBlock = { track: number; relativeTime: number; frames: Uint8Array[] }

/** Parses a (Simple)Block's data, laced or not. */
export function parseBlock(data: Uint8Array): MkvBlock {
    const { value: track, length } = readVint(data, 0)
    let pos = length
    const relativeTime = readInt16(data, pos)
    pos += 2
    const flags = data[pos++]
    const lacing = (flags >> 1) & 0x03
    if (lacing === 0) return { track, relativeTime, frames: [data.subarray(pos)] }

    const count = data[pos++] + 1
    const sizes: number[] = []
    if (lacing === 1) {
        // Xiph lacing
        for (let i = 0; i < count - 1; i++) {
            let size = 0
            let byte = 255
            while (byte === 255) {
                byte = data[pos++]
                size += byte
            }
            sizes.push(size)
        }
    } else if (lacing === 3) {
        // EBML lacing: the first size, then signed differences.
        const first = readVint(data, pos)
        pos += first.length
        sizes.push(first.value)
        for (let i = 1; i < count - 1; i++) {
            const diff = readVint(data, pos)
            pos += diff.length
            const bias = 2 ** (7 * diff.length - 1) - 1
            sizes.push(sizes[i - 1] + diff.value - bias)
        }
    }
    const remaining = data.length - pos
    if (lacing === 2) {
        const size = Math.floor(remaining / count)
        for (let i = 0; i < count - 1; i++) sizes.push(size)
    }
    sizes.push(remaining - sizes.reduce((sum, size) => sum + size, 0))
    const frames: Uint8Array[] = []
    for (const size of sizes) {
        frames.push(data.subarray(pos, pos + size))
        pos += size
    }
    return { track, relativeTime, frames }
}

/** A frame as stored before the track's ContentCompression. */
export function decodeFrame(track: MkvTrack, frame: Uint8Array): Uint8Array {
    if (track.unsupportedEncoding) throw new MkvError(`Track ${track.number} uses ${track.unsupportedEncoding} frames`)
    const compression = track.compression
    if (!compression) return frame
    if (compression.algo === 0) return inflateZlib(frame)
    // Header stripping: the stripped bytes go back in front.
    const settings = compression.settings ?? new Uint8Array(0)
    const out = new Uint8Array(settings.length + frame.length)
    out.set(settings, 0)
    out.set(frame, settings.length)
    return out
}

const HTML_ENTITIES: Record<string, string> = {
    "&lt;": "<", "&gt;": ">", "&amp;": "&", "&nbsp;": "\\h", "&quot;": "\"", "&#39;": "'", "&apos;": "'",
}

/** SRT/WebVTT text as an ASS line (newlines as \N, basic tags as overrides), like the server does. */
export function utf8ToAssText(text: string): string {
    return text
        .replace(/&(lt|gt|amp|nbsp|quot|#39|apos);/g, entity => HTML_ENTITIES[entity] ?? entity)
        .replace(/\r\n|\r|\n|<br\s*\/?>/gi, "\\N")
        .replace(/<(b|strong)>/gi, "{\\b1}").replace(/<\/(b|strong)>/gi, "{\\b0}")
        .replace(/<(i|em)>/gi, "{\\i1}").replace(/<\/(i|em)>/gi, "{\\i0}")
        .replace(/<u>/gi, "{\\u1}").replace(/<\/u>/gi, "{\\u0}")
        .replace(/<(s|strike|del)>/gi, "{\\s1}").replace(/<\/(s|strike|del)>/gi, "{\\s0}")
        .replace(/<\/?[a-z][^>]*>/gi, "")
}

/**
 * A subtitle frame as the web player's streamed line. `start` and
 * `duration` are in seconds. Matroska ASS packets are
 * "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text"
 * (SSA has Marked where ASS has Layer).
 */
export function subtitleLine(track: MkvTrack, payload: Uint8Array, start: number, duration: number): MpvStreamedSubtitleLine | null {
    const text = readString(payload)
    const end = start + (duration > 0 ? duration : 3)
    if (track.codecId === "S_TEXT/ASS" || track.codecId === "S_TEXT/SSA") {
        const fields = text.split(",")
        if (fields.length < 9) return null
        return {
            trackNumber: track.number,
            start,
            end,
            text: fields.slice(8).join(","),
            style: fields[2],
            ass: {
                layer: fields[1],
                name: fields[3],
                marginL: fields[4],
                marginR: fields[5],
                marginV: fields[6],
                effect: fields[7],
            },
        }
    }
    if (!text.trim()) return null
    return { trackNumber: track.number, start, end, text: utf8ToAssText(text), style: "Default" }
}

/** CodecPrivate as the server sends it: bytes as one char each. */
function latin1(bytes: Uint8Array | undefined) {
    if (!bytes) return undefined
    let out = ""
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
    return out
}

/** The file's tracks in the shape the server's direct stream reports (for the existing helpers). */
export function toMkvMetadata(index: MkvIndex): MKVParser_Metadata {
    const tracks: MKVParser_TrackInfo[] = index.tracks.map(track => ({
        number: track.number,
        uid: track.number,
        type: track.kind === "other" ? "unknown" : track.kind,
        codecID: track.codecId,
        name: track.name,
        language: track.language,
        languageIETF: track.languageIETF,
        default: track.default,
        forced: track.forced,
        enabled: true,
        // Subtitle headers are text; video ones only need their first bytes (profile checks).
        codecPrivate: track.kind === "subtitle" ? (track.codecPrivate ? readString(track.codecPrivate) : undefined) : latin1(track.codecPrivate?.subarray(0, 16)),
        video: track.video ? { PixelWidth: track.video.width, PixelHeight: track.video.height } : undefined,
        audio: track.audio ? { Channels: track.audio.channels, SamplingFrequency: track.audio.samplingFrequency, BitDepth: 0 } : undefined,
    }))
    return {
        title: index.title,
        duration: index.durationSec,
        timecodeScale: index.timestampScale,
        muxingApp: index.muxingApp,
        writingApp: index.writingApp,
        tracks,
        videoTracks: tracks.filter(track => track.type === "video"),
        audioTracks: tracks.filter(track => track.type === "audio"),
        subtitleTracks: tracks.filter(track => track.type === "subtitle"),
        chapters: index.chapters.map((chapter, i) => ({ uid: i + 1, start: chapter.start, text: chapter.title })),
        attachments: index.attachments.map((attachment, i) => ({
            uid: i + 1,
            filename: attachment.name,
            mimetype: attachment.mediaType,
            size: attachment.size,
            type: isFontAttachment(attachment) ? "font" as const : "other" as const,
        })),
    }
}
