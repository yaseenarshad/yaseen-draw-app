/**
 * A BOARD'S HOVER PICTURE (YAZ-1800): the whole drawing, drawn in the renderer the first time the
 * mouse rests on its sidebar row and kept IN MEMORY only — nothing is written to the vault or to
 * userData. The key carries the board's mtime and the applied theme, so any write or a theme flip
 * is simply a new key; the old picture ages out of the bounded cache.
 *
 * An EMPTY board answers `''` — a settled answer, not a failure — so the panel can say "Empty
 * board" instead of "Preview unavailable". A board that cannot be read or drawn is the cache's
 * `null`.
 */
import type { FileNode } from '@shared/treeSort'
import { api } from '../api'
import { createScenePreviewPng, visibleElements, type PreviewBounds } from '../lib/scenePreview'
import { parseSceneText } from '../drawings/drawingScene'
import { loadExcalidraw } from '../drawings/engine'
import { createPreviewCache } from '../lib/previewCache'

/** Bigger than a component tile: the panel is most of the window, and a retina screen doubles it. */
export const BOARD_PREVIEW_BOUNDS: PreviewBounds = { maxWidth: 1200, maxHeight: 800, padding: 16 }

/**
 * One cache key per board, per write, per theme. The mtime, not the board's `updatedAt` block (🔒 D1
 * amendment): every write moves it, a sync or an outside editor included; the block's one advantage,
 * surviving a clone, means nothing to a cache that lives in memory. Newline-separated because a path
 * can hold ':' — the root and the theme sit at the two ends, so a path is whatever lies between.
 */
export function boardPreviewKey(root: string, node: FileNode, theme: 'light' | 'dark'): string {
  return [root, node.path, node.mtime, theme].join('\n')
}

/** The key back into its parts (see `boardPreviewKey`). */
function parseKey(key: string): { root: string; path: string; theme: 'light' | 'dark' } {
  const parts = key.split('\n')
  return { root: parts[0], path: parts.slice(1, -2).join('\n'), theme: parts[parts.length - 1] === 'dark' ? 'dark' : 'light' }
}

/** Read the board, restore it the way the canvas would, and draw it; `''` when nothing is visible. */
async function drawBoardPreview(key: string): Promise<string> {
  const { root, path, theme } = parseKey(key)
  const [res, engine] = await Promise.all([api.drawing.load({ root, path }), loadExcalidraw()])
  const parsed = parseSceneText(res.json)
  const elements = visibleElements(engine.restoreElements(parsed.elements as never, null))
  if (elements.length === 0) return ''
  // The image map exactly as the editor builds it (`DrawingEditor`'s `toDocument`).
  const files: Record<string, unknown> = {}
  const created = Date.now()
  for (const [id, entry] of Object.entries(res.files)) files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  // The file's own appState (its background colour) with the APP's theme on top: the panel sits in the app's chrome.
  return createScenePreviewPng(engine, { elements, appState: { ...parsed.appState, theme }, files }, BOARD_PREVIEW_BOUNDS)
}

/** The sidebar's one board-picture cache; 32 settled pictures, least recently seen out first. */
export const boardPreviews = createPreviewCache(drawBoardPreview, { limit: 32 })
