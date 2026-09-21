import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AssetResponse, AssetWriteRequest, AssetWriteResponse } from '@shared/types'
import { IMAGE_EXTENSIONS, MAX_FILE_BYTES } from '@shared/types'
import { atomicWrite, BridgeFailure, byNameCi, fsCall, isSkipped, requireAbsPath, requireDir } from './fsUtils'

/**
 * `window.yaseenDraw.readAsset(root, ref)` / `.writeAsset(req)` (Bases 4E, GRO-2139 — Desktop
 * D10: bridge methods, never routes): the vault's IMAGE pipe. Reads resolve a bare name or path
 * to a local image under `root` and answer its bytes base64-encoded with a mime derived from the
 * extension; writes take image bytes (YAZ-1661). Pure Node, no Electron import.
 *
 * An image is not a supported FILE kind — it lists in the tree with `kind: null` (YAZ-1577 D4)
 * and opens in the OS default app — which is why it has a pipe of its own rather than riding the
 * text read/write capabilities.
 *
 * 🔒 YAZ-1810 NARROWED THIS TO IMAGES. A `.excalidraw` used to be readable and writable here,
 * back when a drawing was a SIDECAR that a note's embed pointed at. A drawing is the DOCUMENT
 * now, and `drawing:load` / `drawing:save` are its one door per direction — the only writer that
 * also knows what to do with the images the scene names. Keeping a second, simpler writer for
 * the same bytes would be a race with no upside.
 */

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

/** The asset pipe's one MIME table, by extension without the dot (any case); unknown → undefined. */
export function mimeFor(ext: string): string | undefined {
  return MIME[ext.toLowerCase()]
}

const READABLE: readonly string[] = IMAGE_EXTENSIONS

/**
 * Obsidian's shortest-path rule, deterministically: breadth-first over the tree (a shallower
 * match always wins), each directory's entries sorted case-insensitively, dot-entries and
 * `node_modules` skipped like every other fs call. First case-insensitive basename match wins.
 */
async function findByBasename(root: string, basename: string): Promise<string | null> {
  const want = basename.toLowerCase()
  let level: string[] = [root]
  while (level.length > 0) {
    const next: string[] = []
    for (const dir of level) {
      const dirents = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => !isSkipped(e.name)).sort(byNameCi)
      for (const e of dirents) {
        if (e.isFile() && e.name.toLowerCase() === want) return path.join(dir, e.name)
      }
      for (const e of dirents) {
        if (e.isDirectory()) next.push(path.join(dir, e.name))
      }
    }
    level = next
  }
  return null
}

/** `rel` resolved against `dir` when it is a regular file INSIDE the vault; null for an escape or a miss. */
async function existingUnderRoot(dir: string, ...rel: string[]): Promise<string | null> {
  const p = path.resolve(dir, ...rel)
  // The vault's edge holds on READS too (YAZ-876 sealed a pre-existing GRO-2139 gap): a ref
  // resolving outside `root` never reaches disk — it falls through to the basename search,
  // which walks only the tree and so cannot leave it.
  if (!p.startsWith(dir + path.sep)) return null
  const st = await stat(p).catch(() => undefined)
  return st?.isFile() ? p : null
}

/**
 * Obsidian's link resolution order (YAZ-1658, YAZ-1656 D1), shared by `readAsset` and the `app://vault`
 * image protocol: (1) relative to the linking note's directory `from` when given — a note's own
 * `./pic.png` must beat a same-named file elsewhere; (2) relative to the root; (3) the
 * shortest-path basename walk above. Steps 1 and 2 require a REGULAR FILE inside the vault;
 * anything escaping `root` skips to the walk, which cannot leave it. `root` is absolute and
 * `target` is the bare link target (alias / heading already stripped). Null = nothing found.
 * Extension policy is the caller's: this only says WHERE a name lands.
 */
export async function resolveAsset(root: string, target: string, from?: string): Promise<string | null> {
  if (target === '') return null
  if (from !== undefined) {
    const viaNote = await existingUnderRoot(root, from, target)
    if (viaNote !== null) return viaNote
  }
  return (await existingUnderRoot(root, target)) ?? findByBasename(root, path.basename(target))
}

