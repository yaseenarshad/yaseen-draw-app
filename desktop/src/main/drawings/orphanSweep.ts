/**
 * THE ORPHAN SWEEP (🔒 YAZ-1775 D3 on YAZ-1775, built in YAZ-1811): once per vault per session — the
 * first time a window asks for that vault's tree — every file in `<root>/assets/` that no
 * `.excalidraw` in the vault references AND that is older than 24 h goes to the OS trash.
 *
 * The two guards ARE the design:
 *
 *  - "referenced by nothing" is read FRESH from every scene under the root at sweep time, not
 *    from an index that could be stale. Nested folders count: a board five levels down holds its
 *    images alive exactly as one at the root does.
 *  - "older than `ORPHAN_MAX_AGE_MS`" is what makes this safe to run while editors are open. An
 *    image pasted a minute ago already sits in `assets/`, and the board naming it has not saved
 *    yet — without the age guard the sweep would eat the picture the user is looking at.
 *
 * TOLERANT BY DESIGN. A scene that will not parse, a file that will not read, a single trash
 * call that fails: each is skipped and the sweep goes on. It is housekeeping, and housekeeping
 * that aborts halfway is worse than housekeeping that does a little less. The one thing it will
 * not do is guess: a file it could not read protects nothing, which is why a corrupt board's
 * images are still held alive by the AGE guard until someone fixes or deletes it.
 *
 * `shell.trashItem`, never `fs.rm` (the app's rule for every delete): the OS trash is the undo.
 * The trash function is INJECTED so this module has no Electron import and its test runs on
 * plain Node; `ipc/drawing.ts` wires the real one and the once-per-session guard. The decision
 * itself — which names go — is `planOrphanSweep` in `shared/drawingAssets.ts`.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { MAX_DRAWING_BYTES } from '@shared/types'
import { isDrawing } from '@shared/fileKind'
import { ASSETS_DIR, planOrphanSweep, referencedFileIds, type AssetListingEntry } from '@shared/drawingAssets'
import { isSkipped } from '../fs/fsUtils'

export interface SweepDeps {
  now: () => number
  /** Moves one absolute path to the OS trash; a rejection skips that file and the sweep goes on. */
  trash: (absPath: string) => Promise<void>
}

/**
 * Every fileId any non-deleted image element in any `.excalidraw` under `root` still uses.
 * Dot-dirs and `node_modules` are invisible here as they are to every other fs call, and
 * `assets/` itself is skipped — it holds the bytes, never a board that could name them.
 */
export async function referencedAssetIds(root: string): Promise<Set<string>> {
  const ids = new Set<string>()
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (isSkipped(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!(dir === root && e.name === ASSETS_DIR)) stack.push(full)
      } else if (e.isFile() && isDrawing(e.name)) {
        try {
          const st = await stat(full)
          if (st.size > MAX_DRAWING_BYTES) continue
          const scene = JSON.parse(await readFile(full, 'utf8')) as Record<string, unknown>
          if (Array.isArray(scene.elements)) for (const id of referencedFileIds(scene.elements)) ids.add(id)
        } catch {
          // Not a scene, or unreadable: it names nothing, so it protects nothing. The age guard
          // is what keeps a temporarily broken board's images around.
        }
      }
    }
  }
  return ids
}

/** Runs ONE sweep of `<root>/assets/`; resolves the number of files trashed. Never throws. */
export async function sweepOrphanAssets(root: string, deps: SweepDeps): Promise<number> {
  const store = path.join(root, ASSETS_DIR)
  const dirents = await readdir(store, { withFileTypes: true }).catch(() => null)
  // No store, or an empty one: nothing to sweep, and no reason to walk the vault for an answer.
  if (dirents === null || dirents.length === 0) return 0
  const referenced = await referencedAssetIds(root)
  const listing: AssetListingEntry[] = []
  for (const e of dirents) {
    // Only regular files are assets; a directory or a symlink under `assets/` is not ours to sweep.
    if (!e.isFile()) continue
    const st = await stat(path.join(store, e.name)).catch(() => null)
    if (st !== null) listing.push({ name: e.name, mtime: st.mtimeMs })
  }
  let swept = 0
  for (const name of planOrphanSweep(listing, referenced, deps.now())) {
    try {
      await deps.trash(path.join(store, name))
      swept += 1
    } catch {
      // Left in place; the next session's sweep tries again.
    }
  }
  return swept
}
