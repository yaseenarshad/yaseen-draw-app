/**
 * THE VIEWER'S SCRIPT (YAZ-1799), bundled by `tools/buildShareViewer.mjs` into
 * `share/dist/assets/viewer.js` + `viewer.css` — React and the SAME vendored Excalidraw fork the
 * desktop app draws with — and served by the Worker from its own static assets. Nothing is
 * fetched from a third-party CDN at view time: the fonts come from `/assets/fonts/` too.
 */
// First import, so the asset path is set before Excalidraw's modules evaluate (the page may run no inline script).
import './assetPath.js'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

const { id, allowDownload, name, updatedAt } = JSON.parse(document.getElementById('board').textContent)
if (updatedAt > 0) document.getElementById('meta').textContent = `${allowDownload ? 'View and download' : 'View only'} · updated ${new Date(updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
const note = document.getElementById('note')
const safeName = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'drawing'
const PNG_SCALE = 2

function save(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

async function main() {
  let text
  try {
    const res = await fetch(`/scene/${id}`, { cache: 'no-store' })
    if (res.status === 404) {
      location.reload()
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    text = await res.text()
  } catch (err) {
    note.textContent = 'This drawing could not be loaded. The link may have just been stopped.'
    throw err
  }
  const scene = JSON.parse(text)
  const elements = (scene.elements ?? []).filter((el) => !el.isDeleted)
  const files = scene.files ?? {}
  const viewBackgroundColor = scene.appState?.viewBackgroundColor ?? '#ffffff'

  if (allowDownload) {
    // The real download route: the Worker refuses it (403) if the owner turned downloads off since this page loaded.
    document.getElementById('dl-excalidraw').onclick = async () => {
      const res = await fetch(`/raw/${id}?download=1`, { cache: 'no-store' })
      if (!res.ok) return alert(res.status === 403 ? 'The owner turned off downloads for this drawing.' : `Download failed (HTTP ${res.status}).`)
      save(await res.blob(), `${safeName}.excalidraw`)
    }
    const pngButton = document.getElementById('dl-png')
    pngButton.disabled = elements.length === 0
    pngButton.title = elements.length === 0 ? 'This drawing is empty' : ''
    pngButton.onclick = async () => {
      pngButton.disabled = true
      try {
        // 2× for real: `exportScale` in appState is ignored by exportToBlob; getDimensions is what sizes the canvas.
        const blob = await exportToBlob({
          elements,
          files,
          mimeType: 'image/png',
          exportPadding: 24,
          appState: { exportBackground: true, viewBackgroundColor, exportWithDarkMode: false },
          getDimensions: (width, height) => ({ width: width * PNG_SCALE, height: height * PNG_SCALE, scale: PNG_SCALE }),
        })
        save(blob, `${safeName}.png`)
      } catch (err) {
        alert(`Could not make a PNG of this drawing: ${err?.message ?? err}`)
      } finally {
        pngButton.disabled = false
      }
    }
  }

  note.remove()
  createRoot(document.getElementById('canvas')).render(
    React.createElement(Excalidraw, {
      initialData: { elements, files, appState: { viewBackgroundColor, theme: 'light' }, scrollToContent: true },
      viewModeEnabled: true,
      zenModeEnabled: false,
      gridModeEnabled: false,
      name,
      // Open fitted to the drawing (never past 100%), like the desktop app does.
      onExcalidrawAPI: (api) => fit(api, elements),
      UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false }, tools: { image: false } },
    }),
  )
}

let fitted = false
function fit(api, elements) {
  if (fitted || api === null || elements.length === 0) return
  fitted = true
  requestAnimationFrame(() => {
    api.scrollToContent(undefined, { fitToContent: true, animate: false })
    if (api.getAppState().zoom.value > 1) {
      api.updateScene({ appState: { zoom: { value: 1 } } })
      api.scrollToContent(undefined, { animate: false })
    }
  })
}

void main()
