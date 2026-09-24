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

/** Written into the unpacked webapp: which archive it came from, so an unchanged pin is not unpacked twice. */
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

/** True when `dir` already holds this exact pinned archive, unpacked (its stamp says so). */
export function isUnpacked(dir, pin) {
  try {
    const stamp = JSON.parse(readFileSync(join(dir, STAMP), 'utf8'))
    return stamp.tag === pin.tag && stamp.sha256 === pin.sha256
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
    writeFileSync(join(tmp, STAMP), `${JSON.stringify({ tag: pin.tag, sha256: pin.sha256 }, null, 2)}\n`)
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
 * What the unpacked webapp does NOT need inside an offline, embed-only iframe (🔒 YAZ-1802 D5):
 * the servlet container's `WEB-INF` / `META-INF`, source maps, the PWA service worker (we pass
 * `pwa=0`), and the cloud-storage pages and SDKs (`db=0&od=0&gh=0&gl=0`). Everything else stays —
 * the sidebar's stencils and templates are loaded on demand from this same origin.
 */
const PRUNED_PREFIXES = ['WEB-INF/', 'META-INF/', 'connect/', 'js/dropbox/', 'js/onedrive/']
const PRUNED_FILES = new Set(['service-worker.js', 'dropbox.html', 'github.html', 'gitlab.html', 'onedrive3.html', 'teams.html', 'monday-app-association.json'])

export function isPrunedEntry(name) {
  if (PRUNED_PREFIXES.some((prefix) => name.startsWith(prefix))) return true
  if (name.endsWith('.map')) return true
  if (PRUNED_FILES.has(name)) return true
  return /^workbox-[0-9a-f]+\.js$/.test(name)
}

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
