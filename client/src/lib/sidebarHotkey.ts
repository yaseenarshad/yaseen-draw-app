import { ownsWindowChord } from './windowChord'

/**
 * Renderer ownership policy for YAZ-1280's Cmd+B sidebar shortcut.
 *
 * The canvas and modal tools get first refusal because App installs its listener in bubble phase.
 * The second boundary — which targets count as ordinary, non-editing app chrome — lives in
 * `ownsWindowChord` (YAZ-1674's ⌘X / ⌘C / ⌘V share it): several chords, ONE rule about what editing is.
 */
export function ownsSidebarHotkey(event: KeyboardEvent): boolean {
  return ownsWindowChord(event, { key: 'b', shift: false })
}
