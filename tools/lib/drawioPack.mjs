/**
 * The work of `tools/packDrawio.mjs` (🔒 YAZ-1802 D5): the pin check, the zip reader that unpacks
 * jgraph's `draw.war`, the prune rule, the idempotency stamp, and laying our overlay and fonts on
 * top. No network and no fixed paths here — every folder is an argument — so
 * `tools/packDrawio.test.mjs` drives it against temp folders.
 */
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/** Written into the unpacked webapp: which archive it came from and under which prune, so an unchanged pack is not unpacked twice. */
const STAMP = '.yaseen-pack.json'

/**
 * Refuses an archive that is not exactly the pinned one (`{ tag, bytes, sha256 }`), naming what it
 * got and what it wanted — a wrong download or a re-published asset fails the build loudly.
 *
 * @param {Buffer} archive
 * @param {{ tag: string, bytes: number, sha256: string }} pin
 */
export function verifyArchive(archive, pin) {
  if (archive.length !== pin.bytes) throw new Error(`draw.war is ${archive.length} bytes, expected ${pin.bytes} — refusing it`)
  const digest = createHash('sha256').update(archive).digest('hex')
  if (digest !== pin.sha256) throw new Error(`draw.war sha256 ${digest} does not match the pinned ${pin.sha256} — refusing it`)
}

/** True when `dir` already holds this exact pinned archive, unpacked under today's prune (its stamp says so). */
export function isUnpacked(dir, pin) {
  try {
    const stamp = JSON.parse(readFileSync(join(dir, STAMP), 'utf8'))
    return stamp.tag === pin.tag && stamp.sha256 === pin.sha256 && stamp.prune === PRUNE_ID
  } catch {
    return false
  }
}

/**
 * Unzips `archive` into `dir`, pruned and stamped. The files go to a temp folder beside `dir` that
 * is renamed into place only when complete, so an interrupted or refused run never leaves half a
 * webapp — and a previous release's files never linger under a new one.
 *
 * @returns {number} the files written
 */
export function unpackWebapp(archive, dir, pin) {
  const tmp = `${dir}.tmp-${process.pid}`
  rmSync(tmp, { recursive: true, force: true })
  let written = 0
  try {
    for (const entry of readZipEntries(archive)) {
      if (!isSafeEntryName(entry.name)) throw new Error(`unsafe entry name in draw.war: ${entry.name}`)
      if (entry.isDir || isPrunedEntry(entry.name)) continue
      const to = join(tmp, entry.name)
      mkdirSync(dirname(to), { recursive: true })
      writeFileSync(to, entry.data())
      written++
    }
    writeFileSync(join(tmp, STAMP), `${JSON.stringify({ tag: pin.tag, sha256: pin.sha256, prune: PRUNE_ID }, null, 2)}\n`)
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true })
    throw err
  }
  rmSync(dir, { recursive: true, force: true })
  renameSync(tmp, dir)
  return written
}

/**
 * Our files over draw.io's (🔒 YAZ-1802 D17), on EVERY run so an overlay edit lands with the next
 * `npm run dev`: `overlayDir` verbatim (the `PreConfig.js` / `PostConfig.js` hooks replace draw.io's
 * empty stubs, the preview page, draw.io's own Apache-2.0 licence text), then the font families of
 * `DRAWIO_FONT_FAMILIES` copied from `fontsSource` into `yaseen-fonts/` beside their sheet.
 */
export function layOverlay(dir, overlayDir, fontsSource) {
  cpSync(overlayDir, dir, { recursive: true })
  const target = join(dir, FONTS_DIR)
  rmSync(target, { recursive: true, force: true })
  const families = DRAWIO_FONT_FAMILIES.map(([folder, family]) => {
    const files = readdirSync(join(fontsSource, folder)).filter((f) => f.endsWith('.woff2'))
    mkdirSync(join(target, folder), { recursive: true })
    for (const f of files) cpSync(join(fontsSource, folder, f), join(target, folder, f))
    return { family, folder, files }
  })
  writeFileSync(join(target, 'fonts.css'), fontFaceCss(families, FONTS_URL))
}

