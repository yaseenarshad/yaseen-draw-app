import { mkdir, stat, writeFile } from 'node:fs/promises'
import type { CreateDirResponse, CreateFileRequest, CreateFileResponse } from '@shared/types'
import { isDrawing } from '@shared/fileKind'
import { stampBoardMeta } from '@shared/drawingAssets'
import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'

/**
 * Creation calls for the sidebar's "New folder" / "New drawing" (GRO-2022).
 * The object form's `content` (Bible B, GRO-2202) rides the same `wx` write — content-at-create,
 * no create-then-write race, which is how "New drawing" is born with an EMPTY SCENE rather than
 * as a zero-byte file (🔒 YAZ-1810: an empty `.excalidraw` is the corrupt case, not a new
 * board). Omitting `content` still writes an empty file; nothing in the app does. Existence races resolve at
 * the fs layer: mkdir and `wx` writes throw EEXIST, which `toBridgeFailure` maps to
 * ALREADY_EXISTS — nothing is ever overwritten.
 *
 * A drawing is BORN STAMPED (🔒 YAZ-1834 D3): its `yaseendraw` block — `createdAt` and
 * `updatedAt`, both "now" — is placed first in the content before the same `wx` write, so no
 * board main creates ever exists without its dates. Content that is not a JSON object is refused
 * `BAD_REQUEST` before anything is touched. Empty content stays empty (nothing sends it).
 */
export async function createDir(path: string): Promise<CreateDirResponse> {
  const p = requireAbsPath(path, 'path')
  await fsCall(p, () => mkdir(p))
  return { path: p }
}

export async function createFile(req: string | CreateFileRequest): Promise<CreateFileResponse> {
  // Crosses IPC from a sandboxed renderer: shape-checked like a request body (writeFile's posture).
  const raw: unknown = req
  const isReq = typeof raw === 'object' && raw !== null
  const p = requireAbsPath(isReq ? (raw as Record<string, unknown>).path : raw, 'path')
  if (!isDrawing(p)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .excalidraw files can be created', { path: p })
  const content = isReq ? (raw as Record<string, unknown>).content : undefined
  if (content !== undefined && typeof content !== 'string') throw new BridgeFailure('BAD_REQUEST', "'content' must be a string", { path: p })
  const now = Date.now()
  let body = ''
  if (content !== undefined && content !== '') {
    try {
      body = stampBoardMeta(content, { createdAt: now, updatedAt: now })
    } catch {
      throw new BridgeFailure('BAD_REQUEST', "'content' must be an Excalidraw scene", { path: p })
    }
  }
  return fsCall(p, async () => {
    await writeFile(p, body, { flag: 'wx' })
    const st = await stat(p)
    return { path: p, mtime: st.mtimeMs, size: st.size }
  })
}
