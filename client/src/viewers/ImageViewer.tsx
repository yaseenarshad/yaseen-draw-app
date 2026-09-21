import { useEffect, useRef, useState } from 'react'
import { api, BridgeRequestError } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { basename } from '../lib/paths'
import './viewers.css'

export interface ImageViewerProps {
  path: string
  watch: WatchSource
}

/** Structured-cloned bridge bytes are ArrayBuffer-backed; retain their exact view for Blob. */
function imageBlobPart(data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}

/** Read-only raster owner: exact bytes → browser decode → one static canvas frame. */
export function ImageViewer({ path, watch }: ImageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paintedPathRef = useRef<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [paintedPath, setPaintedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      watch.subscribe((event) => {
        if (event.type === 'change' && event.path === path) setRevision((current) => current + 1)
      }),
    [path, watch],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    if (paintedPathRef.current !== path) {
      paintedPathRef.current = null
      setPaintedPath(null)
    }

    void (async () => {
      try {
        const file = await api.readImage(path)
        if (cancelled) return
        const decoded = await createImageBitmap(new Blob([imageBlobPart(file.data)], { type: file.mime }))
        try {
          if (cancelled) return
          const canvas = canvasRef.current
          const context = canvas?.getContext('2d')
          if (canvas === null || context === null || context === undefined) throw new Error('canvas unavailable')
          canvas.width = decoded.width
          canvas.height = decoded.height
          context.drawImage(decoded, 0, 0)
          paintedPathRef.current = path
          setPaintedPath(path)
          setLoading(false)
        } finally {
          decoded.close()
        }
      } catch (err: unknown) {
        if (cancelled) return
        setError(err instanceof BridgeRequestError ? `${err.code}: ${err.message}` : 'Failed to decode image')
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [path, revision])

  const ready = paintedPath === path
  return (
    <div className="image-viewer" aria-busy={loading}>
      <header className="image-viewer__header">
        <span className="image-viewer__name" title={path}>{basename(path)}</span>
        <span className="image-viewer__badge">Read only</span>
      </header>
      {error !== null && <p className="image-viewer__error" role="status">{error}</p>}
      <div className="image-viewer__stage">
        {loading && !ready && <p className="editor-msg">Loading…</p>}
        <canvas ref={canvasRef} className="image-viewer__canvas" hidden={!ready} aria-label={basename(path)} />
      </div>
    </div>
  )
}
