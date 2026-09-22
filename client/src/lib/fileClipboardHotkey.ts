import { ownsWindowChord } from './windowChord'

export type FileClipboardVerb = 'copy' | 'cut' | 'paste'

const VERBS: readonly (readonly [string, FileClipboardVerb])[] = [
  ['c', 'copy'],
  ['x', 'cut'],
  ['v', 'paste'],
]

/**
 * Renderer ownership for the sidebar's file clipboard chords — ⌘C / ⌘X / ⌘V (D6 amended,
 * YAZ-1674) — through the ONE boundary (`ownsWindowChord`): a field, a contenteditable or an
 * open modal keeps the key, so text copy/paste is untouched, and Shift / ⌥ variants are never
 * ours. These are WINDOW chords because focus after a click on the open file sits in the canvas
 * (YAZ-961's handoff) and blank space is not focusable at all — a listener on the panel never
 * heard them. ⌘ only, like every renderer chord here: the Ctrl spellings are the platform menu's.
 */
export function fileClipboardVerb(event: KeyboardEvent): FileClipboardVerb | null {
  for (const [key, verb] of VERBS) if (ownsWindowChord(event, { key, shift: false })) return verb
  return null
}
