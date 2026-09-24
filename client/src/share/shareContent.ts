/**
 * THE BYTES A SHARE UPLOADS (YAZ-1799 D3): the SAME standalone `.excalidraw` File › Export Drawing…
 * writes — `assembleStandaloneScene`, images embedded, files named only by deleted elements left
 * out — so a shared board and an exported one are the same document.
 *
 * Built from what is ON DISK, not from a live canvas: Share can be started from the sidebar on a
 * board that is not open. An open board is flushed first (the rename path's `flushRenamedPath`),
 * so unsaved edits are in the snapshot — except when `liveShare.ts` calls it right after a save
 * (`flush: false`), where the disk is already that new. Main checks the size and uploads; it never assembles.
 *
 * A draw.io diagram is shared as its `.drawio` XML exactly as saved (🔒 YAZ-1802 D11): its pictures
 * already live inside it, so there is nothing to assemble.
 */
import { isDiagram } from '@shared/fileKind'
import { api } from '../api'
import { assembleStandaloneScene } from '../drawings/exportDrawing'
import { parseSceneText } from '../drawings/drawingScene'
import { loadExcalidraw } from '../drawings/engine'
import { flushRenamedPath } from '../lib/renameContinuity'

export async function buildShareContent(root: string, path: string, { flush = true }: { flush?: boolean } = {}): Promise<string> {
  if (flush) await flushRenamedPath(path)
  if (isDiagram(path)) return (await api.diagram.load({ root, path })).xml
  const [doc, mod] = await Promise.all([api.drawing.load({ root, path }), loadExcalidraw()])
  const parsed = parseSceneText(doc.json)
  const elements = mod.restoreElements(parsed.elements as Parameters<typeof mod.restoreElements>[0], null)
  // The engine's own `BinaryFileData` shape — exactly what the live canvas's map holds when Export
  // Drawing runs (`DrawingEditor`'s `toDocument` does the same) — so the two files match.
  const created = Date.now()
  const files: Record<string, unknown> = {}
  for (const [id, entry] of Object.entries(doc.files)) files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  return assembleStandaloneScene(mod, { elements, appState: (parsed.appState ?? {}) as Record<string, unknown>, files })
}
