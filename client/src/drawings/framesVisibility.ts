/**
 * FRAME VISIBILITY (YAZ-1775), the web app's `excalidraw-app/frames/framesVisibility.ts` rule:
 * only the grey box and its NAME LABEL follow the preference. `clip` and `enabled` are
 * deliberately left alone — `enabled: false` would also stop frames clipping their children,
 * which is a change to what the drawing looks like, not to what the editor shows.
 *
 * The web app kept the value in localStorage (`yaseendraw.frames.visible`). 🔒 YAZ-1775 D9 carries the
 * APPLICATION PATH over and drops the key: the value is `SettingsState.canvas.framesVisible`, and
 * this is the only place it reaches the engine — it is not appState, so `prefsToAppState` emits
 * nothing for it and `updateScene` never carries it.
 *
 * The target is a structural pick of the engine's imperative API, so this unit-tests without the
 * package (and without breaking `engine.ts`'s lazy rule).
 */

export interface FrameRenderingTarget {
  updateFrameRendering(rendering: { outline?: boolean; name?: boolean }): void
}

export function applyFramesVisibility(api: FrameRenderingTarget, visible: boolean): void {
  api.updateFrameRendering({ outline: visible, name: visible })
}
