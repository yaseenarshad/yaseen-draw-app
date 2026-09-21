import type { ZoomStep } from '@shared/types'

/**
 * ⌘+ / ⌘− / ⌘0 (YAZ-1710): the menu sends a step; the renderer decides where it lands. A
 * bubbling event leaves the focused element, and the note whose section contains the focus
 * claims it with `preventDefault` (see `Editor.tsx`). Nobody claimed it — focus is in the
 * sidebar, a dialog, or nowhere — so the whole app zooms, as the stock roles used to.
 */
export const ZOOM_EVENT = 'yaseendocs:zoom'

export function requestZoom(step: ZoomStep): void {
  const event = new CustomEvent<ZoomStep>(ZOOM_EVENT, { detail: step, bubbles: true, cancelable: true })
  ;(document.activeElement ?? document.body).dispatchEvent(event)
  if (!event.defaultPrevented) void window.yaseenDocs.window.zoom(step)
}
