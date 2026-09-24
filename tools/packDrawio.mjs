#!/usr/bin/env node
/**
 * USAGE: node tools/packDrawio.mjs [--war <path>] [--force]
 *
 * Unpacks the pinned draw.io webapp into a gitignored cache (🔒 YAZ-1802 D5), where main's `app://`
 * protocol serves it on the `drawio` host in dev and `electron.vite.config.ts` copies it into
 * `desktop/out/drawio` at build time. The bytes are never committed.
 *
 *   --war    use an already-downloaded `draw.war` instead of fetching it (still size- and
 *            sha256-checked, so a wrong file cannot sneak in)
 *   --force  unpack again even when the cache already holds this release
 *
 * What it does: downloads jgraph/drawio's release asset `draw.war` for the pinned tag (once — the
 * archive is kept beside the unpacked tree), refuses it unless its size and sha256 are exactly the
 * pinned ones, unzips it (a `.war` is a zip) into `desktop/.cache/drawio/<tag>/`, prunes what the
 * editor, the picture page and the share viewer never load (~155 MB → ~47 MB,
 * `tools/lib/drawioPack.mjs`), then lays OUR files over it: `desktop/drawio-overlay/` (the
 * `PreConfig.js` / `PostConfig.js` config hooks draw.io's `bootstrap.js` loads off its own
 * domains, the hover-preview page `yaseen-render.html`, and `LICENSE-drawio.txt` — draw.io's
 * Apache-2.0 licence, which the war itself does not carry) and the five font families the editor
 * offers first, copied from the Excalidraw package.
 *
 * IDEMPOTENT: the unpack is skipped when `<tag>/.yaseen-pack.json` says this exact archive is
 * already there under the current prune rules; the overlay and fonts are re-laid on EVERY run, so
 * an edit to an overlay file lands with the next `npm run dev`. The unpack goes to a temp folder
 * that is renamed into place, so an interrupted run never leaves half a webapp behind
 * (`tools/lib/drawioPack.mjs`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isUnpacked, layOverlay, unpackWebapp, verifyArchive } from './lib/drawioPack.mjs'

/** 🔒 YAZ-1802 D5: the pinned release. Keep in step with `DRAWIO_TAG` in `desktop/src/main/drawio/assets.ts` (`packDrawio.test.mjs` pins the pair). */
export const DRAWIO_TAG = 'v31.5.2'
export const WAR_URL = `https://github.com/jgraph/drawio/releases/download/${DRAWIO_TAG}/draw.war`
export const WAR_BYTES = 53_946_815
/** Computed on the first download of the v31.5.2 asset (2026-09-23); a different archive under the same URL is refused. */
export const WAR_SHA256 = 'abd58ad15baef57f43acb79a56350ba8900a8b6fabe94391d8906148fe64e264'
const PIN = { tag: DRAWIO_TAG, bytes: WAR_BYTES, sha256: WAR_SHA256 }

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const CACHE_ROOT = join(repo, 'desktop', '.cache', 'drawio')
const WEBAPP_DIR = join(CACHE_ROOT, DRAWIO_TAG)
const OVERLAY_DIR = join(repo, 'desktop', 'drawio-overlay')

/** The archive's bytes, verified: `--war`, else the cached copy, else a fresh download (then cached). */
async function warBytes(warArg) {
  const cached = join(CACHE_ROOT, `draw-${DRAWIO_TAG}.war`)
  let bytes
  if (warArg) bytes = readFileSync(resolve(warArg))
  else if (existsSync(cached)) bytes = readFileSync(cached)
  else {
    console.log(`[drawio] downloading ${WAR_URL} (${(WAR_BYTES / 1e6).toFixed(1)} MB)…`)
    const res = await fetch(WAR_URL)
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${WAR_URL}`)
    bytes = Buffer.from(await res.arrayBuffer())
  }
  verifyArchive(bytes, PIN)
  if (!existsSync(cached)) {
    mkdirSync(CACHE_ROOT, { recursive: true })
    writeFileSync(cached, bytes)
  }
  return bytes
}

/** The Excalidraw package's `fonts/` tree, wherever npm hoisted it (the `excalidrawFontsDir()` rule). */
function excalidrawFontsDir() {
  for (const base of [repo, join(repo, 'client')]) {
    const dir = join(base, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
    if (existsSync(dir)) return dir
  }
  throw new Error('@excalidraw/excalidraw fonts not found — run `npm install`')
}

async function main() {
  const args = process.argv.slice(2)
  const warIdx = args.indexOf('--war')
  const warArg = warIdx === -1 ? undefined : args[warIdx + 1]
  if (args.includes('--force') || !isUnpacked(WEBAPP_DIR, PIN)) {
    const written = unpackWebapp(await warBytes(warArg), WEBAPP_DIR, PIN)
    console.log(`[drawio] unpacked ${written} files into ${WEBAPP_DIR}`)
  }
  layOverlay(WEBAPP_DIR, OVERLAY_DIR, excalidrawFontsDir())
  console.log(`[drawio] ${DRAWIO_TAG} ready at ${WEBAPP_DIR}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`[drawio] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
