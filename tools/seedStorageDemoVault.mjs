#!/usr/bin/env node
/**
 * USAGE: node tools/seedStorageDemoVault.mjs --root <dir> [--force]
 *
 * The demo behind YAZ-1801 "Board Size Considerations" — Settings › Storage, the oversize-file
 * sync guard and "Move pictures out of boards". Everything it writes lives under `<root>`:
 *
 *   <root>/remote.git/                                   a LOCAL bare repo standing in for GitHub (never GitHub)
 *   <root>/Board Size Considerations (YAZ-1801)/         the vault: a git repo, origin → remote.git, upstream set,
 *                                                        a local identity, `.yaseendraw/github.json` = on, and a
 *                                                        few commits of history so "old versions" is not zero
 *   <root>/Board Size Considerations (YAZ-1801) - no git/  a small plain folder: the "Not a git repo" state
 *   <root>/yaseendraw.json                               an app-state file opening the main vault — launch with
 *                                                        YASEEN_DRAW_USER_DATA_DIR=<root>
 *
 * The boards, each named for what it proves: a modern lean board; legacy boards with 3 small,
 * ~45 MB and ~60 MB (amber) of embedded pictures; a ~110 MB board that is left UNCOMMITTED so the
 * first sync hits the 95 MiB guard (D3); two boards embedding the SAME picture (dedupe); a nested
 * legacy board; corrupt JSON; an embedded picture nothing references; a malformed dataURL; and a
 * 120 MB `Big video.mov` (sparse, also uncommitted) proving the guard is about any file. Every
 * legacy board carries a `yaseendraw` block dated 2026-01-15, so the demo can show `updatedAt`
 * does not move after "Move pictures out of boards". Pictures are noisy PNGs (incompressible),
 * generated here — nothing is downloaded. Disk: roughly 450 MB.
 *
 * `--root` IS REQUIRED AND IS WIPED (the `seedDemoVault.mjs` rule): no default, an existing path is
 * refused unless `--force`, and a root that is or contains the real vault or the real app-state
 * folder is refused outright, `--force` or not.
 */
import { randomFillSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { assetFileName, fileIdFor, fracIndex } from './lib/seedDemoVault.mjs'

const USAGE = 'usage: node tools/seedStorageDemoVault.mjs --root <dir> [--force]'
const args = process.argv.slice(2)
const flagAt = args.indexOf('--root')
const ROOT_ARG = flagAt === -1 ? undefined : args[flagAt + 1]
// Strict, like `lib/seedDemoVault.mjs`'s parseArgs: a typo'd flag must not seed somewhere unexpected.
const unknown = args.filter((a, i) => a !== '--force' && a !== '--root' && i !== flagAt + 1)
if (ROOT_ARG === undefined || ROOT_ARG === '' || ROOT_ARG.startsWith('--') || unknown.length > 0) {
  if (unknown.length > 0) console.error(`unknown argument: ${unknown[0]}`)
  console.error(USAGE)
  process.exit(2)
}
const ROOT = path.resolve(ROOT_ARG)

// ---------------------------------------------------------------- the safety guard
const HOME = os.homedir()
const PRECIOUS = [
  path.join(HOME, 'Documents', 'GitHub', 'yaseen-draw-vault'),
  path.join(HOME, 'Library', 'Application Support', 'Yaseen Draw'),
  HOME,
  '/',
]
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
for (const p of PRECIOUS) {
  // Wiping ROOT must not take any of these with it, and ROOT must not be one of them.
  if (inside(p, ROOT) || (p !== '/' && p !== HOME && inside(ROOT, p))) {
    console.error(`refusing: ${ROOT} is, contains or sits inside ${p}`)
    process.exit(2)
  }
}
if (fs.existsSync(ROOT) && !args.includes('--force')) {
  console.error(`refusing to wipe an existing path: ${ROOT}\npass --force if that is really what you want\n${USAGE}`)
  process.exit(2)
}
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(ROOT, { recursive: true })
// /tmp is a symlink on macOS; the app compares roots as strings, so everything is written real.
const REAL_ROOT = fs.realpathSync(ROOT)
const REMOTE = path.join(REAL_ROOT, 'remote.git')
const VAULT = path.join(REAL_ROOT, 'Board Size Considerations (YAZ-1801)')
const PLAIN = path.join(REAL_ROOT, 'Board Size Considerations (YAZ-1801) - no git')

const GIT = process.env.GIT || (fs.existsSync('/usr/bin/git') ? '/usr/bin/git' : 'git')
const git = (cwd, gitArgs) => execFileSync(GIT, gitArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString().trim()

const MB = 1024 * 1024
const CREATED = Date.UTC(2026, 0, 15, 10, 0)
const UPDATED = Date.UTC(2026, 0, 15, 12, 0)
const BLOCK = { createdAt: CREATED, updatedAt: UPDATED }

// ---------------------------------------------------------------- noisy PNGs
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf)
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
/** The share of each picture's rows given to its colour band. */
const BAND = 0.1
/**
 * An RGB PNG of about `bytes`, mostly noise so it neither compresses nor dedupes: every image is
 * unique, and its size on disk is its size in git. A tinted band across the top keeps each one
 * tellable apart on the canvas.
 */
function noisyPNG(bytes, [r, g, b]) {
  // The band compresses to nothing, so the noise below it is sized to carry the whole target.
  const side = Math.max(16, Math.ceil(Math.sqrt(bytes / 3 / (1 - BAND))))
  const stride = 1 + side * 3
  const raw = Buffer.alloc(stride * side)
  randomFillSync(raw)
  const band = Math.floor(side * BAND)
  for (let y = 0; y < side; y++) {
    raw[y * stride] = 0
    if (y >= band) continue
    for (let x = 0; x < side; x++) {
      const o = y * stride + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(side, 0)
  ihdr.writeUInt32BE(side, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))])
  return { id: fileIdFor(png), mime: 'image/png', bytes: png, side }
}
const COLORS = [
  [230, 73, 128],
  [34, 139, 230],
  [64, 192, 87],
  [250, 176, 5],
  [132, 94, 247],
  [21, 170, 191],
  [253, 126, 20],
  [73, 80, 87],
]
const pics = (count, bytesEach, offset = 0) => Array.from({ length: count }, (_, i) => noisyPNG(bytesEach, COLORS[(i + offset) % COLORS.length]))
/** The decoded bytes whose base64 is `embeddedBytes` long. */
const decodedFor = (embeddedBytes) => Math.floor((embeddedBytes * 3) / 4)

// ---------------------------------------------------------------- scenes
let seq = 1
const rnd = () => 1 + Math.floor(Math.random() * (2 ** 31 - 1))
const common = (i) => ({
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 1,
  strokeStyle: 'solid',
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: fracIndex(i),
  roundness: null,
  seed: rnd(),
  version: 1,
  versionNonce: rnd(),
  isDeleted: false,
  boundElements: null,
  updated: UPDATED,
  link: null,
  locked: false,
})
const text = (i, x, y, str, fontSize = 24) => ({
  id: `t${seq++}`,
  type: 'text',
  x,
  y,
  width: Math.ceil(Math.max(...str.split('\n').map((l) => l.length)) * fontSize * 0.6),
  height: Math.ceil(str.split('\n').length * fontSize * 1.25),
  ...common(i),
  text: str,
  originalText: str,
  fontSize,
  fontFamily: 5,
  textAlign: 'left',
  verticalAlign: 'top',
  autoResize: true,
  lineHeight: 1.25,
  containerId: null,
})
const image = (i, x, y, size, fileId) => ({ id: `i${seq++}`, type: 'image', x, y, width: size, height: size, ...common(i), strokeColor: 'transparent', status: 'saved', fileId, scale: [1, 1], crop: null })

