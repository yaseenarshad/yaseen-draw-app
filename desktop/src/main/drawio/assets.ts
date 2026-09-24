/**
 * WHERE THE DRAW.IO WEBAPP LIVES, AND HOW IT IS SERVED (🔒 YAZ-1802 D4 / D5).
 *
 * The diagram editor is jgraph's own webapp, unmodified but for two config hooks, served from the
 * `drawio` HOST of the app's existing privileged `app` scheme — `app://drawio/index.html` — so it
 * is a SEPARATE ORIGIN from the renderer (`app://yaseen`, or the dev server): the iframe cannot
 * reach `window.yaseenDraw`, and the renderer talks to it by postMessage only.
 *
 * The bytes: `tools/packDrawio.mjs` unpacks the pinned release into `desktop/.cache/drawio/<tag>/`
 * (gitignored), and `electron.vite.config.ts` copies that into `desktop/out/drawio` at build time,
 * which electron-builder's `out/**` carries into the packaged app. Dev serves the cache directly,
 * so an overlay edit lands with the next `npm run dev` without a build.
 *
 * Every drawio-host answer carries `DRAWIO_CSP`: the webapp may load what is on its own origin and
 * nothing else — no fetch, no remote image, no CDN font — whatever a diagram or a menu asks for.
 *
 * draw.io has a desktop-app mode of its own (`bootstrap.js` loads drawio-desktop's `ElectronApp.js`
 * when the user agent carries both ` electron/` AND ` draw.io/`). Electron puts OUR app name in the
 * user agent, so the webapp always runs as the plain embed; `assets.test.ts` keeps the name clear.
 *
 * Pure (node path, an injected `exists` and `fetchFile`), so `assets.test.ts` pins every rule
 * without Electron.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 🔒 YAZ-1802 D5: the pinned release. Keep in step with `DRAWIO_TAG` in `tools/packDrawio.mjs` (`packDrawio.test.mjs` pins the pair). */
export const DRAWIO_TAG = 'v31.5.2'

/** The `app://` host the webapp is served on (🔒 YAZ-1802 D4). */
export const DRAWIO_HOST = 'drawio'
export const DRAWIO_ORIGIN = `app://${DRAWIO_HOST}`

/**
 * 🔒 YAZ-1802 D4: the strict policy on every drawio-host response. Network is closed: `connect-src`,
 * `img-src`, `font-src` and `frame-src` admit this origin (spelled out beside `'self'`, which a
 * custom scheme does not always match) plus inline `data:` / `blob:` where draw.io builds pictures
 * and fonts in memory. `script-src` is as wide as draw.io's own code needs, verified against
 * v31.5.2: `eval` (7 uses, the style/stencil evaluator) and `new Function` in `app.min.js`,
 * inline `onclick` in two built-in dialogs, and WebAssembly in the bundled libavoid router.
 */
export const DRAWIO_CSP = [
  `default-src 'self' ${DRAWIO_ORIGIN}`,
  `script-src 'self' ${DRAWIO_ORIGIN} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`,
  `style-src 'self' ${DRAWIO_ORIGIN} 'unsafe-inline'`,
  `img-src 'self' ${DRAWIO_ORIGIN} data: blob:`,
  `font-src 'self' ${DRAWIO_ORIGIN} data:`,
  `connect-src 'self' ${DRAWIO_ORIGIN}`,
  `media-src 'self' ${DRAWIO_ORIGIN} data: blob:`,
  `frame-src 'self' ${DRAWIO_ORIGIN}`,
  `worker-src 'self' ${DRAWIO_ORIGIN} blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'none'`,
].join('; ')

/**
 * 🔒 YAZ-1802 D5 / D11 (YAZ-1973): the pack files a shared diagram's page runs — draw.io's viewer,
 * every stencil set in one file (loaded only for a diagram that names a library shape), and
 * draw.io's licence. Share setup publishes each at `/assets/drawio/<the same path>` straight from
 * the app's own webapp folder (`readViewerAssets` in `ipc/share.ts`), so the app carries these bytes
 * ONCE — `share/dist/assets` holds only what the viewer build makes itself.
 */
export const DRAWIO_SHARE_FILES = ['js/viewer-static.min.js', 'js/stencils.min.js', 'LICENSE-drawio.txt'] as const

/**
 * …and the pack FOLDERS a shared diagram can reach, published whole: `img/` holds the pictures
 * draw.io's own image shapes point at (`GRAPH_IMAGE_PATH`, e.g. the Azure / network / clipart
 * libraries) — without it such a shape draws blank on a share link.
 */
export const DRAWIO_SHARE_DIRS = ['img'] as const

/**
 * The webapp folder. Dev (not packaged) prefers the pack cache — `<desktop>/.cache/drawio/<tag>`,
 * `app.getAppPath()` being `desktop/` there — so the overlay is always the current one; a build
 * falls back to, and a packaged app only ever uses, `out/drawio` beside the main bundle.
 */
export function resolveDrawioDir(opts: { mainDir: string; appPath: string; isPackaged: boolean; exists: (p: string) => boolean }): string {
  const built = path.resolve(opts.mainDir, '..', 'drawio')
  if (opts.isPackaged) return built
  const cache = path.join(opts.appPath, '.cache', 'drawio', DRAWIO_TAG)
  return opts.exists(path.join(cache, 'index.html')) ? cache : built
}

/**
 * The file a drawio-host URL path names, or null when it would leave the folder (🔒 YAZ-1802 D4 —
 * the traversal guard) or cannot be decoded. `/` is the webapp's `index.html`.
 */
export function drawioFilePath(dir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
  const file = path.resolve(dir, rel)
  return file.startsWith(dir + path.sep) ? file : null
}

/**
 * One `app://drawio/…` request (🔒 YAZ-1802 D4): the file inside `dir` or a 404 — never a path
 * outside it — and every answer, a 404 included, carries `DRAWIO_CSP` on top of the file's own
 * headers. `noStore` is dev's (🔒 D17): the pack cache changes under a running app
 * (`npm run drawio:pack`), so Chromium must never hand an iframe yesterday's `PostConfig.js`; a
 * packaged app's copy is immutable and caches normally.
 *
 * `onNotFound` is dev's too (🔒 YAZ-1802 D5, YAZ-1973): every 404 is logged, because the pack is
 * PRUNED to what draw.io loads (`tools/lib/drawioPack.mjs`) — after a draw.io bump, opening the
 * seeded diagrams with the terminal in view is how a file the prune should have kept shows up.
 */
export async function serveDrawio(dir: string, pathname: string, opts: { fetchFile: (url: string) => Promise<Response>; noStore: boolean; onNotFound?: (pathname: string) => void }): Promise<Response> {
  const notFound = () => {
    opts.onNotFound?.(pathname)
    return new Response('Not found', { status: 404, headers: { 'Content-Security-Policy': DRAWIO_CSP } })
  }
  const file = drawioFilePath(dir, pathname)
  if (file === null) return notFound()
  let res: Response
  try {
    res = await opts.fetchFile(pathToFileURL(file).toString())
  } catch {
    return notFound()
  }
  if (res.status === 404) return notFound()
  const headers = new Headers(res.headers)
  headers.set('Content-Security-Policy', DRAWIO_CSP)
  if (opts.noStore) headers.set('Cache-Control', 'no-store')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
