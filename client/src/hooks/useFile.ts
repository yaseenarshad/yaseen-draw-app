import { useEffect, useState } from 'react'
import type { FileResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'

export type FileState =
  | { status: 'idle' }
  /** `prev` is the previously open file, kept on screen until the new one is ready (no blank flash). */
  | { status: 'loading'; path: string; prev: FileResponse | null }
  | { status: 'ready'; path: string; file: FileResponse }
  | { status: 'error'; path: string; message: string; prev: FileResponse | null }

/**
 * THE ONE DOOR a document's bytes come through (YAZ-919): each `Editor` mount reads here.
 */
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
    api.readFile(path).then(
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
