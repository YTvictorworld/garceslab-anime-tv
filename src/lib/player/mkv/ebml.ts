/**
 * Minimal EBML reading for direct play's Matroska parser.
 * Works on byte windows fetched with HTTP Range requests, so every reader
 * takes an absolute file offset and the window it was read into.
 * Kept free of React Native (and of `@/` imports) so the tests load it.
 */

/** Matroska element IDs the parser uses (with their length marker bits). */
export const ID = {
    EBML: 0x1a45dfa3,
    DocType: 0x4282,
    Segment: 0x18538067,
    SeekHead: 0x114d9b74,
    Seek: 0x4dbb,
    SeekID: 0x53ab,
    SeekPosition: 0x53ac,
    Info: 0x1549a966,
    TimestampScale: 0x2ad7b1,
    Duration: 0x4489,
    MuxingApp: 0x4d80,
    WritingApp: 0x5741,
    Tracks: 0x1654ae6b,
    TrackEntry: 0xae,
    TrackNumber: 0xd7,
    TrackType: 0x83,
    FlagDefault: 0x88,
    FlagForced: 0x55aa,
    Name: 0x536e,
    Language: 0x22b59c,
    LanguageIETF: 0x22b59d,
    CodecID: 0x86,
    CodecPrivate: 0x63a2,
    Video: 0xe0,
    PixelWidth: 0xb0,
    PixelHeight: 0xba,
    Audio: 0xe1,
    SamplingFrequency: 0xb5,
    Channels: 0x9f,
    ContentEncodings: 0x6d80,
    ContentEncoding: 0x6240,
    ContentEncodingScope: 0x5032,
    ContentEncodingType: 0x5033,
    ContentCompression: 0x5034,
    ContentCompAlgo: 0x4254,
    ContentCompSettings: 0x4255,
    Cues: 0x1c53bb6b,
    CuePoint: 0xbb,
    CueTime: 0xb3,
    CueTrackPositions: 0xb7,
    CueTrack: 0xf7,
    CueClusterPosition: 0xf1,
    CueRelativePosition: 0xf0,
    CueDuration: 0xb2,
    Attachments: 0x1941a469,
    AttachedFile: 0x61a7,
    FileName: 0x466e,
    FileMediaType: 0x4660,
    FileData: 0x465c,
    Chapters: 0x1043a770,
    EditionEntry: 0x45b9,
    ChapterAtom: 0xb6,
    ChapterTimeStart: 0x91,
    ChapterDisplay: 0x80,
    ChapString: 0x85,
    Cluster: 0x1f43b675,
    Timestamp: 0xe7,
    SimpleBlock: 0xa3,
    BlockGroup: 0xa0,
    Block: 0xa1,
    BlockDuration: 0x9b,
    Void: 0xec,
    Tags: 0x1254c367,
} as const

/** An element header: where it starts, where its data starts and how long the data is. */
export type ElementHeader = {
    id: number
    /** Absolute offset of the element (its ID). */
    start: number
    /** Absolute offset of its data. */
    dataStart: number
    /** Data size; null when unknown (live-style "unknown size", all ones). */
    size: number | null
}

export class EbmlError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "EbmlError"
    }
}

/** A window of the file: `bytes` holds the file's bytes from `offset` on. */
export type ByteWindow = { offset: number; bytes: Uint8Array }

function vintLength(first: number): number {
    if (first === 0) return 0
    let length = 1
    let mask = 0x80
    while (!(first & mask)) {
        length++
        mask >>= 1
    }
    return length
}

/**
 * Reads an element header at absolute `at` inside `window`. Returns null when
 * the window ends before the header does (the caller fetches more).
 */
export function readElementHeader(window: ByteWindow, at: number): ElementHeader | null {
    const { bytes, offset } = window
    let pos = at - offset
    if (pos < 0) throw new EbmlError(`Header at ${at} is before the window at ${offset}`)
    if (pos >= bytes.length) return null

    const idLength = vintLength(bytes[pos])
    if (idLength === 0 || idLength > 4) throw new EbmlError(`Invalid element ID at ${at}`)
    if (pos + idLength > bytes.length) return null
    let id = 0
    for (let i = 0; i < idLength; i++) id = id * 256 + bytes[pos + i]
    pos += idLength

    if (pos >= bytes.length) return null
    const sizeLength = vintLength(bytes[pos])
    if (sizeLength === 0 || sizeLength > 8) throw new EbmlError(`Invalid element size at ${at}`)
    if (pos + sizeLength > bytes.length) return null
    let size = bytes[pos] & (0xff >> sizeLength)
    let allOnes = size === (0xff >> sizeLength)
    for (let i = 1; i < sizeLength; i++) {
        const byte = bytes[pos + i]
        if (byte !== 0xff) allOnes = false
        size = size * 256 + byte
    }
    pos += sizeLength

    return { id, start: at, dataStart: offset + pos, size: allOnes ? null : size }
}

/** Whether the element's data is entirely inside the window. */
export function hasData(window: ByteWindow, header: ElementHeader): boolean {
    return header.size !== null && header.dataStart + header.size <= window.offset + window.bytes.length
}

export function dataOf(window: ByteWindow, header: ElementHeader): Uint8Array {
    const from = header.dataStart - window.offset
    const size = header.size ?? (window.bytes.length - from)
    return window.bytes.subarray(from, from + size)
}

/** The child elements of a master element whose data is in the window. */
export function children(window: ByteWindow, parent: ElementHeader): ElementHeader[] {
    const end = parent.size === null ? window.offset + window.bytes.length : parent.dataStart + parent.size
    const out: ElementHeader[] = []
    let at = parent.dataStart
    while (at < end) {
        const child = readElementHeader(window, at)
        if (!child || child.size === null) break
        out.push(child)
        at = child.dataStart + child.size
    }
    return out
}

export function readUint(data: Uint8Array): number {
    let value = 0
    for (let i = 0; i < data.length; i++) value = value * 256 + data[i]
    return value
}

export function readFloat(data: Uint8Array): number {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (data.length === 4) return view.getFloat32(0)
    if (data.length === 8) return view.getFloat64(0)
    return 0
}

let decoder: TextDecoder | null = null

export function readString(data: Uint8Array): string {
    decoder ??= new TextDecoder("utf-8")
    // Matroska strings may be NUL-padded.
    let end = data.length
    while (end > 0 && data[end - 1] === 0) end--
    return decoder.decode(data.subarray(0, end))
}

/** A signed big-endian 16-bit integer (a block's relative timestamp). */
export function readInt16(data: Uint8Array, at: number): number {
    const value = (data[at] << 8) | data[at + 1]
    return value & 0x8000 ? value - 0x10000 : value
}

/** A vint as a number (block track numbers, lace sizes); returns the value and its length. */
export function readVint(data: Uint8Array, at: number): { value: number; length: number } {
    const length = vintLength(data[at])
    if (length === 0 || at + length > data.length) throw new EbmlError("Invalid vint")
    let value = data[at] & (0xff >> length)
    for (let i = 1; i < length; i++) value = value * 256 + data[at + i]
    return { value, length }
}
