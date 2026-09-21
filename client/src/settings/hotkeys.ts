/**
 * Hotkey reference (GRO-2067 Q4; a Settings page since YAZ-1679): the single source-of-truth list
 * every binding is read from — Settings › Hotkeys renders it, and the settings search indexes every
 * label and key so "close tab" finds the page. When a keymap changes anywhere (editor/outline/hotkeys.ts,
 * foldAllHotkeys.ts, headingHotkeys.ts, zoom.ts, marks/underline.ts, marks/highlight.ts,
 * listCommands.ts, lineSelection.ts, views/view/*, the application menu in desktop/src/main/menu.ts), update HOTKEYS
 * (or VIEW_HOTKEYS / WINDOW_HOTKEYS) with it — `VIEW_HOTKEYS` is the folder-page view surface's own
 * set (table / cards / outline bindings); it was `BASES_HOTKEYS` under the heading "Bases" until
 * YAZ-861 renamed both to what they describe. hotkeys.test.ts pins the expected set so drift fails
 * loudly. Until YAZ-1679 this lived in sidebar/HotkeysPanel.tsx beside a keyboard-icon popover.
 */
export interface HotkeyEntry {
  keys: string
  label: string
}

export const HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '⌘↑ / ⌘↓', label: 'Fold / unfold the bullet or heading section at the caret' },
  { keys: '⌘⇧U', label: 'Fold all bullets and headings' },
  { keys: '⌘⇧I', label: 'Unfold all bullets and headings' },
  { keys: '⌘Z', label: 'Undo — also reverts the latest fold or zoom' },
  { keys: '⌘⇧Z', label: 'Redo' },
  { keys: '⌘.', label: 'Zoom into the bullet at the caret' },
  { keys: '⌘⇧.', label: 'Zoom out one level' },
  { keys: '⌘+ / ⌘− / ⌘0', label: 'Zoom this note in / out (25 at a time above 200%) / back to 100% — outside a note, the whole app' },
  { keys: '⌘⏎', label: 'Cycle bullet → task → done' },
  { keys: '⌘U', label: 'Underline' },
  { keys: '⌘⇧H', label: 'Highlight' },
  { keys: '⌘⇧X', label: 'Strikethrough' },
  { keys: 'Tab / ⇧Tab', label: 'Indent / outdent bullet' },
  { keys: '⇧↑ / ⇧↓', label: 'Select to the end / start of this line, then one whole line per press' },
]

export const VIEW_HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '↑ ↓ ← →', label: 'Move between table cells or board cards — Enter opens the note or edits the cell' },
  // One open rule for Table and Board (YAZ-1557): ⌘ = background tab (I3), ⌥ = right panel.
  { keys: '⌘⏎ / ⌥⏎', label: 'Open the selected note in a background tab / the right panel' },
  { keys: '⏎ / Esc', label: 'Commit / cancel a cell edit' },
  { keys: 'Esc', label: 'Cancel a card drag' },
]

/** App/window shortcuts: menu-owned B3/Tabs/⌘K/⌘, (YAZ-1679), renderer-owned ⌘B (YAZ-1280), ⌘⇧C (YAZ-1338) and the sidebar's ⌘X / ⌘C / ⌘V (YAZ-1674), plus Open Recent's open-beside gesture. */
export const WINDOW_HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '⌘⇧N', label: 'New window — same folder and tabs' },
  { keys: '⌘⇧O', label: 'Open folder…' },
  // The vault switcher (YAZ-1767 D8): the sidebar header's panel, keyboard-first like ⌘K's bar.
  { keys: '⌘O', label: 'Switch vault (type to filter, ⏎ brings it to the front or opens a new window)' },
  { keys: '⌘K', label: 'Search the vault' },
  { keys: '⌘,', label: 'Settings' },
  { keys: '⌘B', label: 'Toggle sidebar outside editing surfaces' },
  { keys: '⌘⇧C', label: 'Copy path — the sidebar selection when one is standing, else the open file' },
  // The file clipboard (YAZ-1674, D6): the sidebar's own chords, beside ⌘⇧C and like it about the
  // selection. One clipboard for every window, so a copy here pastes into another vault's window.
  { keys: '⌘X / ⌘C', label: 'Cut / copy the selected files and folders — pastes in any window, on any vault' },
  { keys: '⌘V', label: 'Paste beside the first selected row — into a folder, next to a file, or into the vault root with none' },
  { keys: '⌘W', label: 'Close tab — on the last tab it empties the window, then closes it' },
  { keys: '⌘⇧W', label: 'Close window' },
  { keys: '⌃Tab / ⌃⇧Tab', label: 'Next / previous tab' },
  { keys: '⌘⇧] / ⌘⇧[', label: 'Next / previous tab' },
  { keys: '⌥ Open Recent', label: '⌥-click a recent folder to open it in a new window' },
]

export const MOUSE_TIPS: readonly HotkeyEntry[] = [
  { keys: 'Click glyph', label: 'Zoom into that bullet' },
  { keys: 'Click line', label: 'Collapse direct children / fully expand their subtree' },
  { keys: 'Click chevron', label: 'Fold / unfold that bullet or heading section' },
  { keys: 'Drag 6 dots', label: 'Move block — a multi-block selection moves together' },
  { keys: '/', label: 'Block menu, in an empty paragraph' },
  // Links C (GRO-2192): the editor's [[wiki link]] click model; the ⌘-click line is SHARED
  // with the sidebar's I3 gesture — one convention, one tip.
  { keys: 'Click link', label: 'Open that wiki link in the current tab — a missing note is created first' },
  { keys: '⌘-click file or link', label: 'Open it in a background tab — a table name or board card too' },
  // YAZ-1557: a board card is a cell — click selects, the title opens — and ⌥ is the right-panel key on both views.
  { keys: 'Click card', label: 'Select it — the title opens the note in the current tab' },
  { keys: '⌥-click name or card', label: 'Open it in the right panel' },
  // The multi-select gesture (YAZ-1336 🔒 D2, folders too since YAZ-1578) and what it is FOR
  // (YAZ-1337): the two plural menu items and ⌘⇧C above. Shift toggles one row at a time — it
  // never opens anything and never folds a folder.
  { keys: '⇧-click file or folder', label: 'Add or remove it from a multi-selection — right-click for Copy N paths / Open N in new tabs' },
  { keys: 'Right-click file', label: 'Cut / Copy / Paste, Copy path, New note…, Open in ▸ (new window, VS Code, default app, Finder)' },
]

/** The four groups as Settings › Hotkeys shows them, heading first — one place to add a fifth. */
export const HOTKEY_GROUPS: readonly { title: string; entries: readonly HotkeyEntry[] }[] = [
  { title: 'Keyboard', entries: HOTKEYS },
  { title: 'Views', entries: VIEW_HOTKEYS },
  { title: 'Window', entries: WINDOW_HOTKEYS },
  { title: 'Mouse', entries: MOUSE_TIPS },
]
