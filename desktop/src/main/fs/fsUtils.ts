import { randomBytes } from 'node:crypto'
import { readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BridgeError, TreeNode } from '@shared/types'
import { fileKind, isDrawing } from '@shared/fileKind'

/**
 * Thrown by the fs layer; `ipc/envelope.ts` turns it into the `BridgeError` the renderer sees.
 * Carries a `BridgeError` code plus the optional `path` / `mtime` the renderer shows.
 */
export class BridgeFailure extends Error {
  readonly path?: string
  /** Current on-disk mtime; only on `CONFLICT`. */
  readonly mtime?: number
  constructor(
    readonly code: BridgeError['code'],
    message: string,
    extra: { path?: string; mtime?: number } = {},
  ) {
    super(message)
    this.path = extra.path
    this.mtime = extra.mtime
  }
}

function isSafeAbsPath(p: unknown): p is string {
  return typeof p === 'string' && path.isAbsolute(p) && !p.includes('\0')
}

/** Validates + normalises a path argument, throwing BAD_REQUEST / NOT_ABSOLUTE when missing/relative. */
export function requireAbsPath(p: unknown, param: string): string {
  if (p === undefined || p === '') {
    throw new BridgeFailure('BAD_REQUEST', `missing '${param}'`)
  }
  if (!isSafeAbsPath(p)) {
    throw new BridgeFailure('NOT_ABSOLUTE', `'${param}' must be an absolute path`, { path: String(p) })
  }
  return path.resolve(p)
}

/** Throws unless `p` has the only editable/creatable extension kind. */
export function requireDrawingFile(p: string): void {
  if (!isDrawing(p)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .excalidraw files are editable', { path: p })
}

/** Dot-entries and node_modules are invisible to every call. */
export function isSkipped(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

function byNameCi<T extends { name: string }>(a: T, b: T): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined
}

/** Maps a Node fs error to a BridgeFailure for `p`. */
export function toBridgeFailure(err: unknown, p: string): BridgeFailure {
  if (err instanceof BridgeFailure) return err
  switch (errnoCode(err)) {
    case 'ENOENT':
      return new BridgeFailure('NOT_FOUND', 'path does not exist', { path: p })
    case 'EACCES':
    case 'EPERM':
      return new BridgeFailure('FORBIDDEN', 'permission denied', { path: p })
    case 'ENOTDIR':
      return new BridgeFailure('NOT_A_DIRECTORY', 'expected a directory', { path: p })
    case 'EEXIST':
      return new BridgeFailure('ALREADY_EXISTS', 'path already exists', { path: p })
    case 'EISDIR':
      return new BridgeFailure('NOT_A_FILE', 'expected a file', { path: p })
    default:
      return new BridgeFailure('IO_ERROR', err instanceof Error ? err.message : String(err), { path: p })
  }
}

/** Runs `fn`, converting any fs error into a BridgeFailure attributed to `p`. */
export async function fsCall<T>(p: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toBridgeFailure(err, p)
  }
}

/** Throws NOT_FOUND / FORBIDDEN / NOT_A_DIRECTORY unless `dir` is a readable directory. */
export async function requireDir(dir: string): Promise<void> {
  await fsCall(dir, async () => {
    if (!(await stat(dir)).isDirectory()) throw new BridgeFailure('NOT_A_DIRECTORY', 'expected a directory', { path: dir })
  })
}

/**
 * Recursive tree of every regular file under `dir`, each carrying its preview `kind` (`null` = no
 * in-app viewer, YAZ-1577 D1). Dirs first, then files, each sorted case-insensitively; every dir
 * shows even when empty, so freshly created folders are visible (GRO-2022 D1). Dot-entries and
 * `node_modules` are skipped; unreadable subdirs are skipped.
 */
export async function buildTree(dir: string): Promise<TreeNode[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const dirs: TreeNode[] = []
  const files: TreeNode[] = []
  await Promise.all(
    entries.map(async (e) => {
      if (isSkipped(e.name)) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        const children = await buildTree(full).catch(() => null)
        if (children !== null) dirs.push({ type: 'dir', name: e.name, path: full, children })
      } else if (e.isFile()) {
        const st = await stat(full).catch(() => undefined)
        if (st) files.push({ type: 'file', name: e.name, path: full, size: st.size, mtime: st.mtimeMs, kind: fileKind(e.name) })
      }
    }),
  )
  return [...dirs.sort(byNameCi), ...files.sort(byNameCi)]
}

/**
 * Writes `content` to `<file>.tmp-<rand>` then renames over `file`. Parent dir must exist.
 * A string lands as UTF-8; bytes (a scene's images through `drawing:save`, 🔒 YAZ-1775 D3) land verbatim —
 * `writeFile` ignores the encoding for a view, so one call serves both.
 */
export async function atomicWrite(file: string, content: string | Uint8Array): Promise<{ mtime: number; size: number }> {
  const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, file)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
  const st = await stat(file)
  return { mtime: st.mtimeMs, size: st.size }
}
