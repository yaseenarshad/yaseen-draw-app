#!/usr/bin/env node
/**
 * USAGE: node tools/buildShareViewer.mjs
 *
 * Builds the share viewer's static assets (YAZ-1799) into `share/dist/assets/`:
 *   viewer.js   — share/viewer/entry.js + React + the app's own vendored Excalidraw, one ES module
 *   viewer.css  — Excalidraw's stylesheet
 *   fonts/…     — Excalidraw's font files (a scene with text fetches them from /assets/fonts/)
 * The app uploads this folder as the share Worker's static assets during setup, and
 * `tools/fakeCloudflare.mjs` serves it in the demo. Nothing comes from a CDN at view time.
 *
 * React is pinned to the client's copy for the same reason `electron.vite.config.ts` dedupes it:
 * npm hoists a second, older React to the repo root.
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(REPO, 'share', 'dist', 'assets')
const pkgDir = (name) => {
  for (const base of [path.join(REPO, 'client', 'node_modules'), path.join(REPO, 'node_modules')]) {
    const dir = path.join(base, name)
    if (fs.existsSync(dir)) return dir
  }
  throw new Error(`${name} not found — run npm install`)
}

fs.rmSync(path.join(REPO, 'share', 'dist'), { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const result = await build({
  entryPoints: { viewer: path.join(REPO, 'share', 'viewer', 'entry.js') },
  bundle: true,
  format: 'esm',
  // Lazy features (Mermaid, code editor, …) stay separate chunks, fetched only if a viewer ever needs them.
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'files/[name]-[hash]',
  minify: true,
  target: 'es2022',
  conditions: ['production'],
  outdir: OUT,
  alias: { react: pkgDir('react'), 'react-dom': pkgDir('react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  loader: { '.woff2': 'file', '.png': 'dataurl', '.svg': 'dataurl' },
  logLevel: 'warning',
  metafile: true,
})
fs.cpSync(path.join(pkgDir('@excalidraw/excalidraw'), 'dist', 'prod', 'fonts'), path.join(OUT, 'fonts'), { recursive: true })
const size = (f) => `${(fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2)} MB`
console.log(`built ${path.relative(REPO, OUT)}: viewer.js ${size('viewer.js')}, viewer.css ${size('viewer.css')}, fonts/ copied (${Object.keys(result.metafile.outputs).length} outputs)`)
