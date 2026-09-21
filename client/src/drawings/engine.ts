/**
 * THE ENGINE'S NAME, AND THE TWO GLOBALS IT READS AT IMPORT TIME (YAZ-878, carried into the
 * document by 🔒 YAZ-1810).
 *
 * `@excalidraw/excalidraw` is NAMED here and nowhere else: every other module reaches it through
 * `loadExcalidraw()`, so the package's identity, its lazy loading and its two startup pins live
 * in one file.
 *
 * LAZY BY CONTRACT: a dynamic `import()` fired on the first canvas mount, so the renderer's entry
 * chunk never carries the package (≈250 transitive packages and megabytes of fonts). A window
 * sitting on Welcome, or on a folder with no tab open, loads none of it.
 *
 * OFFLINE BY CONTRACT (🔒 locked): the renderer must NEVER reach a CDN. Excalidraw resolves its
 * font files against `window.EXCALIDRAW_ASSET_PATH` and falls back to esm.sh only when that URL
 * FAILS, so the path is set — to the copy of the package's own asset folder bundled into the app
 * under `app://yaseen/excalidraw-assets/` — BEFORE the module is imported. The copy is made at
 * build time by `desktop/electron.vite.config.ts` (`excalidrawAssets()`) and never committed.
 * Fonts are fetched at all only for scenes that contain TEXT.
 *
 * The SAVE side pins the second global the same way: `serializeAsJSON` stamps `EXPORT_SOURCE`,
 * which the package reads ONCE at module-eval time as
 * `window.EXCALIDRAW_EXPORT_SOURCE || window.location.origin` — without this the app's own
 * `app://` origin would land in every file the user saves. It is set to the same `source` a new
 * drawing is born with (`drawingScene.ts`), so a file this app creates and this app edits differ
 * only in what was drawn.
 *
 * BOTH PINS MUST PRECEDE THE IMPORT, which is why they sit inside `loadExcalidraw` rather than at
 * module scope next to it: module scope would run them when THIS file is first imported, and
 * nothing guarantees that happens before some other module imports the package.
 */
import { DRAWING_SOURCE } from './drawingScene'

/** Bundle-relative home of the package's `fonts/…` tree (see `excalidrawAssets()` in the vite config). */
export const EXCALIDRAW_ASSET_DIR = 'excalidraw-assets/'

declare global {
  interface Window {
    /** Excalidraw's own hook for "where do my fonts live"; unset would mean its esm.sh default. */
    EXCALIDRAW_ASSET_PATH?: string | readonly string[]
    /** Excalidraw's own hook for the `source` its exports stamp; unset would mean `location.origin`. */
    EXCALIDRAW_EXPORT_SOURCE?: string
  }
}

/** The engine module, named here and nowhere else. */
export type ExcalidrawModule = typeof import('@excalidraw/excalidraw')

/** The in-flight (then settled) module load; one per renderer, never re-imported. */
let loading: Promise<ExcalidrawModule> | null = null

/** The engine, loaded lazily and pinned offline; every consumer waits on this ONE promise. */
export function loadExcalidraw(): Promise<ExcalidrawModule> {
  if (loading === null) {
    window.EXCALIDRAW_ASSET_PATH = new URL(EXCALIDRAW_ASSET_DIR, window.location.href).toString()
    window.EXCALIDRAW_EXPORT_SOURCE = DRAWING_SOURCE
    loading = import('@excalidraw/excalidraw')
  }
  return loading
}
