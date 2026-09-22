/**
 * A SCENE'S PICTURE — the one renderer behind a saved component's tile (🔒 YAZ-1775 D5, YAZ-1819) and
 * a board's hover preview (🔒 YAZ-1800 D1); only the box differs (`PreviewBounds`).
 * `excalidraw-app/components/SavedComponentPreview.ts` ported, one format later. The web app encoded WebP and threw when the browser could not; this
 * writes PNG, because `<library>/components/<slug>.png` is a file in the user's own folder that
 * Finder, Quick Look and every other reader has to be able to open.
 *
 * A component tile's box is the web app's, unchanged: at most 800 × 600 with the aspect ratio kept,
 * 12 px of padding; every picture draws the background and follows dark mode. A preview, not an export.
 *
 * ENGINE-BOUND BY DESIGN: `exportToBlob` comes in as an argument (`engine.ts`'s lazy rule), which
 * is also what lets a test drive this with a stub instead of a canvas.
 */
import type { ExcalidrawModule } from '../drawings/engine'

const PREVIEW_MIME_TYPE = 'image/png'

/** How big a picture may get: scaled to fit, never up, with this much padding around the scene. */
export interface PreviewBounds {
  maxWidth: number
  maxHeight: number
  padding: number
}

/** A component tile's box — the web app's 800 × 600 and 12 px, unchanged. */
export const COMPONENT_PREVIEW_BOUNDS: PreviewBounds = { maxWidth: 800, maxHeight: 600, padding: 12 }

/** The engine value a preview needs. */
export type PreviewEngine = Pick<ExcalidrawModule, 'exportToBlob'>

/** Scale to fit the bounds (800 × 600 by default), never up; at least one pixel each way. The web app's own function. */
export function previewDimensions(width: number, height: number, bounds: PreviewBounds = COMPONENT_PREVIEW_BOUNDS): { width: number; height: number; scale: number } {
  const scale = Math.min(1, bounds.maxWidth / Math.max(1, width), bounds.maxHeight / Math.max(1, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale }
}

/** A blob to the `data:` URL the bridge carries — bytes cannot cross it any other way. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The preview could not be read'))
    reader.readAsDataURL(blob)
  })
}

/** The elements a picture draws: everything not soft-deleted. None left means there is nothing to draw. */
export function visibleElements<T>(elements: readonly T[]): T[] {
  return elements.filter((element) => !(typeof element === 'object' && element !== null && (element as { isDeleted?: boolean }).isDeleted === true))
}

export interface PreviewScene {
  elements: readonly unknown[]
  /** The board's live appState — the preview follows its theme and its background. */
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

/**
 * The scene drawn to a bounded PNG, as the `data:image/png;base64,…` `components:save` takes — and
 * the sidebar's hover preview shows (YAZ-1800), in its own larger bounds.
 */
export async function createScenePreviewPng(engine: PreviewEngine, scene: PreviewScene, bounds: PreviewBounds = COMPONENT_PREVIEW_BOUNDS): Promise<string> {
  const elements = visibleElements(scene.elements)
  if (elements.length === 0) throw new Error('A preview requires visible elements')
  const blob = await engine.exportToBlob({
    elements: elements as never,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: scene.appState.theme === 'dark' } as never,
    files: scene.files as never,
    exportPadding: bounds.padding,
    getDimensions: (width: number, height: number) => previewDimensions(width, height, bounds),
    mimeType: PREVIEW_MIME_TYPE,
  })
  if (blob.size === 0) throw new Error('The preview could not be drawn')
  return blobToDataUrl(blob)
}