/** A scene with a title line and its pictures in a row, the `yaseendraw` block FIRST (🔒 YAZ-1834). */
function scene(title, pictures, { embed = true, extraFiles = {}, extraElements = [] } = {}) {
  const elements = [text(0, 0, -80, title), ...pictures.map((p, n) => image(n + 1, n * 440, 0, 400, p.id)), ...extraElements]
  const files = {}
  if (embed) for (const p of pictures) files[p.id] = { mimeType: p.mime, id: p.id, dataURL: `data:${p.mime};base64,${p.bytes.toString('base64')}`, created: CREATED }
  Object.assign(files, extraFiles)
  return `${JSON.stringify({ yaseendraw: BLOCK, type: 'excalidraw', version: 2, source: 'yaz-1801-demo', elements, appState: { viewBackgroundColor: '#ffffff', gridSize: 20 }, files }, null, 2)}\n`
}

function write(dir, rel, body) {
  const file = path.join(dir, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  return file
}
const mb = (file) => `${(fs.statSync(file).size / MB).toFixed(1)} MB`
const commit = (message) => {
  git(VAULT, ['add', '-A'])
  git(VAULT, ['commit', '-q', '-m', message])
  console.log(`  commit: ${message}`)
}

// ---------------------------------------------------------------- the "GitHub"
git(REAL_ROOT, ['init', '-q', '--bare', '-b', 'main', REMOTE])

// ---------------------------------------------------------------- the vault
fs.mkdirSync(VAULT, { recursive: true })
git(VAULT, ['init', '-q', '-b', 'main'])
git(VAULT, ['config', 'user.name', 'YAZ-1801 Demo'])
git(VAULT, ['config', 'user.email', 'demo@example.invalid'])
git(VAULT, ['config', 'commit.gpgsign', 'false'])
git(VAULT, ['remote', 'add', 'origin', REMOTE])
write(VAULT, '.yaseendraw/github.json', `${JSON.stringify({ enabled: true })}\n`)

console.log(`vault: ${VAULT}`)

// 1. Modern and lean: pictures already in assets/, `files: {}`.
const clean = pics(2, 200 * 1024, 0)
for (const p of clean) write(VAULT, path.join('assets', assetFileName(p.id, p.mime)), p.bytes)
write(VAULT, 'Small clean board.excalidraw', scene('Small clean board — pictures already in assets/', clean, { embed: false }))

// 2. Legacy, three small pictures — first version (replaced below, so history has an old one).
write(VAULT, 'Legacy - few pictures.excalidraw', scene('Legacy — few pictures (v1)', pics(3, 450 * 1024, 1)))
commit('seed: clean board, legacy v1')
const few = pics(3, 500 * 1024, 3)
write(VAULT, 'Legacy - few pictures.excalidraw', scene('Legacy — few pictures', few))
commit('seed: legacy few pictures v2')

// 3. Heavy legacy (~45 MB of embedded), then one picture swapped: ~7 MB of "old versions".
const heavyPics = pics(6, decodedFor(45 * MB) / 6, 0)
write(VAULT, 'Legacy - heavy (like Team VSL).excalidraw', scene('Legacy — heavy, like Team VSL', heavyPics))
commit('seed: heavy legacy board v1')
heavyPics[5] = noisyPNG(decodedFor(45 * MB) / 6, COLORS[7])
write(VAULT, 'Legacy - heavy (like Team VSL).excalidraw', scene('Legacy — heavy, like Team VSL', heavyPics))
commit('seed: heavy legacy board v2 (one picture replaced)')

// 4. Over GitHub's 50 MB warning, under its 100 MB refusal: amber.
write(VAULT, 'Big but OK - 60 MB.excalidraw', scene('Big but OK — 60 MB (amber: GitHub warns)', pics(5, decodedFor(60 * MB) / 5, 2)))

// 6. Two boards embedding the SAME picture — "Move pictures out" stores it once.
const shared = noisyPNG(600 * 1024, COLORS[4])
write(VAULT, 'Shared picture A.excalidraw', scene('Shared picture A — same picture as B', [shared]))
write(VAULT, 'Shared picture B.excalidraw', scene('Shared picture B — same picture as A', [shared]))

// 7. Nested legacy board.
write(VAULT, 'Folder/Nested legacy.excalidraw', scene('Nested legacy board', pics(2, 400 * 1024, 5)))

// 8. Corrupt: shrink skips it, stats count its size.
write(VAULT, 'Corrupt board.excalidraw', '{ "yaseendraw": { "createdAt": 1768471200000, "updatedAt": 1768478400000 }, "type": "excalidraw", "elements": [ this is not json\n')

// 9. An embedded picture NO element references: shrink drops it and does not move it.
const orphan = noisyPNG(300 * 1024, COLORS[6])
write(
  VAULT,
  'Unreferenced embedded.excalidraw',
  scene('Unreferenced embedded — the picture in files{} is used by nothing', [], {
    extraFiles: { [orphan.id]: { mimeType: orphan.mime, id: orphan.id, dataURL: `data:image/png;base64,${orphan.bytes.toString('base64')}`, created: CREATED } },
  }),
)

// 11. One good picture and one whose dataURL is malformed (placeholder in the app; shrink drops it).
const good = noisyPNG(300 * 1024, COLORS[1])
const brokenId = 'b'.repeat(40)
write(
  VAULT,
  'Malformed picture data.excalidraw',
  scene('Malformed picture data — right-hand picture is broken on purpose', [good], {
    extraElements: [image(9, 440, 0, 400, brokenId)],
    extraFiles: { [brokenId]: { mimeType: 'image/png', id: brokenId, dataURL: 'data:image/png;base64,@@not-base64@@', created: CREATED } },
  }),
)

commit('seed: 60 MB board, shared pictures, nested, corrupt, unreferenced, malformed')
git(VAULT, ['push', '-q', '-u', 'origin', 'main'])
console.log('  pushed to remote.git, upstream set')

// ---------- AFTER the last commit: the two files the first sync must hold back (D3) ----------
// 5. ~110 MB board: over the 95 MiB guard, under the app's 200 MiB read cap.
write(VAULT, 'Too big for GitHub - 110 MB.excalidraw', scene('Too big for GitHub — 110 MB', pics(8, decodedFor(110 * MB) / 8, 1)))
// 10. A 120 MB non-board file: sparse (costs no disk), and the guard is about ANY file.
const video = write(VAULT, 'Big video.mov', '')
fs.truncateSync(video, 120 * MB)

for (const rel of ['Small clean board.excalidraw', 'Legacy - few pictures.excalidraw', 'Legacy - heavy (like Team VSL).excalidraw', 'Big but OK - 60 MB.excalidraw', 'Too big for GitHub - 110 MB.excalidraw', 'Big video.mov']) {
  console.log(`  ${rel.padEnd(44)} ${mb(path.join(VAULT, rel))}`)
}

// ---------------------------------------------------------------- the plain folder (not a repo)
write(PLAIN, 'Plain board.excalidraw', scene('Plain board — this folder is not a git repo', [noisyPNG(200 * 1024, COLORS[2])]))
write(PLAIN, 'Another board.excalidraw', scene('Another board', [], { embed: false }))
console.log(`plain folder: ${PLAIN}`)

// ---------------------------------------------------------------- the app state
const tabs = [path.join(VAULT, 'Legacy - few pictures.excalidraw'), path.join(VAULT, 'Small clean board.excalidraw')]
const state = {
  version: 1,
  settings: { theme: 'system', confirmDelete: true },
  sidebarWidth: 280,
  recents: [
    { path: VAULT, lastOpened: Date.now() },
    { path: PLAIN, lastOpened: Date.now() - 1000 },
  ],
  windows: [
    {
      id: 'w1',
      root: VAULT,
      file: tabs[0],
      tabs,
      sidebarCollapsed: false,
      sidebarLens: 'files',
      focusDirs: [],
      focusFavorites: [],
      bounds: { x: 80, y: 60, width: 1440, height: 900 },
    },
  ],
  folders: { [VAULT]: { lastFile: tabs[0], sortOrder: 'name' } },
}
write(REAL_ROOT, 'yaseendraw.json', `${JSON.stringify(state, null, 2)}\n`)
console.log(`app state: ${path.join(REAL_ROOT, 'yaseendraw.json')}`)
// `--watch`, not `npm run dev`: plain dev never restarts main, so a main-process edit during the demo is silently not running.
console.log(`\nlaunch (from the repo root): cd desktop && YASEEN_DRAW_USER_DATA_DIR="${REAL_ROOT}" npx electron-vite dev --watch`)
