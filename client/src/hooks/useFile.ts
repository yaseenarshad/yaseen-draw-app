import { useEffect, useState } from 'react'
import { fileKind } from '@shared/fileKind'
import type { FileResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { migrateFolderBody } from '../views/migrateFolderBody'

export type FileState =
  | { status: 'idle' }
  /** `prev` is the previously open file, kept on screen until the new one is ready (no blank flash). */
  | { status: 'loading'; path: string; prev: FileResponse | null }
  | { status: 'ready'; path: string; file: FileResponse }
  | { status: 'error'; path: string; message: string; prev: FileResponse | null }

/**
 * THE ONE DOOR Markdown and supported text bytes come through (YAZ-919): each eligible `Editor`
 * mount reads here, and the kind guard below asks for folder-page migration only for Markdown.
 *
 * The migrated bytes go to disk BEFORE the editor sees them, and the editor is handed the mtime
 * of THAT write: autosave attaches to `file.mtime` and suppresses the watcher echo by comparing
 * against it, so a stale one would surface our own write as a "file changed on disk" conflict.
 * A failed write hands back the file exactly as read — nothing is lost, the body is still there,
 * and the next open tries again. Unchanged is free: no write, no second read.
 */
async function migrateOnOpen(file: FileResponse): Promise<FileResponse> {
  if (fileKind(file.path) !== 'markdown') return file
  const { content, changed } = migrateFolderBody(file.content)
  if (!changed) return file
  try {
    const written = await api.writeFile({ path: file.path, content, expectedMtime: file.mtime })
    return { ...file, content, mtime: written.mtime, size: written.size }
  } catch {
    return file
  }
}

/** Loads once per path/revision; a revision refresh retains the last readable snapshot. */
export function useFile(path: string | null, revision = 0): FileState {
  const [state, setState] = useState<FileState>({ status: 'idle' })
  useEffect(() => {
    if (path === null) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState((current) => ({
      status: 'loading',
      path,
      prev: current.status === 'ready' ? current.file : current.status === 'loading' || current.status === 'error' ? current.prev : null,
    }))
    api.readFile(path).then(migrateOnOpen).then(
      (file) => {
        if (!cancelled) setState({ status: 'ready', path, file })
      },
      (err: unknown) => {
        if (cancelled) return
        const message = err instanceof BridgeRequestError ? `${err.code}: ${err.message}` : 'Failed to load file'
        setState((current) => ({
          status: 'error',
          path,
          message,
          prev: current.status === 'loading' && current.path === path ? current.prev : null,
        }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [path, revision])
  return state
}
