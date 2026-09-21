/**
 * Image bytes for the first-class-images e2e specs (YAZ-1656): `imagePaste.spec.ts` (4A) and
 * `imageRender.spec.ts` (4B).
 *
 * WHY A GENERATOR AND NOT A CHECKED-IN .png: the specs care about exactly two properties of the
 * bytes — that they are a REAL PNG a browser will decode (`naturalWidth > 0`), and what their
 * PIXEL WIDTH is (`insertImage.ts` writes `|400` only for an image WIDER than
 * `PASTED_IMAGE_WIDTH`, and keeps a narrow one at its natural size). Both are parameters here,
 * so the fixture that drives each branch reads as the branch it drives instead of as an opaque
 * base64 blob or a binary in git. No dependency either: `sharp` is not in `node_modules`, and a
 * truecolour PNG is a signature, three chunks and one `deflateSync` (PNG spec §11).
 *
 * The rows carry a gradient rather than one flat colour on purpose — a solid rectangle is the
 * one bitmap an encoder anywhere in the clipboard path could plausibly shortcut, and the specs
 * compare what came back out.
 *
 * Nothing here is written into the repo: each spec writes what it needs into ITS OWN temp vault
 * copy in `beforeAll` (the drawing.spec.ts / links.spec.ts pattern — the real vault and the
 * checked-in `fixtures/*-vault` trees are never touched).
 */
import { deflateSync } from 'node:zlib'

/** PNG's 8-byte file signature (`\x89PNG\r\n\x1a\n`). */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The standard CRC-32 table PNG chunks are checksummed with (spec Annex D). */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** `<length><type><data><crc>` — the one chunk shape every PNG chunk has. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/**
 * A real `width` × `height` 8-bit truecolour PNG, filter 0 on every scanline, no interlace.
 * Decodes in Chromium, in `nativeImage`, and in `pngSize()` below.
 */
export function pngBytes(width: number, height: number, seed = 0): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type 2 = truecolour RGB
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    raw[row] = 0 // filter type 0 (None) for this scanline
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3
      raw[p] = (seed + x) & 0xff
      raw[p + 1] = (seed + y) & 0xff
      raw[p + 2] = (seed + x + y) & 0xff
    }
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** The IHDR dimensions of `bytes`, or null when it is not a PNG at all — how a spec reads a file back. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** True when `bytes` at least starts like a PNG — the cheap "this is still an image" check. */
export const isPng = (bytes: Buffer): boolean => bytes.subarray(0, 8).equals(SIGNATURE)

/** Wider than `PASTED_IMAGE_WIDTH` (400), so a paste of it must write `|400` into the alt. */
export const WIDE_WIDTH = 800
export const WIDE_HEIGHT = 300
export const WIDE_PNG = pngBytes(WIDE_WIDTH, WIDE_HEIGHT, 17)

/** Narrower than `PASTED_IMAGE_WIDTH`, so a paste of it keeps its natural size — no `|W` at all. */
export const NARROW_WIDTH = 100
export const NARROW_HEIGHT = 60
export const NARROW_PNG = pngBytes(NARROW_WIDTH, NARROW_HEIGHT, 91)

/**
 * The render spec's in-vault images: small enough that the editor column never clamps them, so a
 * resize drag has room to GROW the image rather than hitting the column ceiling.
 */
export const SMALL_WIDTH = 240
export const SMALL_HEIGHT = 160
export const smallPng = (seed: number): Buffer => pngBytes(SMALL_WIDTH, SMALL_HEIGHT, seed)
