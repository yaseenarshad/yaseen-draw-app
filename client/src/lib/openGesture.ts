/**
 * The one open rule for a folder page's Table and Board (YAZ-1557), mouse and keyboard alike:
 * plain → the current tab, ⌘ → a background tab (the app-wide I3 rule, GRO-2235), ⌥ → the right
 * panel. ⇧ is the selection gesture everywhere (YAZ-1336 🔒 D2) and ⌃ is unclaimed, so either
 * vetoes the open: the surface then does whatever a plain gesture does short of opening.
 */
export type OpenTarget = 'current' | 'background' | 'right'

/** Satisfied by React's mouse AND keyboard events, so a click and an Enter share one rule. */
export interface Modifiers {
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  ctrlKey: boolean
}

/** The prop names both views already carry; a surface without a pane simply omits its handler. */
export interface OpenHandlers {
  onOpenFile?: (path: string) => void
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
}

export function openTarget(e: Modifiers): OpenTarget | null {
  if (e.shiftKey || e.ctrlKey) return null
  if (e.metaKey) return 'background'
  if (e.altKey) return 'right'
  return 'current'
}

/** Open `path` where the gesture says; returns the target so a caller can react to "nothing". */
export function openByGesture(e: Modifiers, path: string, handlers: OpenHandlers): OpenTarget | null {
  const target = openTarget(e)
  if (target === 'background') handlers.onOpenFileBackground?.(path)
  else if (target === 'right') handlers.onOpenFileRight?.(path)
  else if (target === 'current') handlers.onOpenFile?.(path)
  return target
}