/**
 * Every entry of a zip archive (a `.war` is one), read from its central directory. Stored (0) and
 * deflated (8) entries only — the two methods jgraph's build writes — and no zip64: `draw.war` is
 * 3 649 entries and ~150 MB unpacked, far below either limit, and a future release that crosses
 * one fails loudly here instead of unpacking half a webapp.
 *
 * @param {Buffer} zip
 * @returns {Array<{ name: string, isDir: boolean, data: () => Buffer }>}
 */
export function readZipEntries(zip) {
  const EOCD = 0x06054b50
  let end = -1
  // The end record sits in the last 22 bytes plus an optional comment of at most 64 KiB.
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      end = i
      break
    }
  }
  if (end === -1) throw new Error('not a zip archive (no end-of-central-directory record)')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  if (count === 0xffff || at === 0xffffffff) throw new Error('zip64 archives are not supported')
  const entries = []
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`bad central directory entry #${i}`)
    const method = zip.readUInt16LE(at + 10)
    const compressed = zip.readUInt32LE(at + 20)
    const nameLen = zip.readUInt16LE(at + 28)
    const extraLen = zip.readUInt16LE(at + 30)
    const commentLen = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    at += 46 + nameLen + extraLen + commentLen
    const data = () => {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${name}`)
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const raw = zip.subarray(start, start + compressed)
      if (method === 0) return Buffer.from(raw)
      if (method === 8) return inflateRawSync(raw)
      throw new Error(`unsupported compression method ${method} for ${name}`)
    }
    entries.push({ name, isDir: name.endsWith('/'), data })
  }
  return entries
}

/**
 * An entry name that can never be written outside the target folder: no absolute path, no `..`
 * segment, no backslash. A `.war` is someone else's archive, so its names are checked like input.
 */
export function isSafeEntryName(name) {
  if (name === '' || name.startsWith('/') || name.includes('\\') || name.includes('\0')) return false
  return !name.split('/').some((segment) => segment === '..')
}

/**
 * 🔒 YAZ-1802 D5 (YAZ-1973): what the app's three draw.io pages never load, so neither the app nor
 * the share viewer ships it — `[rule, why]`, a DENY list because almost everything else is loaded
 * lazily by some diagram. The pages: the editor (`index.html` in embed mode with `offline=1`,
 * `lang=en`, `plugins=0`, `pwa=0` — `drawioFrameUrl`), our picture page `yaseen-render.html`, and
 * the share viewer (both `viewer-static.min.js`). Every rule was checked against v31.5.2's own
 * loaders and a logged pass over the seeded vault, the bake-off diagrams, a diagram with one shape
 * from every stencil set and library, math, Mermaid, PlantUML and the template dialog (the request
 * set is pinned in `packDrawio.test.mjs`). A bump re-checks it with the dev 404 log (`serveDrawio`).
 *
 * KEPT on purpose, though big: `js/stencils.min.js` (all 204 stencil sets, loaded at editor start;
 * the viewer pages load it too, which is why `stencils/` can go), `math4/` (the editor loads MathJax
 * at start), `templates/` (Insert › Template works offline), `img/` (library icons a diagram names
 * by path), `js/extensions.min.js` (loaded at start; Mermaid, ELK and libavoid live in it), and
 * `js/libavoid-js/` (the LGPL-2.1 source of the router `extensions.min.js` bundles, with its licence).
 */
const PRUNED = [
  [/^(WEB-INF|META-INF)\//, 'the servlet container (the online features’ Java)'],
  [/\.map$/, 'source maps'],
  [/^(service-worker|workbox-[0-9a-f]+)\.js$/, 'the PWA service worker (pwa=0)'],
  [/^(connect|plugins)\//, 'Atlassian Connect pages, and plugins (plugins=0)'],
  [/^(dropbox|github|gitlab|onedrive3|teams)\.html$|^monday-app-association\.json$/, 'cloud-storage callback pages'],
  [/^js\/(dropbox|onedrive|jquery|simplepeer)\//, 'cloud SDKs, Trello’s jQuery and realtime collaboration — network only'],
  [/^js\/integrate\.min\.js$/, 'the Confluence / Jira integration bundle — no page loads it'],
  [/^js\/(diagramly|grapheditor|orgchart|elk|mermaid|jszip|deflate|sanitizer|cryptojs|rough|freehand|spin)\//, 'unminified sources, loaded only with dev=1 — app.min.js, extensions.min.js and orgchart.min.js carry them built'],
  [/^mxgraph\/(src\/|mxClient\.js$)/, 'mxGraph sources — app.min.js and viewer-static.min.js carry them built'],
  [/^js\/(viewer\.min|embed\.dev|export|export-init|clear|vsdxImporter)\.js$|^(export3|clear|vsdxImporter)\.html$|^export-fonts\.css$/, 'the lightbox viewer, and the export-server, cache-clearing and Confluence importer pages'],
  [/^resources\/dia_[^/]+\.txt$/, 'the UI in other languages (lang=en; dia.txt is English)'],
  [/^images\/sidebar-[^/]+\.png$/, 'More Shapes’ big previews — offline it is the compact dialog, which has none'],
  [/^stencils\//, 'the stencil sets as separate files — js/stencils.min.js carries every one'],
  [/^shapes\//, 'the library shapes’ code as separate files — js/shapes-14-6-5.min.js and viewer-static.min.js carry it'],
]

/** A `LICENSE` is never pruned, whatever folder it sits in: the terms of what ships, bundled or not. */
const LICENCE = /(^|\/)LICENSE$/

export function isPrunedEntry(name) {
  return !LICENCE.test(name) && PRUNED.some(([rule]) => rule.test(name))
}

/** Changes with any rule, so the stamp sends an already-unpacked release through a changed prune. */
export const PRUNE_ID = createHash('sha256').update([LICENCE, ...PRUNED.map(([rule]) => rule)].map(String).join('\n')).digest('hex').slice(0, 12)

/** Where the copied fonts sit inside the webapp, and the absolute URL the editor reaches them at. */
const FONTS_DIR = 'yaseen-fonts'
const FONTS_URL = `app://drawio/${FONTS_DIR}`

/**
 * The font families the diagram editor offers first (YAZ-1802 D12), as they sit in the Excalidraw
 * package's own `fonts/` tree: `[folder, css family]`. The woff2 files are copied, never fetched.
 */
const DRAWIO_FONT_FAMILIES = [
  ['Assistant', 'Assistant'],
  ['Inter', 'Inter'],
  ['Roboto', 'Roboto'],
  ['IBMPlexMono', 'IBM Plex Mono'],
  ['LiberationSerif', 'Liberation Serif'],
]

/** `Inter-Bold.woff2` → 700; Medium 500, SemiBold 600; anything else is the regular weight. */
export function fontWeightOf(file) {
  if (/-Bold\b/i.test(file)) return 700
  if (/-SemiBold\b/i.test(file)) return 600
  if (/-Medium\b/i.test(file)) return 500
  return 400
}

/**
 * The `@font-face` sheet for the copied files, every URL absolute on the drawio origin so it means
 * the same thing wherever draw.io injects it (the editor's `fontCss` config, an SVG export).
 *
 * @param {Array<{ family: string, folder: string, files: string[] }>} families
 * @param {string} baseUrl e.g. `app://drawio/yaseen-fonts`
 */
export function fontFaceCss(families, baseUrl) {
  const rules = []
  for (const { family, folder, files } of families) {
    for (const file of [...files].sort()) {
      rules.push(`@font-face { font-family: '${family}'; src: url('${baseUrl}/${folder}/${file}') format('woff2'); font-weight: ${fontWeightOf(file)}; font-style: normal; font-display: swap; }`)
    }
  }
  return `${rules.join('\n')}\n`
}
