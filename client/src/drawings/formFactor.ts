/**
 * WHAT THE ENGINE IS TOLD ABOUT ITS OWN SIZE (YAZ-1775 ⚡ R5).
 *
 * Left to itself the engine calls any editor whose LARGER side is ≤ 1180 px a "tablet"
 * (`isTabletBreakpoint`, `packages/common/src/editorInterface.ts:72-79`), and a tablet is forced
 * into upstream's `compact` styles-panel mode — the vertical icon strip with popovers
 * (`LayerUI.tsx:242`), not Yasin's horizontal `ContextualPropertiesToolbar` (`LayerUI.tsx:575`,
 * the fork's `full` desktop mode). With the shell sidebar open this pane is often under that
 * width, which is exactly why the strip kept appearing. The web app never hit it: its canvas
 * filled the browser window.
 *
 * The engine offers `UIOptions.getFormFactor(editorWidth, editorHeight)` (`types.ts:1066-1073`)
 * for a host to answer instead. This app answers `desktop` for anything that is not phone-sized
 * and NEVER `tablet`, so the fork's `full` mode is the one layout a drawing ever gets.
 *
 * The phone rule is the engine's own `isMobileBreakpoint` (`editorInterface.ts:64-70`): width ≤
 * `MQ_MAX_MOBILE` (599), or a landscape sliver shorter than `MQ_MAX_HEIGHT_LANDSCAPE` (500) and
 * narrower than `MQ_MAX_WIDTH_LANDSCAPE` (1000). The numbers are COPIED rather than imported:
 * `@excalidraw/common` is part of the engine tree, and a static import would drag the whole
 * package into the renderer's entry chunk (the LAZY rule in `engine.ts`).
 */

export const MQ_MAX_MOBILE = 599
export const MQ_MAX_WIDTH_LANDSCAPE = 1000
export const MQ_MAX_HEIGHT_LANDSCAPE = 500

export type FormFactor = 'phone' | 'tablet' | 'desktop'

/** The engine's own phone test (`isMobileBreakpoint`), verbatim. */
export function isPhoneSized(width: number, height: number): boolean {
  return width <= MQ_MAX_MOBILE || (height < MQ_MAX_HEIGHT_LANDSCAPE && width < MQ_MAX_WIDTH_LANDSCAPE)
}

/** `UIOptions.getFormFactor`: phone when phone-sized, otherwise desktop — never `tablet`. */
export function yaseenFormFactor(editorWidth: number, editorHeight: number): FormFactor {
  return isPhoneSized(editorWidth, editorHeight) ? 'phone' : 'desktop'
}
