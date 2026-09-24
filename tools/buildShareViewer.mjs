#!/usr/bin/env node
/**
 * USAGE: node tools/buildShareViewer.mjs   (also the last step of `npm run build`)
 *
 * Builds the share viewer's static assets (YAZ-1799) into `share/dist/assets/`:
 *   viewer.js   — share/viewer/entry.js + React + the app's own vendored Excalidraw, one ES module
 *   viewer.css  — Excalidraw's stylesheet
 *   fonts/…     — Excalidraw's font files (a scene with text fetches them from /assets/fonts/)
 *   diagram.js  — share/viewer/diagram.js, a shared draw.io diagram's viewer (🔒 YAZ-1802 D11)
 *   drawio/…    — what it runs: `DRAWIO_FILES` from the pinned draw.io (`npm run drawio:pack`), and
 *                 a `fonts.css` for the fonts the diagram editor offers first, from fonts/ above
 * The app ships this folder (extraResources → `share-viewer`) and uploads it as the share Worker's
 * static assets during setup; `tools/fakeCloudflare.mjs` serves it in the demo. Nothing comes from a CDN at view time.
 *
 * React is pinned to the client's copy for the same reason `electron.vite.config.ts` dedupes it:
 * npm hoists a second, older React to the repo root.
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DRAWIO_TAG } from './packDrawio.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(REPO, 'share', 'dist', 'assets')
const DRAWIO = path.join(REPO, 'desktop', '.cache', 'drawio', DRAWIO_TAG)
/**
 * 🔒 YAZ-1802 D11: a shared diagram's viewer, `[published under assets/, source]` — draw.io's own
 * read-only viewer, EVERY stencil (a library shape loads its set on first use: without them an AWS
 * or Cisco icon draws as nothing), draw.io's Apache-2.0 licence, and our config that points the
 * viewer at them. Each file stays far under Cloudflare's 25 MiB per static asset (the largest
 * stencil set is ~6.6 MB).
 */
export const DRAWIO_FILES = [
  ['drawio/viewer-static.min.js', path.join(DRAWIO, 'js', 'viewer-static.min.js')],
  ['drawio/stencils', path.join(DRAWIO, 'stencils')],
  ['drawio/LICENSE-drawio.txt', path.join(DRAWIO, 'LICENSE-drawio.txt')],
  ['drawio/config.js', path.join(REPO, 'share', 'viewer', 'drawioConfig.js')],
]
/**
 * `drawio/fonts.css`: the diagram editor's own font sheet (packDrawio's), re-pointed from the app's
 * drawio origin at the same font files this build already publishes under `/assets/fonts/`.
 */
export const diagramFontCss = () => fs.readFileSync(path.join(DRAWIO, 'yaseen-fonts', 'fonts.css'), 'utf8').replaceAll('app://drawio/yaseen-fonts/', '/assets/fonts/')
const pkgDir = (name) => {
  for (const base of [path.join(REPO, 'client', 'node_modules'), path.join(REPO, 'node_modules')]) {
    const dir = path.join(base, name)
    if (fs.existsSync(dir)) return dir
  }
  throw new Error(`${name} not found — run npm install`)
}

async function main() {
  if (!fs.existsSync(DRAWIO_FILES[0][1])) throw new Error(`draw.io ${DRAWIO_TAG} is not unpacked at ${DRAWIO} — run \`npm run drawio:pack\``)
  fs.rmSync(path.join(REPO, 'share', 'dist'), { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  const result = await build({
    entryPoints: { viewer: path.join(REPO, 'share', 'viewer', 'entry.js'), diagram: path.join(REPO, 'share', 'viewer', 'diagram.js') },
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
  for (const [published, source] of DRAWIO_FILES) fs.cpSync(source, path.join(OUT, published), { recursive: true })
  fs.writeFileSync(path.join(OUT, 'drawio', 'fonts.css'), diagramFontCss())
  const size = (f) => `${(fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2)} MB`
  console.log(`built ${path.relative(REPO, OUT)}: viewer.js ${size('viewer.js')}, viewer.css ${size('viewer.css')}, diagram.js ${size('diagram.js')}, fonts/ and drawio/ copied (${Object.keys(result.metafile.outputs).length} outputs)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
