/**
 * THE DRAWING DOCUMENT'S TWO DOORS (🔒 YAZ-1810).
 *
 * `drawing:load` and `drawing:save` are the ONLY way a `.excalidraw` opened AS A DOCUMENT reads
 * and writes. One door per DIRECTION, not one per artefact, because a scene and the image bytes
 * it names are ONE thing: a load is "the scene, then its images", a save is "the images, then the
 * scene", and splitting either across two calls would let a renderer land half of it — a scene on
 * disk naming bytes that are not there.
 *
 * The read ceiling is `MAX_DRAWING_BYTES` (200 MiB): a LEGACY scene — an upstream export, or one
 * an older build wrote — embeds its images as base64 and is routinely past 10 MiB before it has
 * been opened once. The cap exists to refuse a file that has stopped being a document, not to
 * police normal ones.
 *
 * THE SCENE IS VALIDATED HERE, not only in the renderer: a corrupt or empty `.excalidraw` comes
 * back as one `IO_ERROR` naming the path, which the editor shows as a readable error pane. The
 * check is deliberately the OUTLINE only (an object with an `elements` array) — the file is user
 * data, and the engine's own `restore()` is what decides whether those elements are a scene.
 *
 * Requests cross IPC from a sandboxed renderer, so their shape is checked like a request body,
 * never trusted from the type.
 *
 * 🔒 D3 ON DISK: the scene carries `files: {}`; image elements keep only their `fileId`; the
 * bytes sit at `<root>/assets/<fileId>.<ext>` (the engine's own SHA-1 id, the mime's extension).
 * An asset is IMMUTABLE — the same bytes always get the same name — so a save never rewrites one
 * (`wx`; EEXIST means it is already exactly these bytes). A LEGACY export that still embeds
 * `files` opens (its entries pass straight through the load) and SHRINKS on its first save:
 * `stripEmbeddedFiles` lifts the bytes into the store and writes the scene lean.
 *
 * ASSETS FIRST, THEN THE SCENE. A scene on disk must never name bytes that are not there, so
 * every asset lands before the file that references it. The reverse order would leave a crash
 * window in which the document is broken; this order's worst case is an unreferenced asset,
 * which the orphan sweep collects a day later.
 *
 * A REFERENCED ID WITH NO BYTES ANYWHERE is left OUT of the response rather than raised as an
 * error: the engine draws its missing-image placeholder and the document still opens. Losing a
 * picture must never cost the user the board it was on.
 *
 * Pure rules (`referencedFileIds`, `stripEmbeddedFiles`, `extForMime`, …) live in
 * `shared/drawingAssets.ts`; this file is the fs around them.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DrawingFileEntry, DrawingLoadRequest, DrawingLoadResponse, DrawingSaveRequest, DrawingSaveResponse } from '@shared/types'
import { MAX_DRAWING_BYTES } from '@shared/types'
import { isDrawing } from '@shared/fileKind'
import { ASSETS_DIR, assetFileName, extForMime, fileIdOfAssetName, isValidFileId, mimeForAssetExt, parseDataUrl, referencedFileIds, stripEmbeddedFiles } from '@shared/drawingAssets'
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

/** `assets/` as a map fileId → file name (first match wins); an absent folder is an empty store. */
async function listStore(dir: string): Promise<Map<string, string>> {
  const store = new Map<string, string>()
  const names = await readdir(path.join(dir, ASSETS_DIR)).catch(() => [] as string[])
  // Sorted so a duplicate id spelled two ways (`x.png` and `x.jpg`) always resolves to the same one.
  for (const name of names.sort()) {
    const id = fileIdOfAssetName(name)
    const ext = name.slice(name.lastIndexOf('.') + 1)
    if (id === null || mimeForAssetExt(ext) === null || store.has(id)) continue
    store.set(id, name)
  }
  return store
}

export async function loadDrawing(req: DrawingLoadRequest): Promise<DrawingLoadResponse> {
  const { dir, file } = target(req)
  await requireDir(dir)
  const snapshot = await readBoundedRegularFile(file, MAX_DRAWING_BYTES, TOO_LARGE)
  const json = snapshot.data.toString('utf8')
  const elements = sceneElements(json, file, 'IO_ERROR')
  // A legacy scene's own embedded entries are the fallback when the store has nothing.
  const { embedded } = stripEmbeddedFiles(json)
  const store = await listStore(dir)
  const files: Record<string, DrawingFileEntry> = {}
  const stored: string[] = []
  for (const id of [...referencedFileIds(elements)].sort()) {
    const name = store.get(id)
    if (name !== undefined) {
      const mimeType = mimeForAssetExt(name.slice(name.lastIndexOf('.') + 1))
      const bytes = await readFile(path.join(dir, ASSETS_DIR, name)).catch(() => null)
      // Unreadable bytes are the same as absent bytes: the placeholder, not a failed open.
      if (bytes !== null && mimeType !== null) {
        files[id] = { mimeType, dataURL: `data:${mimeType};base64,${bytes.toString('base64')}` }
        stored.push(id)
        continue
      }
    }
    const legacy = embedded[id]
    if (legacy !== undefined) files[id] = legacy
  }
  return { path: file, json, mtime: snapshot.mtime, size: snapshot.size, files, stored }
}

