/**
 * THE DRAWING DOCUMENT'S TWO DOORS (🔒 YAZ-1810).
 *
 * `drawing:load` and `drawing:save` are the ONLY way a `.excalidraw` opened AS A DOCUMENT reads
 * and writes — not `fs:read`/`fs:write` (a 10 MiB text buffer, and a scene is not text the user
 * types), not the asset pipe (`fs:read-asset` resolves a bare name by walking the vault, and a
 * document is never fuzzy). One door per DIRECTION, not one per artefact, because a scene and
 * the image bytes it names are ONE thing: a load is "the scene, then its images", a save is "the
 * images, then the scene", and splitting either across two calls would let a renderer land half
 * of it — a scene on disk naming bytes that are not there.
 *
 * The read ceiling is `MAX_DRAWING_BYTES` (200 MiB), not `MAX_FILE_BYTES`: a LEGACY scene — an
 * upstream export, or one an older build wrote — embeds its images as base64 and is routinely
 * past 10 MiB before it has been opened once. The cap exists to refuse a file that has stopped
 * being a document, not to police normal ones.
 *
 * THE SCENE IS VALIDATED HERE, not only in the renderer: a corrupt or empty `.excalidraw` comes
 * back as one `IO_ERROR` naming the path, which the editor shows as a readable error pane. The
 * check is deliberately the OUTLINE only (an object with an `elements` array) — the file is user
 * data, and the engine's own `restore()` is what decides whether those elements are a scene.
 *
 * Requests cross IPC from a sandboxed renderer, so their shape is checked like a request body,
 * never trusted from the type.
 *
 * IMAGE BYTES ARE YAZ-1811's (🔒 D3). This file already carries their fields — `files` /
 * `stored` on the way out, `newFiles` / `persisted` on the way back — so the contract does not
 * change shape when the store lands; until it does, load reports no images (the engine draws its
 * placeholder) and `persisted: []` says exactly which of a caller's `newFiles` reached disk:
 * none.
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { DrawingLoadRequest, DrawingLoadResponse, DrawingSaveRequest, DrawingSaveResponse } from '@shared/types'
import { MAX_DRAWING_BYTES } from '@shared/types'
import { isDrawing } from '@shared/fileKind'
import { readBoundedRegularFile } from './boundedRead'
import { atomicWrite, BridgeFailure, fsCall, requireAbsPath, requireDir } from './fsUtils'

const TOO_LARGE = `drawing exceeds ${MAX_DRAWING_BYTES} bytes`

/** A document path — vault-relative or absolute — resolved INSIDE `dir`, with the drawing extension. */
function resolveDocument(dir: string, rel: unknown): string {
  if (typeof rel !== 'string' || rel.trim() === '' || rel.includes('\0')) throw new BridgeFailure('BAD_REQUEST', "missing 'path'")
  const file = path.resolve(dir, rel)
  if (!file.startsWith(dir + path.sep)) throw new BridgeFailure('BAD_REQUEST', 'path escapes the vault root', { path: rel })
  if (!isDrawing(file)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .excalidraw files open as drawings', { path: file })
  return file
}

/** The request's `{ root, path }` pair, validated once for both doors. */
function target(raw: unknown): { dir: string; file: string; body: Record<string, unknown> } {
  if (typeof raw !== 'object' || raw === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const body = raw as Record<string, unknown>
  const dir = requireAbsPath(body.root, 'root')
  return { dir, file: resolveDocument(dir, body.path), body }
}

/**
 * The scene's elements, or a failure. The OUTLINE only (see the module doc): an object carrying
 * an `elements` array. `code` differs by door — a bad file is the disk's fault (`IO_ERROR`), a
 * bad `json` argument is the caller's (`BAD_REQUEST`).
 */
function sceneElements(json: string, file: string, code: 'IO_ERROR' | 'BAD_REQUEST'): readonly unknown[] {
  const bad = (): never => {
    throw new BridgeFailure(code, code === 'IO_ERROR' ? 'file is not an Excalidraw scene' : "'json' is not an Excalidraw scene", { path: file })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return bad()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return bad()
  const elements = (parsed as Record<string, unknown>).elements
  return Array.isArray(elements) ? elements : bad()
}

export async function loadDrawing(req: DrawingLoadRequest): Promise<DrawingLoadResponse> {
  const { dir, file } = target(req)
  await requireDir(dir)
  const snapshot = await readBoundedRegularFile(file, MAX_DRAWING_BYTES, TOO_LARGE)
  const json = snapshot.data.toString('utf8')
  sceneElements(json, file, 'IO_ERROR')
  // Images are YAZ-1811's; the two fields ride along empty so the envelope never changes shape.
  return { path: file, json, mtime: snapshot.mtime, size: snapshot.size, files: {}, stored: [] }
}

export async function saveDrawing(req: DrawingSaveRequest): Promise<DrawingSaveResponse> {
  const { dir, file, body } = target(req)
  const { json, expectedMtime, newFiles } = body
  if (typeof json !== 'string') throw new BridgeFailure('BAD_REQUEST', "'json' must be a string", { path: file })
  if (expectedMtime !== undefined && typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  if (!Array.isArray(newFiles)) throw new BridgeFailure('BAD_REQUEST', "'newFiles' must be an array", { path: file })
  // Every check before any write: a half-landed save is worse than a refused one.
  sceneElements(json, file, 'BAD_REQUEST')
  if (Buffer.byteLength(json, 'utf8') > MAX_DRAWING_BYTES) throw new BridgeFailure('TOO_LARGE', TOO_LARGE, { path: file })
  await requireDir(dir)
  if (expectedMtime !== undefined) {
    // A file that is GONE is not a conflict: the tab's own copy is the only one left, and
    // refusing here would strand it. Only a file that is there and DIFFERENT blocks the write.
    const st = await stat(file).catch(() => undefined)
    if (st !== undefined && st.mtimeMs !== expectedMtime) {
      throw new BridgeFailure('CONFLICT', 'drawing changed on disk since last read', { path: file, mtime: st.mtimeMs })
    }
  }
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, json))
  // No store yet (YAZ-1811): the honest answer to "which ids are on disk now" is none.
  return { path: file, mtime, size, persisted: [] }
}
