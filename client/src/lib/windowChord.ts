/**
 * The renderer's ownership boundary for WINDOW-level chords (YAZ-1280's ⌘B, YAZ-1338's ⌘⇧C,
 * YAZ-1674's ⌘X / ⌘C / ⌘V).
 *
 * App installs its listeners in bubble phase, so editors and modal tools get first refusal; this
 * is the SECOND boundary, and it accepts only ordinary, non-editing app chrome. It lives in one
 * place on purpose: the three predicates differ by exactly a key and a Shift, and a rule about what
 * counts as "editing" that drifted between them would be a bug nobody could see — a chord that
 * fires inside a field the other one respects.
 */

/** The chord's own half: which key, and whether Shift is part of it (never merely tolerated). */
export interface WindowChord {
  /** Compared case-insensitively — Shift changes `key`'s case, and ⌥ variants are declined above. */
  key: string
  shift: boolean
}

export function ownsWindowChord(event: KeyboardEvent, chord: WindowChord): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    !event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey !== chord.shift ||
    event.key.toLowerCase() !== chord.key
  ) return false

  const target = event.target
  if (!(target instanceof Element)) return false
  if (target.ownerDocument.querySelector('[aria-modal="true"]') !== null) return false

  for (let el: Element | null = target; el !== null; el = el.parentElement) {
    if (el.matches('input, textarea, select')) return false
    const contenteditable = el.getAttribute('contenteditable')
    if (contenteditable !== null && contenteditable.toLowerCase() !== 'false') return false
  }
  return true
}