export async function readAsset(root: string, ref: string): Promise<AssetResponse> {
  const dir = requireAbsPath(root, 'root')
  if (typeof ref !== 'string') throw new BridgeFailure('BAD_REQUEST', "missing 'ref'")
  // `[[Name|alias#heading]]` spellings are stripped to the bare target the vault stores.
  const target = ref.split('|')[0].split('#')[0].trim()
  if (target === '') throw new BridgeFailure('BAD_REQUEST', "missing 'ref'")
  const ext = path.extname(target).slice(1).toLowerCase()
  const mime = MIME[ext]
  if (mime === undefined || !READABLE.includes(ext)) {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only image files are served as assets', { path: target })
  }
  await requireDir(dir)
  const file = await resolveAsset(dir, target)
  if (file === null) throw new BridgeFailure('NOT_FOUND', 'no asset with this name under the root', { path: target })
  const found = file
  return fsCall(found, async () => {
    const st = await stat(found)
    if (st.size > MAX_FILE_BYTES) throw new BridgeFailure('TOO_LARGE', `file exceeds ${MAX_FILE_BYTES} bytes`, { path: found })
    // `mtime` rides along for `writeAsset`'s `expectedMtime` (YAZ-879): the read that produced
    // the bytes is the only honest place to take the guard from.
    return { path: found, mime, data: (await readFile(found)).toString('base64'), size: st.size, mtime: st.mtimeMs }
  })
}

/**
 * Resolves a vault-relative (or absolute-under-root) write target and REFUSES anything that
 * lands outside `dir`. Reads may roam the tree by basename; a write never leaves the vault.
 */
function resolveUnderRoot(dir: string, rel: string): string {
  const p = path.resolve(dir, rel)
  if (!p.startsWith(dir + path.sep)) throw new BridgeFailure('BAD_REQUEST', 'path escapes the vault root', { path: rel })
  return p
}

/**
 * `window.yaseenDraw.writeAsset(req)` — the write half of the image pipe (YAZ-876, images
 * YAZ-1661 / YAZ-1656 D5; narrowed to images only by 🔒 YAZ-1810). The body is BYTES and the
 * target must be an `IMAGE_EXTENSIONS` path; anything else is `UNSUPPORTED_EXTENSION`, because
 * the mismatch is always a caller bug worth surfacing. The target is an EXPLICIT path — writes
 * are never fuzzy, so `readAsset`'s basename search has no counterpart. Write semantics are
 * `file.ts`'s: atomic tmp+rename, `expectedMtime` → `CONFLICT` with nothing written, and
 * `create` for `createFile`'s never-overwrite `wx`. The request crosses IPC from a sandboxed
 * renderer, so its shape is checked like a request body, not trusted from the type.
 */
export async function writeAsset(req: AssetWriteRequest): Promise<AssetWriteResponse> {
  const raw: unknown = req
  if (typeof raw !== 'object' || raw === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const { root, path: rel, content, expectedMtime, create } = raw as Record<string, unknown>
  const dir = requireAbsPath(root, 'root')
  if (typeof rel !== 'string' || rel.trim() === '' || rel.includes('\0')) throw new BridgeFailure('BAD_REQUEST', "missing 'path'")
  const file = resolveUnderRoot(dir, rel)
  const ext = path.extname(file).slice(1).toLowerCase()
  if (!ArrayBuffer.isView(content)) throw new BridgeFailure('BAD_REQUEST', "'content' must be a Uint8Array", { path: file })
  if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'the image pipe writes image files only', { path: file })
  }
  // The preload hands the renderer's `Uint8Array` to `ipcRenderer.invoke` as-is and structured
  // clone delivers a typed-array view, so "bytes" is any ArrayBuffer view — a `Buffer` included
  // — taken over the view's OWN byte range: a `subarray` must land as its slice, not its
  // backing buffer.
  const body = new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
  const size = body.byteLength
  if (size > MAX_FILE_BYTES) throw new BridgeFailure('TOO_LARGE', `content exceeds ${MAX_FILE_BYTES} bytes`, { path: file })
  if (expectedMtime !== undefined && typeof expectedMtime !== 'number') {
    throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  }
  if (create !== undefined && typeof create !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'create' must be a boolean", { path: file })
  await requireDir(dir)
  if (expectedMtime !== undefined) {
    const st = await stat(file).catch(() => undefined)
    if (st !== undefined && st.mtimeMs !== expectedMtime) {
      throw new BridgeFailure('CONFLICT', 'asset changed on disk since last read', { path: file, mtime: st.mtimeMs })
    }
  }
  return fsCall(file, async () => {
    // An asset's folder is made on the way — unlike `writeFile`, whose parent must already
    // exist: the first pasted image in a vault has no folder to write into.
    await mkdir(path.dirname(file), { recursive: true })
    if (create === true) {
      await writeFile(file, body, { flag: 'wx' }) // EEXIST → ALREADY_EXISTS, exactly like createFile
      const st = await stat(file)
      return { path: file, mtime: st.mtimeMs, size: st.size }
    }
    return { path: file, ...(await atomicWrite(file, body)) }
  })
}