/** One asset to land: validated shape, resolved name, decoded bytes. */
interface PendingAsset {
  fileId: string
  name: string
  bytes: Buffer
}

/** One `newFiles` entry, checked like a request body — it names a file the renderer wants created. */
function checkAsset(entry: unknown, file: string): PendingAsset {
  if (typeof entry !== 'object' || entry === null) throw new BridgeFailure('BAD_REQUEST', 'newFiles entries must be objects', { path: file })
  const { fileId, mimeType, dataURL } = entry as Record<string, unknown>
  if (!isValidFileId(fileId)) throw new BridgeFailure('BAD_REQUEST', "'fileId' must be a plain id", { path: file })
  if (typeof mimeType !== 'string' || extForMime(mimeType) === null) throw new BridgeFailure('BAD_REQUEST', `unsupported image type for ${fileId}`, { path: file })
  const data = typeof dataURL === 'string' ? parseDataUrl(dataURL) : null
  if (data === null) throw new BridgeFailure('BAD_REQUEST', `'dataURL' for ${fileId} must be a base64 data URL`, { path: file })
  const name = assetFileName(fileId, mimeType)
  if (name === null) throw new BridgeFailure('BAD_REQUEST', `unsupported image type for ${fileId}`, { path: file })
  return { fileId, name, bytes: Buffer.from(data.base64, 'base64') }
}

export async function saveDrawing(req: DrawingSaveRequest): Promise<DrawingSaveResponse> {
  const { dir, file, body } = target(req)
  const { json, expectedMtime, newFiles } = body
  if (typeof json !== 'string') throw new BridgeFailure('BAD_REQUEST', "'json' must be a string", { path: file })
  if (expectedMtime !== undefined && typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  if (!Array.isArray(newFiles)) throw new BridgeFailure('BAD_REQUEST', "'newFiles' must be an array", { path: file })
  // Every check before any write: a half-landed save is worse than a refused one.
  const elements = sceneElements(json, file, 'BAD_REQUEST')
  const pending = newFiles.map((entry) => checkAsset(entry, file))
  const { json: lean, embedded } = stripEmbeddedFiles(json)
  // A legacy scene's still-embedded bytes shrink into the store on THIS save — only the ones the
  // scene still references, and only those the renderer did not already ship as `newFiles`.
  const referenced = referencedFileIds(elements)
  for (const [fileId, entry] of Object.entries(embedded)) {
    if (!referenced.has(fileId) || !isValidFileId(fileId) || pending.some((p) => p.fileId === fileId)) continue
    const data = parseDataUrl(entry.dataURL)
    const name = assetFileName(fileId, entry.mimeType)
    if (data === null || name === null) continue
    pending.push({ fileId, name, bytes: Buffer.from(data.base64, 'base64') })
  }
  if (Buffer.byteLength(lean, 'utf8') > MAX_DRAWING_BYTES) throw new BridgeFailure('TOO_LARGE', TOO_LARGE, { path: file })
  await requireDir(dir)
  if (expectedMtime !== undefined) {
    // A file that is GONE is not a conflict: the tab's own copy is the only one left, and
    // refusing here would strand it. Only a file that is there and DIFFERENT blocks the write.
    const st = await stat(file).catch(() => undefined)
    if (st !== undefined && st.mtimeMs !== expectedMtime) {
      throw new BridgeFailure('CONFLICT', 'drawing changed on disk since last read', { path: file, mtime: st.mtimeMs })
    }
  }
  // Assets first (see the module doc), and only once the conflict guard has passed — a refused
  // save must leave the vault exactly as it found it.
  const persisted: string[] = []
  if (pending.length > 0) {
    const store = path.join(dir, ASSETS_DIR)
    await fsCall(store, () => mkdir(store, { recursive: true }))
    for (const asset of pending) {
      const to = path.join(store, asset.name)
      await fsCall(to, async () => {
        try {
          // `wx`: an existing file is left exactly as it is — content-addressed means it IS these bytes.
          await writeFile(to, asset.bytes, { flag: 'wx' })
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        }
      })
      persisted.push(asset.fileId)
    }
  }
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, lean))
  return { path: file, mtime, size, persisted }
}
