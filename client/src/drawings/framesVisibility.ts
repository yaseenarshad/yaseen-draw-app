/**
 * FRAME VISIBILITY, the web app's rule: only the grey box and its NAME LABEL follow the
 * preference. `clip` and `enabled` are deliberately left alone — `enabled: false` would also stop
 * frames clipping their children, which changes what the DRAWING looks like, not what the editor
 * shows. The value is `SettingsState.canvas.framesVisible` (🔒 YAZ-1775 D9) and this is the only
 * place it reaches the engine: it is not appState, so `updateScene` never carries it.
 */

export interface FrameRenderingTarget {
  updateFrameRendering(rendering: { outline?: boolean; name?: boolean }): void
}

export function applyFramesVisibility(api: FrameRenderingTarget, visible: boolean): void {
  api.updateFrameRendering({ outline: visible, name: visible })
}
