#!/usr/bin/env node
/**
 * USAGE: node tools/seedDemoVault.mjs [--vault <dir>] [--origin <bare-dir>]
 *
 * Builds the stress-test vault the phase-4 behaviour checks run against: a git repo full of
 * `.excalidraw` boards plus a content-addressed `assets/` folder, and a bare origin beside it so
 * the sidebar's GitHub sync chip has somewhere to push. Node built-ins only (fs, path, crypto,
 * zlib, child_process) — the images are generated here, nothing is downloaded.
 *
 * Defaults (the names the YAZ-1775 demo used, resolved from `$HOME`):
 *   ~/Desktop/Port to Electron App - Local Version              the vault, a git repo on `main`
 *   ~/Desktop/Port to Electron App - Local Version (origin).git the bare origin it pushes to
 *
 * BOTH PATHS ARE WIPED FIRST. Point `--vault` at a scratch dir; never at a real vault.
 *
 * What it seeds, and the scenario each board is for: simple shapes · images from `assets/` ·
 * legacy embedded dataURLs (extracted to `assets/` on first save) · a missing asset (placeholder,
 * no crash) · a 40-image board · a ~10 MB PNG · corrupt JSON · an empty file · an upstream-minimal
 * scene · nested + unicode paths · a board sharing one image with another (dedupe) · 50 boards in
 * one folder · two orphan assets, one older than the 24 h sweep window and one fresh.
 *
 * It writes NO Electron user-data profile: the app opens a vault through the folder picker or ⌘O,
 * and `yaseendraw.json`'s schema is the app's own business (see LAUNCH.md "Behaviour checks" for
 * the isolated-profile recipe).
 */
import { randomFillSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { assetFileName, fileIdFor, fracIndex, parseArgs } from './lib/seedDemoVault.mjs'

// ---------------------------------------------------------------- paths
let args
try {
  args = parseArgs(process.argv.slice(2))
} catch (err) {
  console.error(`${err.message}\nusage: node tools/seedDemoVault.mjs [--vault <dir>] [--origin <bare-dir>]`)
  process.exit(2)
}
if (args.help) {
  console.log('usage: node tools/seedDemoVault.mjs [--vault <dir>] [--origin <bare-dir>]')
  process.exit(0)
}
const VAULT = args.vault
const ORIGIN = args.origin
const ASSETS = path.join(VAULT, 'assets')

const GIT = process.env.GIT || '/usr/bin/git'
const NOW = Date.now()

// ---------------------------------------------------------------- tiny image encoders
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}
/** RGB 8-bit PNG. `pixel(x, y)` returns [r, g, b]; or pass `raw` (pre-filled scanlines incl. filter bytes). */
function encodePNG(width, height, pixel, { level = 6, raw } = {}) {
  const stride = 1 + width * 3
  if (!raw) {
    raw = Buffer.alloc(stride * height)
    for (let y = 0; y < height; y++) {
      const row = y * stride
      raw[row] = 0 // filter: none
      for (let x = 0; x < width; x++) {
        const [r, g, b] = pixel(x, y)
        const o = row + 1 + x * 3
        raw[o] = r
        raw[o + 1] = g
        raw[o + 2] = b
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
const solidPNG = (w, h, [r, g, b]) => encodePNG(w, h, () => [r, g, b])
const gradientPNG = (w, h, [r0, g0, b0], [r1, g1, b1]) =>
  encodePNG(w, h, (x, y) => {
    const t = (x / (w - 1) + y / (h - 1)) / 2
    return [Math.round(r0 + (r1 - r0) * t), Math.round(g0 + (g1 - g0) * t), Math.round(b0 + (b1 - b0) * t)]
  })
/** Noisy (incompressible) RGB PNG of roughly the requested byte size. */
function noisyPNG(targetBytes) {
  const side = Math.ceil(Math.sqrt(targetBytes / 3))
  const stride = 1 + side * 3
  const raw = Buffer.alloc(stride * side)
  randomFillSync(raw)
  for (let y = 0; y < side; y++) raw[y * stride] = 0
  return encodePNG(side, side, null, { level: 1, raw })
}
function svgImage(label, fill) {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">\n` +
      `  <rect width="400" height="300" rx="24" fill="${fill}"/>\n` +
      `  <circle cx="200" cy="150" r="90" fill="#ffffff" fill-opacity="0.85"/>\n` +
      `  <text x="200" y="162" font-family="Helvetica, Arial, sans-serif" font-size="32" text-anchor="middle" fill="#1e1e1e">${label}</text>\n` +
      `</svg>\n`,
    'utf8',
  )
}
/** Baseline 1x1 grey JPEG: one-entry Huffman tables, DC=0 / EOB → scan bits "00" padded to 0x3F. */
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, // SOI
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 JFIF
  0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(0x01), // DQT: table 0, all ones
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, // SOF0: 8-bit, 1x1, 1 comp
  0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, ...new Array(15).fill(0x00), 0x00, // DHT DC0: one code (len 1) → symbol 0
  0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, ...new Array(15).fill(0x00), 0x00, // DHT AC0: one code (len 1) → EOB
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
  0x3f, // scan data: "0" (DC cat 0) + "0" (EOB) + 1-padding
  0xff, 0xd9, // EOI
])

// ---------------------------------------------------------------- Excalidraw helpers
let seedCounter = 1
let idCounter = 1
const rnd = () => Math.floor(Math.random() * 2 ** 31)
const newId = () => `demo-${(idCounter++).toString(36).padStart(4, '0')}-${rnd().toString(36)}`
const common = (i) => ({
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: fracIndex(i),
  roundness: null,
  seed: rnd() || seedCounter++,
  version: 1,
  versionNonce: rnd(),
  isDeleted: false,
  boundElements: null,
  updated: NOW,
  link: null,
  locked: false,
})
function rect(i, x, y, width, height, extra = {}) {
  return { id: newId(), type: 'rectangle', x, y, width, height, ...common(i), roundness: { type: 3 }, ...extra }
}
function text(i, x, y, str, fontSize = 20) {
  const lines = str.split('\n')
  const width = Math.ceil(Math.max(...lines.map((l) => l.length)) * fontSize * 0.6)
  const height = Math.ceil(lines.length * fontSize * 1.25)
  return {
    id: newId(),
    type: 'text',
    x,
    y,
    width,
    height,
    ...common(i),
    strokeWidth: 1,
    roughness: 0,
    text: str,
    originalText: str,
    fontSize,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    autoResize: true,
    lineHeight: 1.25,
    containerId: null,
  }
}
function image(i, x, y, width, height, fileId) {
  return {
    id: newId(),
    type: 'image',
    x,
    y,
    width,
    height,
    ...common(i),
    strokeColor: 'transparent',
    strokeWidth: 1,
    roughness: 0,
    status: 'saved',
    fileId,
    scale: [1, 1],
    crop: null,
  }
}
function board(elements, { files = {}, viewBackgroundColor = '#ffffff' } = {}) {
  return JSON.stringify(
    { type: 'excalidraw', version: 2, source: 'yaseen-draw-demo', elements, appState: { viewBackgroundColor, gridSize: null }, files },
    null,
    2,
  )
}

// ---------------------------------------------------------------- asset registry
/** name → { id, mime, bytes, file } ; `write: false` keeps the bytes OUT of assets/ (legacy / missing demos). */
const assets = new Map()
function asset(name, mime, bytes, { write = true } = {}) {
  const id = fileIdFor(bytes)
  const file = write ? path.join(ASSETS, assetFileName(id, mime)) : null
  assets.set(name, { id, mime, bytes, file, write })
  return id
}

// ---------------------------------------------------------------- build
function wipe(p) {
  fs.rmSync(p, { recursive: true, force: true })
}
function writeFile(rel, content) {
  const abs = path.join(VAULT, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}
function git(args, cwd = VAULT) {
  return execFileSync(GIT, ['-c', 'user.name=demo', '-c', 'user.email=demo@example.com', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()
}

console.log(`== wiping previous output\n   vault:  ${VAULT}\n   origin: ${ORIGIN}`)
wipe(VAULT)
wipe(ORIGIN)
fs.mkdirSync(ASSETS, { recursive: true })
fs.mkdirSync(path.dirname(ORIGIN), { recursive: true })

console.log('== generating images')
const t0 = Date.now()
const tinyId = asset('tiny-64x64.png', 'image/png', solidPNG(64, 64, [230, 60, 60]))
const mediumId = asset('medium-1200x800.png', 'image/png', gradientPNG(1200, 800, [20, 120, 220], [250, 200, 40]))
const svgId = asset('vector-400x300.svg', 'image/svg+xml', svgImage('SVG', '#6c5ce7'))
const bigId = asset('big-noise-~10MB.png', 'image/png', noisyPNG(10.8 * 1024 * 1024))
asset('legacy-embedded-A (NOT in assets)', 'image/png', solidPNG(48, 48, [46, 204, 113]), { write: false })
asset('legacy-embedded-B (NOT in assets)', 'image/png', solidPNG(48, 48, [155, 89, 182]), { write: false })
const missingId = fileIdFor(Buffer.from('this asset is missing on purpose')) // nothing is ever written for it
const heavyIds = []
const HEAVY_COLOURS = [
  [231, 76, 60], [230, 126, 34], [241, 196, 15], [46, 204, 113], [26, 188, 156],
  [52, 152, 219], [155, 89, 182], [52, 73, 94], [149, 165, 166], [255, 121, 198],
]
HEAVY_COLOURS.forEach((c, i) => heavyIds.push(asset(`heavy-${String(i + 1).padStart(2, '0')}-300x200.png`, 'image/png', gradientPNG(300, 200, c, [255, 255, 255]))))
asset('orphan-old (mtime 3 days ago)', 'image/png', solidPNG(32, 32, [90, 90, 90]))
asset('orphan-fresh (mtime now)', 'image/png', solidPNG(32, 32, [200, 200, 200]))
console.log(`   images generated in ${Date.now() - t0} ms`)

console.log('== writing assets/')
for (const [name, a] of assets) {
  if (!a.write) continue
  fs.writeFileSync(a.file, a.bytes)
  console.log(`   ${path.basename(a.file).padEnd(45)} ${String(a.bytes.length).padStart(10)} B  ${name}`)
}
const threeDaysAgo = new Date(NOW - 3 * 24 * 60 * 60 * 1000)
fs.utimesSync(assets.get('orphan-old (mtime 3 days ago)').file, threeDaysAgo, threeDaysAgo)
fs.writeFileSync(
  path.join(ASSETS, 'README-DEMO.txt'),
  [
    'Yaseen Draw demo vault — asset map (fileId = lowercase SHA-1 hex of the bytes, i.e. Excalidraw generateIdFromFile)',
    '',
    ...[...assets].map(([name, a]) => `${assetFileName(a.id, a.mime)}  ${a.write ? '' : '(NOT written) '}${name}`),
    `${missingId}.png  missing-on-purpose (referenced by "04 Missing asset", never written)`,
    '',
    'Orphans (referenced by no board): orphan-old, orphan-fresh.',
    'Not-written: the two legacy-embedded PNGs live only as dataURLs inside "03 Legacy embedded.excalidraw".',
    '',
  ].join('\n'),
)

console.log('== writing boards')
const boards = {}
const add = (rel, content) => {
  boards[rel] = writeFile(rel, content)
}

// Welcome
{
  const lines = [
    'Yaseen Draw — stress-test vault',
    '01 simple shapes',
    '02 images from assets/',
    '03 legacy embedded dataURLs',
    '04 missing asset',
    '05 image heavy (40 refs, 10 files)',
    '06 big image (~10 MB PNG)',
    '07 corrupt JSON',
    '08 empty file',
    '09 upstream minimal',
    '10/11 nested + unicode',
    '12 shares image with 02',
    '13 fifty boards',
  ]
  const els = [rect(0, 60, 40, 560, 60 + lines.length * 34, { backgroundColor: '#fff3bf', fillStyle: 'hachure' })]
  lines.forEach((l, i) => els.push(text(i + 1, 90, 70 + i * 34, l, i === 0 ? 28 : 20)))
  add('Welcome.excalidraw', board(els))
}

// 01 Simple shapes
add(
  '01 Simple shapes.excalidraw',
  board([
    rect(0, 100, 100, 200, 120, { backgroundColor: '#a5d8ff' }),
    rect(1, 360, 100, 200, 120, { backgroundColor: '#b2f2bb' }),
    rect(2, 620, 100, 200, 120, { backgroundColor: '#ffc9c9' }),
    text(3, 100, 260, 'Three rectangles, no images.'),
    text(4, 100, 300, 'Pure-vector baseline board.'),
  ]),
)

// 02 Images from assets
add(
  '02 Images from assets.excalidraw',
  board([
    image(0, 100, 100, 256, 256, tinyId),
    image(1, 420, 100, 600, 400, mediumId),
    image(2, 1080, 100, 400, 300, svgId),
    text(3, 100, 540, 'tiny 64x64 png · medium 1200x800 png · svg — all from assets/'),
  ]),
)

// 03 Legacy embedded (upstream-style files map, bytes NOT in assets/)
{
  const a = assets.get('legacy-embedded-A (NOT in assets)')
  const b = assets.get('legacy-embedded-B (NOT in assets)')
  const files = {}
  for (const f of [a, b]) files[f.id] = { mimeType: f.mime, id: f.id, dataURL: `data:${f.mime};base64,${f.bytes.toString('base64')}`, created: NOW }
  add(
    '03 Legacy embedded.excalidraw',
    board([image(0, 100, 100, 240, 240, a.id), image(1, 420, 100, 240, 240, b.id), text(2, 100, 380, 'Both images are embedded as dataURL in "files" — first save should extract them to assets/.')], { files }),
  )
}

// 04 Missing asset
add('04 Missing asset.excalidraw', board([image(0, 100, 100, 320, 240, missingId), text(1, 100, 380, 'image is missing on purpose')]))

// 05 Image heavy 40 (8x5 grid, 10 distinct PNGs x4)
{
  const els = []
  for (let n = 0; n < 40; n++) {
    const col = n % 8
    const row = Math.floor(n / 8)
    els.push(image(n, 60 + col * 340, 60 + row * 240, 300, 200, heavyIds[n % 10]))
  }
  add('05 Image heavy 40.excalidraw', board(els))
}

// 06 Big image 10MB
{
  const big = assets.get('big-noise-~10MB.png')
  add('06 Big image 10MB.excalidraw', board([image(0, 100, 100, 1200, 1200, bigId), text(1, 100, 1340, `one ~${(big.bytes.length / 1024 / 1024).toFixed(1)} MB noisy PNG`)]))
}

// 07 Corrupt, 08 Empty, 09 Upstream minimal
add('07 Corrupt.excalidraw', '{"type": "excalidraw", "elements": [')
add('08 Empty file.excalidraw', '')
add('09 Upstream minimal.excalidraw', board([], { viewBackgroundColor: '#f5f5f5' }))

// 10 / 11 nested
add('Folder A/10 Nested board.excalidraw', board([rect(0, 100, 100, 240, 140, { backgroundColor: '#d0bfff' }), rect(1, 400, 100, 240, 140, { backgroundColor: '#ffd8a8' })]))
add('Folder A/Sub folder/11 Deep unicode 🎨 ünïcødé.excalidraw', board([text(0, 100, 100, 'Deep, nested, unicode file name 🎨 ünïcødé')]))

// 12 shares the medium png with 02
add('12 Shares image with 02.excalidraw', board([image(0, 100, 100, 600, 400, mediumId), text(1, 100, 540, 'same fileId as the medium png in board 02 (dedupe)')]))

// 13 Fifty boards
for (let n = 1; n <= 50; n++) {
  const nn = String(n).padStart(2, '0')
  add(`13 Fifty boards/Board ${nn}.excalidraw`, board([rect(0, 100, 100, 200 + n * 4, 120, { backgroundColor: `hsl(${(n * 37) % 360}, 70%, 85%)` }), text(1, 100, 260, `Board ${nn}`)]))
}

// non-drawing files
writeFile('notes.md', '# Demo vault notes\n\n- This vault stress-tests Yaseen Draw.\n- Drawings are `*.excalidraw`; image bytes live in `assets/<sha1>.<ext>`.\n- See `Welcome.excalidraw` for the scenario list.\n')
writeFile('random.txt', 'just a plain text file — not a drawing\n')
writeFile('photo.jpg', TINY_JPEG)

console.log(`   ${Object.keys(boards).length} boards written`)

// ---------------------------------------------------------------- git
console.log('== git')
git(['init', '-q', '-b', 'main'])
git(['add', '-A'])
git(['commit', '-q', '-m', 'seed demo vault'])
git(['init', '-q', '--bare', '-b', 'main', ORIGIN], path.dirname(ORIGIN))
git(['remote', 'add', 'origin', ORIGIN])
git(['push', '-q', '-u', 'origin', 'main'])
// The per-vault sync switch (🔒 YAZ-1775 D1: the dotfolder is `.yaseendraw/`, not the docs app's name).
writeFile('.yaseendraw/github.json', JSON.stringify({ enabled: true }, null, 2) + '\n')
git(['add', '-A'])
git(['commit', '-q', '-m', 'enable github sync'])
git(['push', '-q', 'origin', 'main'])
console.log('   ' + git(['log', '--oneline']).replace(/\n/g, '\n   '))

console.log('\nDone.')
console.log(`vault:  ${VAULT}`)
console.log(`origin: ${ORIGIN}`)
console.log(`Open it in the app with the vault switcher's "Open folder…" (⌘O). Assets map: ${path.join(ASSETS, 'README-DEMO.txt')}`)
