/**
 * zlib (RFC 1950/1951) decompression for Matroska tracks with
 * ContentCompAlgo 0. Older mkvmerge versions compress text subtitles with
 * zlib by default, and Chromium 79 has no DecompressionStream, so this is a
 * small stand-alone inflate (after the classic tiny-inflate design).
 */

type Tree = { counts: Uint16Array; symbols: Uint16Array }

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

function buildTree(lengths: ArrayLike<number>, offset: number, count: number): Tree {
    const counts = new Uint16Array(16)
    const symbols = new Uint16Array(count)
    for (let i = 0; i < count; i++) counts[lengths[offset + i]]++
    counts[0] = 0
    const offs = new Uint16Array(16)
    for (let i = 0, sum = 0; i < 16; i++) {
        offs[i] = sum
        sum += counts[i]
    }
    for (let i = 0; i < count; i++) {
        const length = lengths[offset + i]
        if (length) symbols[offs[length]++] = i
    }
    return { counts, symbols }
}

let fixedLiteral: Tree | null = null
let fixedDistance: Tree | null = null

function fixedTrees() {
    if (!fixedLiteral || !fixedDistance) {
        const lengths = new Uint8Array(288)
        lengths.fill(8, 0, 144)
        lengths.fill(9, 144, 256)
        lengths.fill(7, 256, 280)
        lengths.fill(8, 280, 288)
        fixedLiteral = buildTree(lengths, 0, 288)
        fixedDistance = buildTree(new Uint8Array(30).fill(5), 0, 30)
    }
    return { literal: fixedLiteral, distance: fixedDistance }
}

class BitReader {
    private readonly data: Uint8Array
    private pos: number
    private bitBuffer = 0
    private bitCount = 0

    constructor(data: Uint8Array, start: number) {
        this.data = data
        this.pos = start
    }

    bit(): number {
        if (this.bitCount === 0) {
            if (this.pos >= this.data.length) throw new Error("inflate: unexpected end of data")
            this.bitBuffer = this.data[this.pos++]
            this.bitCount = 8
        }
        const value = this.bitBuffer & 1
        this.bitBuffer >>= 1
        this.bitCount--
        return value
    }

    bits(count: number, base = 0): number {
        let value = 0
        for (let i = 0; i < count; i++) value |= this.bit() << i
        return value + base
    }

    decode(tree: Tree): number {
        let sum = 0
        let cur = 0
        let len = 0
        do {
            cur = 2 * cur + this.bit()
            len++
            if (len > 15) throw new Error("inflate: invalid code")
            sum += tree.counts[len]
            cur -= tree.counts[len]
        } while (cur >= 0)
        return tree.symbols[sum + cur]
    }

    alignToByte(): number {
        this.bitCount = 0
        return this.pos
    }

    skipTo(pos: number) {
        this.pos = pos
    }
}

class Output {
    buffer: Uint8Array
    length = 0

    constructor(size: number) {
        this.buffer = new Uint8Array(Math.max(256, size))
    }

    private ensure(extra: number) {
        if (this.length + extra <= this.buffer.length) return
        let size = this.buffer.length * 2
        while (size < this.length + extra) size *= 2
        const next = new Uint8Array(size)
        next.set(this.buffer.subarray(0, this.length))
        this.buffer = next
    }

    push(byte: number) {
        this.ensure(1)
        this.buffer[this.length++] = byte
    }

    copy(distance: number, length: number) {
        if (distance > this.length) throw new Error("inflate: distance too far back")
        this.ensure(length)
        for (let i = 0; i < length; i++) {
            this.buffer[this.length] = this.buffer[this.length - distance]
            this.length++
        }
    }

    append(bytes: Uint8Array) {
        this.ensure(bytes.length)
        this.buffer.set(bytes, this.length)
        this.length += bytes.length
    }
}

function dynamicTrees(reader: BitReader) {
    const literalCount = reader.bits(5, 257)
    const distanceCount = reader.bits(5, 1)
    const codeLengthCount = reader.bits(4, 4)
    const codeLengths = new Uint8Array(19)
    for (let i = 0; i < codeLengthCount; i++) codeLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3)
    const codeTree = buildTree(codeLengths, 0, 19)

    const lengths = new Uint8Array(literalCount + distanceCount)
    for (let i = 0; i < lengths.length;) {
        const symbol = reader.decode(codeTree)
        if (symbol < 16) {
            lengths[i++] = symbol
            continue
        }
        let repeat: number
        let value = 0
        if (symbol === 16) {
            if (i === 0) throw new Error("inflate: repeat with no previous length")
            value = lengths[i - 1]
            repeat = reader.bits(2, 3)
        } else if (symbol === 17) {
            repeat = reader.bits(3, 3)
        } else {
            repeat = reader.bits(7, 11)
        }
        while (repeat-- > 0 && i < lengths.length) lengths[i++] = value
    }
    return {
        literal: buildTree(lengths, 0, literalCount),
        distance: buildTree(lengths, literalCount, distanceCount),
    }
}

/** Raw DEFLATE data from `start`. */
export function inflateRaw(data: Uint8Array, start = 0): Uint8Array {
    const reader = new BitReader(data, start)
    const out = new Output(data.length * 4)
    let last = 0
    while (!last) {
        last = reader.bit()
        const type = reader.bits(2)
        if (type === 0) {
            const pos = reader.alignToByte()
            if (pos + 4 > data.length) throw new Error("inflate: truncated stored block")
            const length = data[pos] | (data[pos + 1] << 8)
            const end = pos + 4 + length
            if (end > data.length) throw new Error("inflate: truncated stored block")
            out.append(data.subarray(pos + 4, end))
            reader.skipTo(end)
            continue
        }
        if (type === 3) throw new Error("inflate: invalid block type")
        const { literal, distance } = type === 1 ? fixedTrees() : dynamicTrees(reader)
        for (;;) {
            const symbol = reader.decode(literal)
            if (symbol === 256) break
            if (symbol < 256) {
                out.push(symbol)
                continue
            }
            const index = symbol - 257
            if (index >= LENGTH_BASE.length) throw new Error("inflate: invalid length symbol")
            const length = reader.bits(LENGTH_EXTRA[index], LENGTH_BASE[index])
            const distSymbol = reader.decode(distance)
            if (distSymbol >= DIST_BASE.length) throw new Error("inflate: invalid distance symbol")
            out.copy(reader.bits(DIST_EXTRA[distSymbol], DIST_BASE[distSymbol]), length)
        }
    }
    return out.buffer.slice(0, out.length)
}

/** zlib-wrapped data (a 2-byte header, DEFLATE, Adler-32), as Matroska stores it. */
export function inflateZlib(data: Uint8Array): Uint8Array {
    if (data.length < 2) throw new Error("inflate: no zlib header")
    const cmf = data[0]
    const flg = data[1]
    if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0) {
        // Some muxers wrote raw DEFLATE; try that.
        return inflateRaw(data, 0)
    }
    if (flg & 0x20) throw new Error("inflate: preset dictionary not supported")
    return inflateRaw(data, 2)
}
