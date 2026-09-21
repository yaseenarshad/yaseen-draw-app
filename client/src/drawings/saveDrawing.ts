/**
 * Writing a drawing back (YAZ-879). `writeProperty.ts`'s CONFLICT dance, with the one difference
 * a drawing forces:
 *
 * THE CANVAS WINS. A note's frontmatter write re-reads the file so the concurrent edit AROUND the
 * changed key survives; a scene has no such "around" — two scenes cannot be merged, and the user
 * is looking at theirs. So the re-read here fetches NOTHING but a fresh `expectedMtime`: the guard
 * is refreshed, the bytes are the ones on the canvas, and the write goes through once. A second
 * CONFLICT throws (two writers racing us is not something a retry loop fixes) and becomes the
 * modal's inline error.
 *
 * The path is the ABSOLUTE one `openDrawing` resolved, never the embed's fuzzy target: `readAsset`
 * roams by basename, `writeAsset` never does (🔒 YAZ-876).
 */
import { api, BridgeRequestError } from '../api'

export interface SaveDrawingRequest {
  /** Vault root — the re-read's door, and the boundary the write is checked against. */
  root: string
  /** The embed's raw target; only the CONFLICT re-read uses it, and only for the fresh mtime. */
  target: string
  /** Absolute path from the load (`LoadedDrawing.path`). */
  path: string
  /** The serialized scene, exactly as it goes to disk. */
  content: string
  /** The mtime the modal loaded at; a differing disk mtime is the CONFLICT below. */
  expectedMtime: number
}

/** Writes the scene; resolves the new mtime. Rejects with the `BridgeRequestError` as it came. */
export async function saveDrawing(req: SaveDrawingRequest): Promise<number> {
  const { root, target, path, content, expectedMtime } = req
  try {
    return (await api.writeAsset({ root, path, content, expectedMtime })).mtime
  } catch (err) {
    if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT') throw err
    // Re-read for the GUARD only — its bytes are deliberately dropped (see the module doc).
    const fresh = await api.readAsset(root, target)
    return (await api.writeAsset({ root, path, content, expectedMtime: fresh.mtime })).mtime
  }
}

/** What the modal's inline error line says; the bridge's own message when it has one. */
export function saveErrorMessage(err: unknown): string {
  const detail = err instanceof Error && err.message !== '' ? err.message : String(err)
  return `Can't save the drawing: ${detail}`
}
