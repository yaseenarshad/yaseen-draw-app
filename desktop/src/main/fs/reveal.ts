import { shell } from 'electron'
import { stat } from 'node:fs/promises'
import type { RevealResponse } from '@shared/types'
import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'

/**
 * Reveal in Finder (GRO-2274 — LOCKED: VS Code parity for this issue).
 *
 * `shell.showItemInFolder` — reveal the entry IN ITS PARENT, for every row type: a file, a
 * folder, and the vault root. Deliberately NOT `shell.openPath`, which would open a folder's
 * contents instead. The verb is "Reveal", VS Code and Obsidian both behave this way, and a
 * menu item that means two different things depending on what you right-clicked is exactly
 * the inconsistency that makes people stop trusting a menu.
 *
 * The stat is the reason this is not a one-liner: `showItemInFolder` returns `void` and
 * SILENTLY DOES NOTHING for a path that no longer exists, which reads to the user as a broken
 * menu item. A stale row (deleted or moved externally) must surface `NOT_FOUND` so the caller
 * can show a passive notice.
 *
 * No dot-entry guard and no extension guard, unlike `remove.ts` and `rename.ts`: revealing is
 * READ-ONLY and destroys nothing, so any absolute path the app can already show is fair game.
 * That matches the documented "no jail — any absolute path is allowed" posture in
 * `docs/CONTRACTS.md`. The asymmetry is deliberate; do not "restore" it for consistency.
 */
export async function revealItem(req: unknown): Promise<RevealResponse> {
  if (typeof req !== 'object' || req === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const p = requireAbsPath((req as Record<string, unknown>).path, 'path')
  return fsCall(p, async () => {
    await stat(p) // missing → ENOENT → NOT_FOUND, so a stale row can be reported
    shell.showItemInFolder(p)
    return { path: p }
  })
}
