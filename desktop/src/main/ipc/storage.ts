import { CH } from '../../channels'
import { shrinkVault } from '../fs/shrink'
import { BridgeFailure, requireAbsPath, requireDir } from '../fs/fsUtils'
import { vaultStorageOffThread } from '../git/storage'
import storageWorker from '../git/storageWorker?modulePath'
import { handle } from './envelope'

/**
 * The `storage.*` half of `window.yaseenDraw` (YAZ-1801) — Settings › Storage. Two doors, both
 * over a vault root the renderer names: the read-only sizes (`../git/storage.ts`, disk + local
 * git, never the network, measured on a worker thread — D8) and the one rewrite, moving legacy
 * pictures out of boards (`../fs/shrink.ts`, the save's own extraction, block kept verbatim).
 *
 * `skip` crosses from a sandboxed renderer, so it is checked like a request body: an array of
 * absolute paths, nothing else. A path in it that names no board simply matches nothing.
 */
export function registerStorageIpc(): void {
  handle(CH.storageStats, async (root: unknown) => {
    const dir = requireAbsPath(root, 'root')
    await requireDir(dir)
    return vaultStorageOffThread(storageWorker, dir)
  })
  handle(CH.storageShrink, async (root: unknown, skip: unknown) => {
    const dir = requireAbsPath(root, 'root')
    await requireDir(dir)
    if (!Array.isArray(skip)) throw new BridgeFailure('BAD_REQUEST', "'skip' must be an array of absolute paths")
    return shrinkVault(dir, { skip: skip.map((p, i) => requireAbsPath(p, `skip[${i}]`)) })
  })
}
