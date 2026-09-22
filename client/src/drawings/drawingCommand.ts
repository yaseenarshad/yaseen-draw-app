/**
 * MENU → THE VISIBLE DRAWING (🔒 YAZ-1775 D10), and the one test for "is this tab in front".
 *
 * WHY A DOM EVENT AND NOT A PROP: the shell keeps several tabs MOUNTED at once — all but the
 * active one are `visibility: hidden` layers, each with its own live engine — so a prop, a
 * context or a `window` listener would reach every one of them and the wrong canvas would answer.
 * A CustomEvent dispatched on the visible layer's `.editor--drawing` section reaches exactly one
 * host. It is the reason `handleKeyboardGlobally` is the parity list's one deliberate drop.
 */

export const DRAWING_COMMAND_EVENT = 'yaseendraw:drawing-command'

export type DrawingCommand = { kind: 'export-image' } | { kind: 'export-drawing' } | { kind: 'canvas-background'; color: string }

/** THE test: `el` is in the tab layer that is in front (an element outside any layer counts as in front). */
export function isFrontmost(el: Element | null): boolean {
  return el !== null && el.closest('.tabstack__layer--hidden') === null
}

/** The workspace's VISIBLE drawing section, if the active tab is a drawing. */
export function activeDrawingSection(root: ParentNode = document): Element | null {
  return [...root.querySelectorAll('.tabstack__layer .editor--drawing')].find(isFrontmost) ?? null
}

/**
 * Dispatches `command` to the visible drawing; true when one was there to take it. Main already
 * greys the three menu items out off a drawing tab — this is the belt to that pair of braces.
 */
export function requestDrawingCommand(command: DrawingCommand, root: ParentNode = document): boolean {
  const section = activeDrawingSection(root)
  if (section === null) return false
  section.dispatchEvent(new CustomEvent<DrawingCommand>(DRAWING_COMMAND_EVENT, { detail: command, bubbles: false }))
  return true
}
