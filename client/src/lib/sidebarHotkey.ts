import { ownsWindowChord } from './windowChord'

/**
 * Renderer ownership policy for YAZ-1280's Cmd+B sidebar shortcut.
 *
 * Editors and modal tools get first refusal because App installs its listener in bubble phase.
 * The second boundary — which targets count as ordinary, non-editing app chrome — moved to
 * `ownsWindowChord` when ⌘⇧C arrived (YAZ-1338; ⌘X / ⌘C / ⌘V followed in YAZ-1674): three chords, ONE rule about what editing is.
 */
export function ownsSidebarHotkey(event: KeyboardEvent): boolean {
  return ownsWindowChord(event, { key: 'b', shift: false })
}
