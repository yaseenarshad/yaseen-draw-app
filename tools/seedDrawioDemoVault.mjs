#!/usr/bin/env node
/**
 * USAGE: node tools/seedDrawioDemoVault.mjs --vault <dir> [--profile <dir>] [--force]
 *
 * The vault draw.io support is demoed against (YAZ-1802). Every file name says the case it covers:
 * clean teaching diagrams and two slide decks (the bake-off files, when they are on this Mac), a
 * COMPRESSED page, three pages, empty / corrupt / not-draw.io files, `UPPERCASE.DRAWIO`, an
 * `image.drawio.svg` that must list but never open in-app, an embedded data-URI picture, a REMOTE
 * picture the CSP must block, ~2 000 cells, unicode and emoji names in nested folders, a diagram
 * with no `yaseendraw-*` dates, and — beside the draw.io files — ordinary Excalidraw boards that
 * must still work exactly as before. `00 READ ME` (an Excalidraw board) lists what to try.
 *
 * SYNC: the vault is a git repo with a bare origin at `<vault> (origin).git` and "Sam's" clone at
 * `<vault> (Sam)` (the `seedMergeDemoVault.mjs` idiom). Sam changed and pushed two diagrams (one
 * spelled `.DRAWIO`); the same diagrams are changed, unsynced, here — so the app's first sync on open keeps BOTH copies
 * (🔒 YAZ-1802 D8: no diagram merge, a `(conflict, <date>)` copy beside it).
 *
 * `--vault` IS REQUIRED AND THE PATH IS WIPED (with its origin and Sam's clone) — the
 * `seedDemoVault.mjs` rule; an existing path is refused unless `--force`. `--profile` also writes
 * an isolated Electron profile (`yaseendraw.json`) whose one window is already on the vault
 * (LAUNCH.md "Behaviour checks"), so no dialog is needed and the real profile is never read.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const USAGE = 'usage: node tools/seedDrawioDemoVault.mjs --vault <dir> [--profile <dir>] [--force]'
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : (args[i + 1] ?? '')
}
const VAULT = flag('--vault') && path.resolve(flag('--vault'))
const PROFILE = flag('--profile') && path.resolve(flag('--profile'))
if (!VAULT) {
  console.error(USAGE)
  process.exit(2)
}
const ORIGIN = `${VAULT} (origin).git`
const SAM = `${VAULT} (Sam)`
for (const dir of [VAULT, ORIGIN, SAM, PROFILE].filter(Boolean)) {
  if (fs.existsSync(dir) && !args.includes('--force')) {
    console.error(`refusing to wipe an existing folder: ${dir}\npass --force if that is really what you want\n${USAGE}`)
    process.exit(2)
  }
  fs.rmSync(dir, { recursive: true, force: true })
}
fs.mkdirSync(VAULT, { recursive: true })

function write(rel, content, dir = VAULT) {
  const file = path.join(dir, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

// ---------------------------------------------------------------- PNG (node built-ins only)
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(w, h, pixel) {
  const stride = 1 + w * 3
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * stride + 1 + x * 3)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---------------------------------------------------------------- draw.io documents
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Our two dates on the root, FIRST (🔒 YAZ-1802 D7) — as main would have written them. */
const stampAttrs = (createdDaysAgo, updatedDaysAgo = createdDaysAgo) => ` yaseendraw-created="${NOW - createdDaysAgo * DAY}" yaseendraw-updated="${NOW - updatedDaysAgo * DAY}"`
const stampXml = (xml, created, updated) => xml.replace(/<mxfile(?=[\s>])/, `<mxfile${stampAttrs(created, updated)}`)

let cellId = 0
const vertex = (value, x, y, w, h, style = 'rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;fillColor=#dae8fc;strokeColor=#6c8ebf;') =>
  `        <mxCell id="v${++cellId}" value="${esc(value)}" style="${esc(style)}" vertex="1" parent="1">\n          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" />\n        </mxCell>\n`
