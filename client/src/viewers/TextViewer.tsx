import { useEffect, useState } from 'react'
import { useFile } from '../hooks/useFile'
import type { WatchSource } from '../hooks/useWatch'
import { basename } from '../lib/paths'
import './viewers.css'

export interface TextViewerProps {
  path: string
  watch: WatchSource
}

/** Read-only owner for supported UTF-8 text files. */
export function TextViewer({ path, watch }: TextViewerProps) {
  const [revision, setRevision] = useState(0)
  useEffect(
    () =>
      watch.subscribe((event) => {
        if (event.type === 'change' && event.path === path) setRevision((current) => current + 1)
      }),
    [path, watch],
  )
  const state = useFile(path, revision)
  const candidate = state.status === 'ready'
    ? state.file
    : state.status === 'loading' || state.status === 'error'
      ? state.prev
      : null
  const file = candidate?.path === path ? candidate : null
  return (
    <div className="text-viewer" aria-busy={state.status === 'loading'}>
      <header className="text-viewer__header">
        <span className="text-viewer__name" title={path}>{basename(path)}</span>
        <span className="text-viewer__badge">Read only</span>
      </header>
      {state.status === 'loading' && file === null && <p className="editor-msg">Loading…</p>}
      {state.status === 'error' && <p className="text-viewer__error" role="status">{state.message}</p>}
      {file !== null && (
        <div className="text-viewer__scroll">
          <pre className="text-viewer__content" role="textbox" aria-readonly="true" aria-multiline="true" tabIndex={0}>
            {file.content}
          </pre>
        </div>
      )}
    </div>
  )
}
