/**
 * THE PRESENTING CAMERA (YAZ-1820): `excalidraw-app/presentation/camera.ts` ported.
 *
 * Every `setViewport` the player makes carries these offsets, so a slide is fitted the same way
 * whichever gesture asked for it — start, ← →, Home / End, a double-click, a resize, or the Esc
 * deck view.
 */

/**
 * Fraction of the canvas pane kept clear on the right while presenting, so a presenter's camera
 * feed can sit there during a recording. The web app's own ratio, and always on — there is no
 * toggle.
 */
export const PRESENTATION_CAMERA_RESERVE = 0.32

/**
 * The measured editor UI (`ui`) for the sides we do not own, plus a static right inset holding the
 * camera strip. A static side REPLACES the UI-derived one rather than adding to it, which is what
 * we want here: the reserve is wider than any chrome it hides behind.
 *
 * ⚡ THE WIDTH IS THE CANVAS PANE'S, NOT THE WINDOW'S. The web app owned the whole window, so it
 * measured `window.innerWidth`; this shell keeps a file sidebar and a tab strip beside the canvas,
 * and a fraction of the window would reserve a strip that is partly not on the canvas at all.
 */
export function getPresentationViewportOffsets(paneWidth: number): { ui: true; right: number } {
  return { ui: true, right: Math.round(Math.max(0, paneWidth) * PRESENTATION_CAMERA_RESERVE) }
}
