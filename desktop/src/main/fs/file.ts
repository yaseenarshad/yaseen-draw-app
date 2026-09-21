import { stat } from 'node:fs/promises'
import type { FileResponse, FileWriteRequest, FileWriteResponse } from '@shared/types'
import { MAX_FILE_BYTES } from '@shared/types'
import { BridgeFailure, atomicWrite, fsCall, requireAbsPath, requireMarkdownFile, requireTextReadableFile } from './fsUtils'
import { readBoundedRegularFile } from './boundedRead'

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function decodeViewOnlyText(bytes: Uint8Array, path: string): string {
  let content: string
  try {
    content = strictUtf8.decode(bytes)
  } catch {
    throw new BridgeFailure('IO_ERROR', 'file is not valid UTF-8 text', { path })
  }
  if (content.includes('\0')) throw new BridgeFailure('IO_ERROR', 'text file contains NUL bytes', { path })
  return content
}

/** Reads Markdown with its legacy UTF-8 semantics or approved view-only text with strict UTF-8 decoding. */
export async function readFile(path: string): Promise<FileResponse> {
  const p = requireAbsPath(path, 'path')
  const kind = requireTextReadableFile(p)
  const snapshot = await readBoundedRegularFile(p, MAX_FILE_BYTES, `file exceeds ${MAX_FILE_BYTES} bytes`)
  const content = kind === 'markdown' ? snapshot.data.toString('utf8') : decodeViewOnlyText(snapshot.data, p)
  return { path: p, content, mtime: snapshot.mtime, size: snapshot.size }
}

/**
 * `window.yaseenDocs.writeFile(req)`. Atomic (tmp + rename),
 * parent dir must exist. With `expectedMtime`, a newer file on disk rejects `CONFLICT` carrying
 * the current mtime and nothing is written. The request crosses IPC from a sandboxed renderer,
 * so its shape is checked like a request body, not trusted from the type.
 */
export async function writeFile(req: FileWriteRequest): Promise<FileWriteResponse> {
  const raw: unknown = req
  if (typeof raw !== 'object' || raw === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const { path, content, expectedMtime } = raw as Record<string, unknown>
  const p = requireAbsPath(path, 'path')
  requireMarkdownFile(p)
  if (typeof content !== 'string') throw new BridgeFailure('BAD_REQUEST', "'content' must be a string", { path: p })
  if (expectedMtime !== undefined && typeof expectedMtime !== 'number') {
    throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: p })
  }
  if (expectedMtime !== undefined) {
    const st = await stat(p).catch(() => undefined)
    if (st !== undefined && st.mtimeMs !== expectedMtime) {
      throw new BridgeFailure('CONFLICT', 'file changed on disk since last read', { path: p, mtime: st.mtimeMs })
    }
  }
  const { mtime, size } = await fsCall(p, () => atomicWrite(p, content))
  return { path: p, mtime, size }
}
