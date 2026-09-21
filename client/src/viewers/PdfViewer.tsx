import { useEffect, useRef, useState } from 'react'
import { api, BridgeRequestError } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { basename } from '../lib/paths'
import './viewers.css'

export interface PdfViewerProps {
  path: string
  watch: WatchSource
}

/** Structured-cloned bridge bytes are ArrayBuffer-backed; retain their exact view for Blob. */
function pdfBlobPart(data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}

/** Read-only owner for PDFs rendered by Chromium's native PDF plugin. */
export function PdfViewer({ path, watch }: PdfViewerProps) {
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState<{ path: string; url: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const owned = useRef<{ path: string; url: string } | null>(null)

  useEffect(
    () =>
      watch.subscribe((event) => {
        if (event.type === 'change' && event.path === path) setRevision((current) => current + 1)
      }),
    [path, watch],
  )

  useEffect(
    () => () => {
      if (owned.current !== null) URL.revokeObjectURL(owned.current.url)
      owned.current = null
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    if (owned.current !== null && owned.current.path !== path) {
      URL.revokeObjectURL(owned.current.url)
      owned.current = null
      setView(null)
    }
    setLoading(true)
    setError(null)
    void api.readPdf(path).then(
      (file) => {
        if (cancelled) return
        const next = { path, url: URL.createObjectURL(new Blob([pdfBlobPart(file.data)], { type: 'application/pdf' })) }
        const previous = owned.current
        owned.current = next
        setView(next)
        setLoading(false)
        if (previous !== null) URL.revokeObjectURL(previous.url)
      },
      (err: unknown) => {
        if (cancelled) return
        setError(err instanceof BridgeRequestError ? `${err.code}: ${err.message}` : 'Failed to load PDF')
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [path, revision])

  const url = view?.path === path ? view.url : null

  return (
    <div className="pdf-viewer" aria-busy={loading}>
      {loading && url === null && <p className="editor-msg">Loading…</p>}
      {error !== null && <p className="pdf-viewer__error" role="status">{error}</p>}
      {url !== null && <iframe className="pdf-viewer__frame" src={url} title={basename(path)} />}
    </div>
  )
}