const edge = (source, target, style = 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeWidth=2;endArrow=block;') =>
  `        <mxCell id="e${++cellId}" style="${esc(style)}" edge="1" parent="1" source="${source}" target="${target}">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>\n`
const model = (cells, attrs = 'grid="0" page="0"') => `<mxGraphModel ${attrs} gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" pageScale="1" pageWidth="1100" pageHeight="850" math="0" shadow="0">\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n${cells.join('')}      </root>\n    </mxGraphModel>`
const page = (name, cells, id = name.toLowerCase().replace(/\W+/g, '-')) => `  <diagram id="${id}" name="${esc(name)}">\n    ${model(cells)}\n  </diagram>\n`
const mxfile = (pages, attrs = '') => `<mxfile${attrs} host="yaz-1802-demo">\n${pages.join('')}</mxfile>\n`
const diagram = (rel, pages, days = [3, 1]) => write(`${rel}.drawio`, mxfile(pages, stampAttrs(...days)))

/** Three boxes in a row, joined by arrows — the smallest diagram that is plainly a diagram. */
function flow(title, labels, x0 = 40, y0 = 80) {
  const cells = [vertex(title, x0, y0 - 60, 520, 40, 'text;html=1;fontSize=22;fontStyle=1;align=left;verticalAlign=middle;')]
  const ids = []
  labels.forEach((label, i) => {
    cells.push(vertex(label, x0 + i * 200, y0, 150, 70))
    ids.push(`v${cellId}`)
  })
  for (let i = 1; i < ids.length; i++) cells.push(edge(ids[i - 1], ids[i]))
  return cells
}

// ---------------------------------------------------------------- Excalidraw boards (still work)
let n = 0
const seed = () => 1 + Math.floor(Math.random() * 2 ** 30)
const base = (extra = {}) => ({
  id: `x-${(n++).toString(36)}`, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
  strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, index: `a${String(n).padStart(5, '0')}`,
  roundness: null, seed: seed(), version: 1, versionNonce: seed(), isDeleted: false, boundElements: null,
  updated: 1, link: null, locked: false, ...extra,
})
const rect = (x, y, w, h, bg = '#a5d8ff') => ({ ...base({ roundness: { type: 3 }, backgroundColor: bg }), type: 'rectangle', x, y, width: w, height: h })
const ellipse = (x, y, w, h, bg = '#ffc9c9') => ({ ...base({ backgroundColor: bg }), type: 'ellipse', x, y, width: w, height: h })
const arrow = (x, y, dx, dy) => ({ ...base({ roundness: { type: 2 } }), type: 'arrow', x, y, width: Math.abs(dx), height: Math.abs(dy), points: [[0, 0], [dx, dy]], startArrowhead: null, endArrowhead: 'arrow', startBinding: null, endBinding: null, elbowed: false })
const text = (x, y, str, size = 20) => {
  const lines = str.split('\n')
  return { ...base({ strokeWidth: 1, roughness: 0 }), type: 'text', x, y, width: Math.ceil(Math.max(...lines.map((l) => l.length)) * size * 0.55), height: Math.ceil(lines.length * size * 1.25), text: str, originalText: str, fontSize: size, fontFamily: 5, textAlign: 'left', verticalAlign: 'top', autoResize: true, lineHeight: 1.25, containerId: null }
}
const frame = (x, y, w, h, name) => ({ ...base({ roughness: 0, strokeWidth: 1 }), type: 'frame', x, y, width: w, height: h, name })
const board = (rel, elements, createdDaysAgo = 5) =>
  write(`${rel}.excalidraw`, `${JSON.stringify({ yaseendraw: { createdAt: NOW - createdDaysAgo * DAY, updatedAt: NOW - DAY }, type: 'excalidraw', version: 2, source: 'yaz-1802-demo', elements, appState: { viewBackgroundColor: '#ffffff', gridSize: 20 }, files: {} }, null, 2)}\n`)

// ---------------------------------------------------------------- 00 — the scenario list
board('00 READ ME', [
  text(0, 0, [
    'YAZ-1802 draw.io support — demo vault',
    '',
    'OPEN + EDIT',
    ' 1. "Teaching — 1 find the bottleneck" opens in draw.io, page view off, theme = app theme.',
    ' 2. Move a box → chip says Unsaved → Saved (~0.5 s). Reopen: the change is there.',
    ' 3. ⌘S saves at once. Quit with an unsaved edit → it is on disk after relaunch.',
    ' 4. Settings → Appearance → Dark/Light → the open diagram flips live, no reload.',
    ' 5. Plain scroll pans; ⌘/ctrl + scroll and pinch zoom.',
    ' 6. Select a shape: r/g/u/y/o… colour it, t = transparent, 1…0 = size; nothing selected: r/o/a/d/t/w/p are tools.',
    'CREATE + NAMES',
    ' 7. Right-click blank space → "New draw.io diagram" → Untitled.drawio opens with rename focused.',
    ' 8. Names hide .drawio in the tree, tabs and title. Rename to "x.excalidraw" keeps it a .drawio.',
    ' 9. Copy / paste a diagram → "… copy.drawio". Info shows its dates; sort by Created uses them.',
    'FILES THAT MUST BEHAVE',
    '10. Compressed, Multi-page, UPPERCASE.DRAWIO, Ünïcödé 📊/… all open. Multi-page keeps 3 pages.',
    '11. Broken — empty / corrupt / not mxfile → a readable error pane, file untouched.',
    '12. image.drawio.svg lists but opens in the default app, not in Yaseen Draw.',
    '13. Remote image → the picture stays blank (offline CSP); Embedded image shows.',
    '14. Big — 2000 cells opens and pans.  No dates → Info says not stamped until its first save.',
    'OUTSIDE CHANGES + SYNC',
    '15. Open "Edit me", run in a terminal:  sed -i "" "s/Edit me/Edited outside/" "<file>" → it reloads.',
    '16. Edit it in the app, then change it outside → Reload / Keep mine bar.',
    '17. Sync chip: the first sync keeps BOTH copies of "Sync — changed on both computers" (conflict copy) and of "SYNC — UPPERCASE" (its copy ends .DRAWIO).',
    '18. Hover any diagram → its preview (page 1) shows; Excalidraw boards still preview too.',
  ].join('\n'), 20),
], 30)

board('Excalidraw — simple shapes still work', [text(0, -60, 'An ordinary Excalidraw board', 28), rect(0, 0, 220, 120), ellipse(320, 0, 180, 120), arrow(220, 60, 100, 0)], 20)
board('Excalidraw — frames and text', [frame(0, 0, 500, 320, 'Frame A'), rect(40, 60, 200, 100, '#b2f2bb'), text(40, 200, 'inside a frame', 24)], 10)
board('Excalidraw — edit me to prove saves still work', [text(0, 0, 'Draw here: the Excalidraw editor must be untouched by YAZ-1802', 22)], 2)

// ---------------------------------------------------------------- clean teaching diagrams (the bake-off)
const BAKEOFF = path.join(os.homedir(), 'Downloads', 'excalidraw-vs-drawio-bakeoff')
const bakeoff = [
  ['bakeoff-5/1-bottleneck.drawio', 'Teaching — 1 find the bottleneck', 14],
  ['bakeoff-5/2-ai-lanes.drawio', 'Teaching — 2 AI lanes', 13],
  ['bakeoff-5/3-owner-hub.drawio', 'Teaching — 3 owner hub', 12],
  ['bakeoff-6/deck-run-a.drawio', 'Deck — run A', 9],
  ['bakeoff-6/deck-run-b.drawio', 'Deck — run B', 8],
]
for (const [src, name, days] of bakeoff) {
  const from = path.join(BAKEOFF, src)
  if (fs.existsSync(from)) write(`${name}.drawio`, stampXml(fs.readFileSync(from, 'utf8'), days, days - 1))
  else diagram(name, [page('Page-1', flow(`${name} (bake-off file not on this Mac — stand-in)`, ['Leads', 'Calls', 'Sales', 'Delivery']))], [days, days - 1])
}

// ---------------------------------------------------------------- formats
const compressed = model(flow('A compressed page — draw.io inflates it; the first save writes it back plain', ['Deflate', 'Base64', 'Plain on save']))
const deflated = zlib.deflateRawSync(Buffer.from(encodeURIComponent(compressed), 'utf8')).toString('base64')
write('Compressed — deflate+base64 page (opens; first save writes it plain).drawio', `<mxfile${stampAttrs(7, 6)} host="yaz-1802-demo" compressed="true">\n  <diagram id="zipped" name="Zipped page">${deflated}</diagram>\n</mxfile>\n`)
diagram('Multi-page — three pages (preview shows page 1)', [
  page('Page 1 — Plan', flow('Page 1 of 3 — the plan', ['Idea', 'Plan', 'Build'])),
  page('Page 2 — Build', flow('Page 2 of 3 — the build', ['Code', 'Test', 'Ship'])),
  page('Page 3 — Review', flow('Page 3 of 3 — the review', ['Measure', 'Learn', 'Repeat'])),
], [6, 5])
diagram('Edit me — outside-change and autosave test', [page('Page-1', flow('Edit me', ['Change', 'me', 'outside']))], [4, 3])
write('UPPERCASE.DRAWIO', mxfile([page('Page-1', flow('UPPERCASE.DRAWIO — the extension is case-insensitive', ['Opens', 'In', 'App']))], stampAttrs(5, 4)))
write('No dates — written by draw.io elsewhere (dates fall back to mtime).drawio', mxfile([page('Page-1', flow('No yaseendraw-* attributes on <mxfile>', ['Info: not stamped', 'First save', 'Stamps it']))]))

// ---------------------------------------------------------------- broken files (readable error, never overwritten)
write('Broken — empty 0-byte file.drawio', '')
write('Broken — corrupt, not XML.drawio', 'this is not xml { "nor": "json" }\n')
write('Broken — XML but not an mxfile.drawio', '<?xml version="1.0"?>\n<note><to>Tove</to><body>Valid XML, but not a draw.io diagram</body></note>\n')

// ---------------------------------------------------------------- pictures
const pictureB64 = png(160, 100, (x, y) => [Math.round((x / 160) * 255), Math.round((y / 100) * 200), 180]).toString('base64')
diagram('Embedded image — data URI picture (must show)', [page('Page-1', [
  vertex('A picture stored INSIDE the diagram as a data URI', 40, 20, 460, 40, 'text;html=1;fontSize=18;align=left;'),
  vertex('', 40, 80, 320, 200, `shape=image;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=0;aspect=fixed;image=data:image/png,${pictureB64};`),
])], [3, 2])
diagram('Remote image — must NOT load (offline CSP blocks it)', [page('Page-1', [
  vertex('This picture points at the internet. The editor is offline: the box must stay blank.', 40, 20, 620, 40, 'text;html=1;fontSize=18;align=left;'),
  vertex('', 40, 80, 320, 200, 'shape=image;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=0;aspect=fixed;image=https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png;'),
])], [3, 2])
// A picture with a diagram inside: lists in the tree, never opens in-app (🔒 YAZ-1802 D3: `.drawio` only).
const svgContent = esc(mxfile([page('Page-1', flow('Inside an SVG', ['Not', 'Opened']))]))
write('image.drawio.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120" content="${svgContent}"><rect x="10" y="10" width="300" height="100" rx="12" fill="#dae8fc" stroke="#6c8ebf" stroke-width="2"/><text x="160" y="66" font-family="Helvetica" font-size="16" text-anchor="middle">image.drawio.svg — opens in the default app</text></svg>\n`)

// ---------------------------------------------------------------- big
{
  const cells = [vertex('Big — 1 500 boxes and 500 arrows (speed test)', 0, -80, 800, 50, 'text;html=1;fontSize=28;fontStyle=1;align=left;')]
  const ids = []
  for (let i = 0; i < 1500; i++) {
    const fill = ['#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#d0bfff', '#99e9f2'][i % 6]
    cells.push(vertex(`#${i + 1}`, (i % 50) * 130, Math.floor(i / 50) * 90, 100, 50, `rounded=1;whiteSpace=wrap;html=1;fillColor=${fill};`))
    ids.push(`v${cellId}`)
  }
  for (let i = 0; i < 500; i++) cells.push(edge(ids[i * 3], ids[i * 3 + 1]))
  diagram('Big — 2000 cells (speed test)', [page('Page-1', cells)], [2, 1])
}

// ---------------------------------------------------------------- unicode + emoji, nested
diagram('Ünïcödé 📊/Nested 🌍/Diagram with émoji ✨ and 日本語', [page('ページ 1', flow('ユニコード ✨ — nested two folders deep', ['Ünï', 'cödé', '📊']))], [1, 0])
diagram('Ünïcödé 📊/Another — café ☕', [page('Page-1', flow('A second diagram in a unicode folder', ['café', 'naïve', 'jalapeño']))], [1, 0])

// ---------------------------------------------------------------- sync: changed on both computers
const SYNC = 'Sync — changed on both computers (keep-both conflict)'
// 🔒 YAZ-1802 D17: the merge rule and keep-both must hold whatever the extension's case.
const SYNC_UP = 'SYNC — UPPERCASE changed on both computers'
const syncFiles = [`${SYNC}.drawio`, `${SYNC_UP}.DRAWIO`]
const syncDoc = (a, b, c, days) => mxfile([page('Page-1', [
  vertex('Both computers changed this diagram — the first sync keeps BOTH copies', 40, 0, 700, 40, 'text;html=1;fontSize=18;align=left;'),
  vertex(a, 40, 80, 180, 70), vertex(b, 280, 80, 180, 70), vertex(c, 520, 80, 180, 70),
])], stampAttrs(...days))
cellId = 9000
for (const rel of syncFiles) {
  cellId = 9000
  write(rel, syncDoc('Plan', 'Build', 'Ship', [3, 3]))
}
write('.yaseendraw/github.json', `${JSON.stringify({ enabled: true }, null, 2)}\n`)

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
const identity = (cwd, name) => {
  git(cwd, 'config', 'user.name', name)
  git(cwd, 'config', 'user.email', `${name.toLowerCase()}@example.invalid`)
  git(cwd, 'config', 'commit.gpgsign', 'false')
}
execFileSync('git', ['init', '--bare', '-b', 'main', ORIGIN], { stdio: 'ignore' })
git(VAULT, 'init', '-b', 'main')
identity(VAULT, 'You')
git(VAULT, 'add', '-A')
git(VAULT, 'commit', '-m', 'Start the YAZ-1802 demo')
git(VAULT, 'remote', 'add', 'origin', ORIGIN)
git(VAULT, 'push', '-u', 'origin', 'main')

execFileSync('git', ['clone', ORIGIN, SAM], { stdio: 'ignore' })
identity(SAM, 'Sam')
for (const rel of syncFiles) {
  cellId = 9000
  write(rel, syncDoc('Plan — Sam renamed this', 'Build', 'Ship', [3, 1]), SAM)
}
git(SAM, 'commit', '-am', 'sync: Sam edits the diagrams')
git(SAM, 'push')

// Yours, not yet synced: the same diagrams, a different box.
for (const rel of syncFiles) {
  cellId = 9000
  write(rel, syncDoc('Plan', 'Build', 'Ship — you renamed this', [3, 0]))
}

console.log(`vault:  ${VAULT}\norigin: ${ORIGIN}\nSam:    ${SAM}`)

// ---------------------------------------------------------------- isolated profile (LAUNCH.md recipe)
if (PROFILE) {
  fs.mkdirSync(PROFILE, { recursive: true })
  const window = { id: 'w1', root: VAULT, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusFavorites: [], bounds: { x: 60, y: 60, width: 1440, height: 900 } }
  const state = { version: 1, settings: { theme: 'system', confirmDelete: true }, sidebarWidth: 300, recents: [{ path: VAULT, lastOpened: Date.now() }], windows: [window], folders: {} }
  fs.writeFileSync(path.join(PROFILE, 'yaseendraw.json'), `${JSON.stringify(state, null, 2)}\n`)
  console.log(`profile ${PROFILE}`)
  console.log(`launch: cd desktop && YASEEN_DRAW_USER_DATA_DIR="${PROFILE}" npm run dev`)
}
