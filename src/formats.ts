// File formats: PNG text chunks, ZIP (read + store-only write), RisuAI .risum (RPack).

const utf8 = new TextDecoder('utf-8')
const latin1 = new TextDecoder('latin1')
const enc = new TextEncoder()

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(s)
}

export const textToB64 = (t: string) => bytesToB64(enc.encode(t))
export const b64ToText = (b: string) => utf8.decode(b64ToBytes(b))

const u32le = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
const u16le = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8)
const u32be = (b: Uint8Array, p: number) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array, crc = 0): number {
  crc = ~crc >>> 0
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return ~crc >>> 0
}

// ---------- PNG ----------
export interface PngInfo {
  texts: Record<string, string>
}

export function isPng(bytes: Uint8Array) {
  return bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
}

export function readPngTexts(bytes: Uint8Array): PngInfo | null {
  if (!isPng(bytes)) return null
  const texts: Record<string, string> = {}
  let p = 8
  while (p + 8 <= bytes.length) {
    const len = u32be(bytes, p)
    const type = latin1.decode(bytes.subarray(p + 4, p + 8))
    const data = bytes.subarray(p + 8, p + 8 + len)
    if (type === 'tEXt') {
      const z = data.indexOf(0)
      texts[latin1.decode(data.subarray(0, z))] = latin1.decode(data.subarray(z + 1))
    } else if (type === 'iTXt') {
      const z = data.indexOf(0)
      let q = z + 3
      q = data.indexOf(0, q) + 1
      q = data.indexOf(0, q) + 1
      texts[latin1.decode(data.subarray(0, z))] = utf8.decode(data.subarray(q))
    }
    if (type === 'IEND') break
    p += 12 + len
  }
  return { texts }
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Returns a copy of the PNG with every tEXt/iTXt chunk removed and the given tEXt chunks added. */
export function writePngTexts(png: Uint8Array, texts: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [png.subarray(0, 8)]
  let p = 8
  while (p + 8 <= png.length) {
    const len = u32be(png, p)
    const type = latin1.decode(png.subarray(p + 4, p + 8))
    const chunk = png.subarray(p, p + 12 + len)
    if (type === 'IEND') {
      for (const [k, v] of Object.entries(texts)) {
        const body = new Uint8Array(k.length + 1 + v.length)
        for (let i = 0; i < k.length; i++) body[i] = k.charCodeAt(i)
        for (let i = 0; i < v.length; i++) body[k.length + 1 + i] = v.charCodeAt(i) & 0xff
        parts.push(pngChunk('tEXt', body))
      }
      parts.push(chunk)
      break
    }
    if (type !== 'tEXt' && type !== 'iTXt' && type !== 'zTXt') parts.push(chunk)
    p += 12 + len
  }
  const total = parts.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const part of parts) { out.set(part, o); o += part.length }
  return out
}

// ---------- ZIP read ----------
export interface ZipEntry {
  name: string
  method: number
  compSize: number
  size: number
  localOffset: number
}

export function readZipDirectory(bytes: Uint8Array): ZipEntry[] | null {
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i--) {
    if (u32le(bytes, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = u16le(bytes, eocd + 10)
  const cdSize = u32le(bytes, eocd + 12)
  const cdOffset = u32le(bytes, eocd + 16)
  const shift = eocd - cdSize - cdOffset // zip appended after a jpeg/png
  const entries: ZipEntry[] = []
  let p = cdOffset + shift
  for (let i = 0; i < count; i++) {
    if (u32le(bytes, p) !== 0x02014b50) break
    const nameLen = u16le(bytes, p + 28)
    const extraLen = u16le(bytes, p + 30)
    const commentLen = u16le(bytes, p + 32)
    entries.push({
      name: utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: u16le(bytes, p + 10),
      compSize: u32le(bytes, p + 20),
      size: u32le(bytes, p + 24),
      localOffset: u32le(bytes, p + 42) + shift,
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function readZipEntry(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const p = e.localOffset
  const start = p + 30 + u16le(bytes, p + 26) + u16le(bytes, p + 28)
  const data = bytes.subarray(start, start + e.compSize)
  if (e.method === 0) return data
  if (e.method === 8) return inflateRaw(data)
  throw new Error('지원하지 않는 압축 방식: ' + e.method)
}

// ---------- ZIP write (store only, streamed as Blob parts) ----------
export class ZipWriter {
  private parts: BlobPart[] = []
  private central: Uint8Array[] = []
  private offset = 0
  private count = 0

  add(name: string, data: Uint8Array) {
    const nameBytes = enc.encode(name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, 0, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)

    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, this.offset, true)
    cd.set(nameBytes, 46)

    this.parts.push(local as BlobPart, data as BlobPart)
    this.central.push(cd)
    this.offset += local.length + data.length
    this.count++
  }

  addText(name: string, text: string) {
    this.add(name, enc.encode(text))
  }

  finish(type = 'application/zip'): Blob {
    const cdSize = this.central.reduce((a, b) => a + b.length, 0)
    const end = new Uint8Array(22)
    const ev = new DataView(end.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, this.count, true)
    ev.setUint16(10, this.count, true)
    ev.setUint32(12, cdSize, true)
    ev.setUint32(16, this.offset, true)
    return new Blob([...this.parts, ...(this.central as BlobPart[]), end as BlobPart], { type })
  }
}

// ---------- RisuAI .risum ----------
// RPack decode map, MIT (c) Kwaroran
const RPACK_DECODE = b64ToBytes('LPeEi8ll+7afrrMDLQFpdB/ko+zuXDQhk0oPauJiAp4inP08/HHHxq1ZZwVwbYpEEvokhl+v0XpHzv5QY91RBm8Y4FKoCZ1Wc0y4U2zDoA4Zzz4NfgcyaEbqSPmZLqukSSBeVTU4DLzTsVgWeSgKGuHyzcQ526K6YHJ2fZXvf8jA3jeUv7UUgZIlRazn9WanKzZawRPjSzrojYMbfCewmkLrh6rcVI54JtJXKdS3+C+PiXXwQXfCHv/YFRHlBJcX8zHQmwDXyrRPKjvZsmvaXaE/MGG9kT1O5t++TYKMHSMQmGT0hTN7kEO7qYjx1qUc9sxuuVsLlu3V6cXLCKaAQA==')

function rpackDecode(enc: Uint8Array): Uint8Array {
  const out = new Uint8Array(enc.length)
  for (let i = 0; i < enc.length; i++) out[i] = RPACK_DECODE[enc[i]]
  return out
}

export interface RisumData {
  module: any
  /** lazily decoded asset bytes, same order as module.assets */
  assetData: Array<() => Uint8Array>
  assetSizes: number[]
}

export function readRisum(bytes: Uint8Array): RisumData {
  if (bytes[0] !== 111 || bytes[1] !== 0) throw new Error('risum 형식이 아닙니다')
  const len = u32le(bytes, 2)
  const main = JSON.parse(utf8.decode(rpackDecode(bytes.subarray(6, 6 + len))))
  if (main.type !== 'risuModule') throw new Error('리스 모듈이 아닙니다')
  let p = 6 + len
  const assetData: Array<() => Uint8Array> = []
  const assetSizes: number[] = []
  while (p < bytes.length && bytes[p] === 1) {
    const l = u32le(bytes, p + 1)
    const slice = bytes.subarray(p + 5, p + 5 + l)
    assetData.push(() => rpackDecode(slice))
    assetSizes.push(l)
    p += 5 + l
  }
  return { module: main.module, assetData, assetSizes }
}

export const decodeUtf8 = (b: Uint8Array) => utf8.decode(b)
