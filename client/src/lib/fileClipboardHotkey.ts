import { ownsWindowChord } from './windowChord'

export type FileClipboardVerb = 'copy' | 'cut' | 'paste'

const VERBS: readonly (readonly [string, FileClipboardVerb])[] = [
  ['c', 'copy'],
  ['x', 'cut'],
  ['v', 'paste'],
]

/**
 * Renderer ownership for the sidebar's file clipboard chords — ⌘C / ⌘X / ⌘V (D6 amended,
 * YAZ-1674) — `ownsCopyPathHotkey`'s sibling, and the same ONE boundary (`ownsWindowChord`): a
 * field, a contenteditable (the ProseMirror editor is one — text copy/paste keeps working) or an
 * open modal keeps the key, and Shift / ⌥ variants are never ours (⌘⇧C is Copy path). These are
 * WINDOW chords, like ⌘⇧C, because focus after a click on the open file sits in the editor
 * (YAZ-961's handoff) and blank space is not focusable at all — a listener on the panel never
 * heard them. ⌘ only, like every renderer chord here: the Ctrl spellings are the platform menu's.
 */
export function fileClipboardVerb(event: KeyboardEvent): FileClipboardVerb | null {
  for (const [key, verb] of VERBS) if (ownsWindowChord(event, { key, shift: false })) return verb
  return null
}
