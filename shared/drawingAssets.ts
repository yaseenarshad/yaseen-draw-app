/**
 * THE IMAGE STORE'S PURE RULES (🔒 D3 on YAZ-1775, built in YAZ-1811).
 *
 * 🔒 D3: a `.excalidraw` on disk carries `files: {}` — image ELEMENTS keep only their `fileId`,
 * and the bytes live at `<vault>/assets/<fileId>.<ext>`. The id is Excalidraw's own (the SHA-1
 * of the bytes, which the engine computes on paste, so the store is content-addressed for free)
 * and the extension follows the mime. Files are therefore IMMUTABLE: the same bytes always get
 * the same name, so a second paste of one image writes nothing and two boards share one file.
 *
 * Both processes need these rules — main resolves ids to files on load, lifts a legacy export's
 * embedded bytes on save and decides what the sweep may trash; the renderer works out which of
 * the canvas's files a save still has to ship — so they live in `shared/` once, with no fs, no
 * Electron and no engine import, and `drawingAssets.test.ts` pins them. The doors that USE them
 * are `desktop/src/main/fs/drawing.ts`, `desktop/src/main/drawings/orphanSweep.ts` and
 * `client/src/drawings/DrawingEditor.tsx`.
 */

/** Mime → extension for the images the store keeps. Nothing else is an asset. */
const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

/** Extension → mime, INCLUDING the spellings `extForMime` never writes (`jpeg`), which it must still read. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
}

/**
 * An unreferenced asset younger than this is NEVER swept. That single rule is what makes the
 * sweep safe to run while editors are open: an image pasted a minute ago already sits in
 * `assets/`, and the board that names it has not saved yet — an eager sweep would eat exactly
 * the file the user is looking at.
 */
export const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** The vault-relative folder the store lives in; the sidebar tree hides it (🔒 D3). */
export const ASSETS_DIR = 'assets'

/** One stored image as it crosses IPC. Mirrors `DrawingFileEntry` without importing the bridge types. */
export interface DrawingFileData {
  mimeType: string
  dataURL: string
}

export function extForMime(mimeType: string): string | null {
  return EXT_BY_MIME[mimeType] ?? null
}

export function mimeForAssetExt(ext: string): string | null {
  return MIME_BY_EXT[ext.toLowerCase()] ?? null
}

/** `<fileId>.<ext>`, or null when the mime is not one the store keeps. */
export function assetFileName(fileId: string, mimeType: string): string | null {
  const ext = extForMime(mimeType)
  return ext === null ? null : `${fileId}.${ext}`
}

/** The id an asset's NAME carries (its stem); null for a dot-entry or an empty stem. */
export function fileIdOfAssetName(name: string): string | null {
  if (name.startsWith('.')) return null
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  return stem === '' ? null : stem
}

/**
 * A fileId becomes a path SEGMENT under `assets/` and arrives from a sandboxed renderer, so it
 * is checked like a request body rather than trusted. The engine's ids are hex; the slightly
 * wider `[A-Za-z0-9_-]` still keeps out every separator, every dot and every control character,
 * so nothing here can climb out of the folder or forge an extension.
 */
export function isValidFileId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

/**
 * The fileIds a scene still USES: non-deleted image elements only. A deleted element keeps its
 * `fileId` so undo can bring the picture back, but it does not keep the bytes alive — otherwise
 * nothing would ever become an orphan.
 */
export function referencedFileIds(elements: readonly unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const el of elements) {
    if (typeof el !== 'object' || el === null) continue
    const { type, fileId, isDeleted } = el as Record<string, unknown>
    if (type === 'image' && typeof fileId === 'string' && fileId !== '' && isDeleted !== true) ids.add(fileId)
  }
  return ids
}

/** `data:<mime>;base64,<payload>` → its parts; null for anything else (a remote URL is not bytes). */
export function parseDataUrl(dataURL: string): { mimeType: string; base64: string } | null {
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]*)$/.exec(dataURL)
  return m === null ? null : { mimeType: m[1], base64: m[2] }
}

/**
 * A LEGACY scene — an upstream export, or one an older build wrote — embeds its bytes under
 * `files`. Lift every usable entry out and hand back the scene with `files: {}`, the shape every
 * save writes: pretty-printed like Excalidraw's own writer, plus the trailing newline a text
 * file in a git vault ends with.
 *
 * BYTE-STABLE WHEN NOTHING CHANGED. A scene that is already lean round-trips as ITSELF, so
 * saving an untouched document never rewrites it into a different spelling — which would show up
 * as a diff in the vault's git history for no reason at all.
 *
 * Throws when the bytes are not a scene object; the caller decides what that means.
 */
export function stripEmbeddedFiles(json: string): { json: string; embedded: Record<string, DrawingFileData> } {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an Excalidraw scene')
  const scene = parsed as Record<string, unknown>
  const embedded: Record<string, DrawingFileData> = {}
  const files = scene.files
  let hadEntries = false
  if (typeof files === 'object' && files !== null) {
    for (const [id, entry] of Object.entries(files as Record<string, unknown>)) {
      hadEntries = true
      if (typeof entry !== 'object' || entry === null) continue
      const { mimeType, dataURL } = entry as Record<string, unknown>
      if (typeof mimeType !== 'string' || typeof dataURL !== 'string' || parseDataUrl(dataURL) === null) continue
      embedded[id] = { mimeType, dataURL }
    }
  }
  const lean = `${JSON.stringify({ ...scene, files: {} }, null, 2)}\n`
  return { json: !hadEntries && lean === json ? json : lean, embedded }
}

/**
 * The renderer's half of a save: which of the engine's current files does the store not have
 * yet? Only files the scene still REFERENCES count — a pasted-then-deleted image must never
 * land — and `persisted` is what the load found plus what earlier saves reported back. Sorted by
 * id so the write order, and the test, are deterministic.
 */
export function unpersistedFiles(files: Record<string, DrawingFileData>, referenced: ReadonlySet<string>, persisted: ReadonlySet<string>): Array<{ fileId: string } & DrawingFileData> {
  return Object.keys(files)
    .filter((id) => referenced.has(id) && !persisted.has(id))
    .sort()
    .map((fileId) => ({ fileId, mimeType: files[fileId].mimeType, dataURL: files[fileId].dataURL }))
}

export interface AssetListingEntry {
  name: string
  /** Epoch ms. */
  mtime: number
  isDir?: boolean
}

/**
 * The orphan sweep's DECISION (🔒 D3). An `assets/` entry goes to the trash when all three hold:
 * it is an image asset by extension, NO `.excalidraw` anywhere in the vault references its id,
 * AND it is older than `ORPHAN_MAX_AGE_MS`. Dot-entries, sub-folders and foreign files are never
 * candidates — the store is the app's, but the folder is the user's.
 */
export function planOrphanSweep(listing: readonly AssetListingEntry[], referenced: ReadonlySet<string>, now: number, maxAgeMs = ORPHAN_MAX_AGE_MS): string[] {
  const out: string[] = []
  for (const entry of listing) {
    if (entry.isDir === true || entry.name.startsWith('.')) continue
    const dot = entry.name.lastIndexOf('.')
    if (dot <= 0 || mimeForAssetExt(entry.name.slice(dot + 1)) === null) continue
    const id = fileIdOfAssetName(entry.name)
    if (id === null || referenced.has(id)) continue
    if (now - entry.mtime <= maxAgeMs) continue
    out.push(entry.name)
  }
  return out
}
