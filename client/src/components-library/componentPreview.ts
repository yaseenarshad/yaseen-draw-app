/**
 * A COMPONENT'S PICTURE (🔒 D5, YAZ-1819): `excalidraw-app/components/SavedComponentPreview.ts`
 * ported, one format later. The web app encoded WebP and threw when the browser could not; this
 * writes PNG, because `<library>/components/<slug>.png` is a file in the user's own folder that
 * Finder, Quick Look and every other reader has to be able to open.
 *
 * The bounded size is the web app's, unchanged: at most 800 × 600 with the aspect ratio kept, 12 px
 * of padding, the board's background drawn, dark mode followed. A preview is a tile, not an export.
 *
 * ENGINE-BOUND BY DESIGN: `exportToBlob` comes in as an argument (`engine.ts`'s lazy rule), which
 * is also what lets a test drive this with a stub instead of a canvas.
 */
import type { ExcalidrawModule } from '../drawings/engine'

export const PREVIEW_MAX_WIDTH = 800
export const PREVIEW_MAX_HEIGHT = 600
export const PREVIEW_PADDING = 12
export const PREVIEW_MIME_TYPE = 'image/png'

/** The engine value a preview needs. */
export type PreviewEngine = Pick<ExcalidrawModule, 'exportToBlob'>

/** Scale to fit 800 × 600, never up; at least one pixel each way. The web app's own function. */
export function componentPreviewDimensions(width: number, height: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, PREVIEW_MAX_WIDTH / Math.max(1, width), PREVIEW_MAX_HEIGHT / Math.max(1, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale }
}

/** A blob to the `data:` URL the bridge carries — bytes cannot cross it any other way. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The component preview could not be read'))
    reader.readAsDataURL(blob)
  })
}

export interface ComponentPreviewScene {
  elements: readonly unknown[]
  /** The board's live appState — the preview follows its theme and its background. */
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

/** The component drawn to a bounded PNG, as the `data:image/png;base64,…` `components:save` takes. */
export async function createComponentPreviewPng(engine: PreviewEngine, scene: ComponentPreviewScene): Promise<string> {
  const elements = scene.elements.filter((element) => !(typeof element === 'object' && element !== null && (element as { isDeleted?: boolean }).isDeleted === true))
  if (elements.length === 0) throw new Error('A component preview requires visible elements')
  const blob = await engine.exportToBlob({
    elements: elements as never,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: scene.appState.theme === 'dark' } as never,
    files: scene.files as never,
    exportPadding: PREVIEW_PADDING,
    getDimensions: componentPreviewDimensions,
    mimeType: PREVIEW_MIME_TYPE,
  })
  if (blob.size === 0) throw new Error('The component preview could not be drawn')
  return blobToDataUrl(blob)
}
