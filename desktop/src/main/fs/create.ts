import { mkdir, stat, writeFile } from 'node:fs/promises'
import type { CreateDirResponse, CreateFileRequest, CreateFileResponse } from '@shared/types'
import { isMarkdown } from '@shared/fileKind'
import { BridgeFailure, fsCall, requireAbsPath } from './fsUtils'

/**
 * Creation calls for the sidebar's "New folder" / "New note" (GRO-2022).
 * Markdown files are created empty. The object form's `content` (Bible B, GRO-2202) rides the
 * same `wx` write — content-at-create, no create-then-write race. Existence races resolve at
 * the fs layer: mkdir and `wx` writes throw EEXIST, which `toBridgeFailure` maps to
 * ALREADY_EXISTS — nothing is ever overwritten.
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
  if (!isMarkdown(p)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .md/.markdown files can be created', { path: p })
  const content = isReq ? (raw as Record<string, unknown>).content : undefined
  if (content !== undefined && typeof content !== 'string') throw new BridgeFailure('BAD_REQUEST', "'content' must be a string", { path: p })
  return fsCall(p, async () => {
    await writeFile(p, content ?? '', { flag: 'wx' })
    const st = await stat(p)
    return { path: p, mtime: st.mtimeMs, size: st.size }
  })
}
