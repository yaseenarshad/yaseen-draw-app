import { readdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import type { RenameFileResponse } from '@shared/types'
import { canRenameWithoutConversion } from '@shared/fileKind'
import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'

export async function hasExactDirectoryEntry(
  filePath: string,
  readNames: (directory: string) => Promise<string[]> = readdir,
): Promise<boolean> {
  try {
    return (await readNames(path.dirname(filePath))).includes(path.basename(filePath))
  } catch (err) {
    if (['ENOENT', 'ENOTDIR'].includes((err as NodeJS.ErrnoException).code ?? '')) return false
    throw err
  }
}

/**
 * In-app rename/move (Links E1 GRO-2194 + E1b GRO-2241 — decision E, GRO-2096: automatic
 * link updates, no prompt). E1b lifted E1's two guards: files may move BETWEEN folders,
 * and directories rename/move too (`kind: 'dir'` in the response). A file must keep the same
 * supported `FileKind` on both ends (`.md` ↔ `.markdown` is allowed because both are Markdown);
 * extension rules do not apply to directories.
 *
 * E1b refusals: the target's parent must already EXIST (`NOT_FOUND`, attributed to the
 * parent — never a mkdir here; the sidebar gesture only offers existing folders);
 * dot-directories (`.yaseendraw`, `.obsidian`, …) are invisible infrastructure — never in
 * the tree, index or watcher — so renaming one, or renaming INTO a dot-name, is refused
 * (`BAD_REQUEST`); a folder cannot move inside itself. The calling window's own vault ROOT
 * is refused upstream (ipc/fs.ts): root identity is a recents/vault-management question
 * (which recents entry follows, what the window identity means), out of E1b's scope.
 *
 * Never-overwrite race posture (E1, unchanged): the target is pre-checked (→
 * `ALREADY_EXISTS`) because `fs.rename` has no `wx` — it silently replaces an existing
 * target. Pre-check + the app's single-instance lock is the accepted posture (mirrors
 * createFile's never-overwrite rule); an external writer landing on the target in the
 * microseconds between check and rename is out of reach, exactly like any external edit.
 * A case-only rename on a case-insensitive fs stats the SOURCE at the target path — same
 * inode is not a collision.
 */
export async function renameFile(req: unknown): Promise<RenameFileResponse> {
  if (typeof req !== 'object' || req === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const { oldPath, newPath } = req as Record<string, unknown>
  const oldP = requireAbsPath(oldPath, 'oldPath')
  const newP = requireAbsPath(newPath, 'newPath')
  if (oldP === newP) throw new BridgeFailure('BAD_REQUEST', 'the new path is the same as the old one', { path: newP })
  return fsCall(oldP, async () => {
    const src = await stat(oldP) // missing source → ENOENT → NOT_FOUND
    const kind = src.isDirectory() ? ('dir' as const) : ('file' as const)
    if (kind === 'dir') {
      // Dot-directories are invisible infrastructure: refuse renaming one, or renaming into a dot-name.
      if (path.basename(oldP).startsWith('.')) throw new BridgeFailure('BAD_REQUEST', 'hidden folders cannot be renamed', { path: oldP })
      if (path.basename(newP).startsWith('.')) throw new BridgeFailure('BAD_REQUEST', 'names starting with "." are hidden', { path: newP })
      if (newP.startsWith(`${oldP}${path.sep}`)) throw new BridgeFailure('BAD_REQUEST', 'a folder cannot move inside itself', { path: newP })
    } else {
      if (!src.isFile()) throw new BridgeFailure('NOT_A_FILE', 'expected a file', { path: oldP })
      if (!canRenameWithoutConversion(oldP, newP)) {
        throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'the new name must keep the file kind and encoding', { path: newP })
      }
    }
    // The target's parent must already exist — E1b never creates folders on the way.
    const parentP = path.dirname(newP)
    const parent = await stat(parentP).catch(() => null)
    if (parent === null) throw new BridgeFailure('NOT_FOUND', 'the target folder does not exist', { path: parentP })
    if (!parent.isDirectory()) throw new BridgeFailure('NOT_A_DIRECTORY', 'the target parent is not a folder', { path: parentP })
    const dst = await stat(newP).catch(() => null)
    if (dst !== null && !(dst.ino === src.ino && dst.dev === src.dev)) {
      throw new BridgeFailure('ALREADY_EXISTS', kind === 'dir' ? 'a folder with this name already exists' : 'a file with this name already exists', { path: newP })
    }
    await rename(oldP, newP)
    return { oldPath: oldP, newPath: newP, kind }
  })
}

/**
 * Validate a rename that ALREADY happened on disk (Links E1c, GRO-2242): an external mover beat
 * us to the filesystem, the user confirmed the detected hypothesis, and the caller (ipc/fs.ts)
 * wants to reuse E1's downstream — store repair + the `file:renamed` push — without touching the
 * disk. Mirrors `renameFile`'s posture MINUS the rename itself: `newPath` must EXIST with that
 * exact directory-entry spelling (its stat derives `kind`), `oldPath` must have no exact entry
 * (a live old spelling means the hypothesis was wrong — refuse, never guess), and the extension /
 * dot-name rules match `renameFile`, so a repair can never claim a transition the real rename
 * would have refused. Exact entry checks matter for case-only renames on case-insensitive filesystems,
 * where `stat(oldPath)` aliases the already-renamed `newPath`. No vault-root guard: nothing moves,
 * and a window rooted at an externally renamed folder is exactly what the store repair heals.
 */
export async function repairRename(req: unknown): Promise<RenameFileResponse> {
  if (typeof req !== 'object' || req === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const { oldPath, newPath } = req as Record<string, unknown>
  const oldP = requireAbsPath(oldPath, 'oldPath')
  const newP = requireAbsPath(newPath, 'newPath')
  if (oldP === newP) throw new BridgeFailure('BAD_REQUEST', 'the new path is the same as the old one', { path: newP })
  return fsCall(newP, async () => {
    const dst = await stat(newP) // missing → ENOENT → NOT_FOUND: nothing actually landed at the new path
    if (await hasExactDirectoryEntry(oldP)) throw new BridgeFailure('BAD_REQUEST', 'the old path still exists on disk', { path: oldP })
    if (!(await hasExactDirectoryEntry(newP))) throw new BridgeFailure('NOT_FOUND', 'path does not exist', { path: newP })
    const kind = dst.isDirectory() ? ('dir' as const) : ('file' as const)
    if (kind === 'dir') {
      if (path.basename(oldP).startsWith('.') || path.basename(newP).startsWith('.')) {
        throw new BridgeFailure('BAD_REQUEST', 'hidden folders cannot be repaired', { path: path.basename(oldP).startsWith('.') ? oldP : newP })
      }
    } else {
      if (!dst.isFile()) throw new BridgeFailure('NOT_A_FILE', 'expected a file', { path: newP })
      if (!canRenameWithoutConversion(oldP, newP)) {
        throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'the new name must keep the file kind and encoding', { path: newP })
      }
    }
    return { oldPath: oldP, newPath: newP, kind }
  })
}
