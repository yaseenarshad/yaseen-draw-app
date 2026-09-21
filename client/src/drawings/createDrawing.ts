/**
 * Creating a drawing sidecar (YAZ-877, second build unit of the Excalidraw embed YAZ-852).
 *
 * One empty scene written through `api.writeAsset` (YAZ-876's write half: drawings only,
 * explicit path, never fuzzy) into the vault's drawings home — `assets/drawings/`, made on
 * the way by writeAsset's own `mkdir -p`, so the first drawing in a vault needs no scaffold.
 *
 * NEVER OVERWRITE (locked): every write goes with `create: true`, so an existing target comes
 * back `ALREADY_EXISTS` and nothing is touched. The timestamp name is second-granular, so two
 * drawings made inside one second collide honestly — the loop then retries with ` 2`, ` 3`, …
 * (bounded by `MAX_ATTEMPTS`) instead of silently replacing a scene. Any OTHER failure
 * propagates to the caller's notice path untouched.
 *
 * Returns the BASENAME, which is what the note gets: `![[<name>.excalidraw]]`. A bare basename
 * is enough because `readAsset`'s shortest-path rule finds it anywhere under the root — the
 * same Obsidian rule every other embed already rides.
 */
import { api, BridgeRequestError } from '../api'

/** The drawing's home under the vault root (writeAsset creates it on first use). */
export const DRAWINGS_DIR = 'assets/drawings'

/**
 * A valid EMPTY Excalidraw scene. `type`/`version`/`source`/`elements`/`appState` are the
 * shape every Excalidraw export carries; `files` (the binary-asset sidecar map) rides along
 * because real exports always have it and `restore()` reads it — an empty object is the
 * honest value for a scene with no images. `appState: {}` on purpose: Excalidraw fills its
 * own defaults, so the file states nothing about theme or background it does not mean.
 */
export const EMPTY_SCENE = {
  type: 'excalidraw',
  version: 2,
  source: 'yaseen-docs',
  elements: [],
  appState: {},
  files: {},
} as const

/** The bytes written for a new drawing: pretty-printed, one trailing newline (a text file in a git vault). */
export const EMPTY_SCENE_JSON = `${JSON.stringify(EMPTY_SCENE, null, 2)}\n`

/** Collisions are same-second only; a bound keeps a permanently failing write from looping forever. */
const MAX_ATTEMPTS = 20

/** `Drawing 2026-08-25 20.31.02` — `:` is illegal on some filesystems, so the clock uses `.`. */
export function drawingName(now: Date, suffix = 0): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}.${p(now.getMinutes())}.${p(now.getSeconds())}`
  return `Drawing ${stamp}${suffix === 0 ? '' : ` ${suffix + 1}`}.excalidraw`
}

/** Writes one empty scene under `root`; resolves the new file's basename (see module doc). */
export async function createDrawing(root: string, now: Date = new Date()): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const name = drawingName(now, attempt)
    try {
      await api.writeAsset({ root, path: `${DRAWINGS_DIR}/${name}`, content: EMPTY_SCENE_JSON, create: true })
      return name
    } catch (err) {
      // Only a name clash is retryable — everything else is the caller's notice.
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  throw new Error(`Can't create a drawing: ${MAX_ATTEMPTS} names in ${DRAWINGS_DIR} are already taken`)
}
