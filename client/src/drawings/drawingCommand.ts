/**
 * MENU → THE VISIBLE DRAWING (YAZ-1775 🔒 D10).
 *
 * File › Export Image… and View › Canvas Background live in the Electron application menu now —
 * the canvas hamburger belongs to the workspace panel — so main pushes `menu:export-image` /
 * `menu:canvas-background` to the focused window and `App` routes them here.
 *
 * WHY A DOM EVENT AND NOT A PROP. The shell keeps several tabs MOUNTED at once: all but the
 * active one are `visibility: hidden` layers, each with its own live engine. A prop, a context or
 * a `window` listener would reach every one of them, and the wrong canvas would answer. A
 * CustomEvent dispatched on the VISIBLE layer's `.editor--drawing` section reaches exactly one
 * host — the same reasoning that keeps ⌘S and the panel shortcuts off `window`, and the reason
 * `handleKeyboardGlobally` is the parity checklist's one deliberate drop.
 *
 * No drawing in front → nothing happens and the caller is told so. Main already greys the two
 * items out off a drawing tab; this is the belt to that pair of braces.
 */

export const DRAWING_COMMAND_EVENT = 'yaseendraw:drawing-command'

export type DrawingCommand = { kind: 'export-image' } | { kind: 'canvas-background'; color: string }

/** The workspace's VISIBLE drawing section, if the active tab is a drawing. */
export function activeDrawingSection(root: ParentNode = document): Element | null {
  return root.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) .editor--drawing')
}

/** Dispatches `command` to the visible drawing; true when one was there to take it. */
export function requestDrawingCommand(command: DrawingCommand, root: ParentNode = document): boolean {
  const section = activeDrawingSection(root)
  if (section === null) return false
  section.dispatchEvent(new CustomEvent<DrawingCommand>(DRAWING_COMMAND_EVENT, { detail: command, bubbles: false }))
  return true
}
