/**
 * Hotkey reference (GRO-2067 Q4; a Settings page since YAZ-1679): the single source-of-truth list
 * every binding is read from — Settings › Hotkeys renders it, and the settings search indexes every
 * label and key so "close tab" finds the page. When a keymap changes anywhere (lib/sidebarHotkey.ts,
 * lib/fileClipboardHotkey.ts, the application menu in desktop/src/main/menu.ts, the canvas's own
 * handlers in client/src/drawings/), update WINDOW_HOTKEYS, CANVAS_HOTKEYS or MOUSE_TIPS with it —
 * hotkeys.test.ts pins the expected set so drift fails loudly.
 */
export interface HotkeyEntry {
  keys: string
  label: string
}

/** App/window shortcuts: menu-owned B3/Tabs/⌘K/⌘,/zoom (YAZ-1679, YAZ-1710), renderer-owned ⌘B (YAZ-1280) and the sidebar's ⌘X / ⌘C / ⌘V (YAZ-1674), plus Open Recent's open-beside gesture. */
export const WINDOW_HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '⌘⇧N', label: 'New window — same folder and tabs' },
  { keys: '⌘⇧O', label: 'Open folder…' },
  // The vault switcher (YAZ-1767 D8): the sidebar header's panel, keyboard-first like ⌘K's bar.
  { keys: '⌘O', label: 'Switch vault (type to filter, ⏎ brings it to the front or opens a new window)' },
  { keys: '⌘K', label: 'Search the vault' },
  { keys: '⌘,', label: 'Settings' },
  { keys: '⌘B', label: 'Toggle sidebar outside editing surfaces' },
  // View › Zoom (YAZ-1710): main applies the step to the focused window itself, so it is the
  // whole app that zooms — there is no per-document zoom.
  { keys: '⌘+ / ⌘− / ⌘0', label: 'Zoom the app in / out / back to 100%' },
  // The file clipboard (YAZ-1674, D6): the sidebar's own chords, about the selection. One
  // clipboard for every window, so a copy here pastes into another vault's window.
  { keys: '⌘X / ⌘C', label: 'Cut / copy the selected files and folders — pastes in any window, on any vault' },
  { keys: '⌘V', label: 'Paste beside the first selected row — into a folder, next to a file, or into the vault root with none' },
  { keys: '⌘W', label: 'Close tab — on the last tab it empties the window, then closes it' },
  { keys: '⌘⇧W', label: 'Close window' },
  { keys: '⌃Tab / ⌃⇧Tab', label: 'Next / previous tab' },
  { keys: '⌘⇧] / ⌘⇧[', label: 'Next / previous tab' },
  { keys: '⌥ Open Recent', label: '⌥-click a recent folder to open it in a new window' },
]

/**
 * The shortcuts that only mean something with a DRAWING in front (YAZ-1812). ⌘⇧E and ⌘⇧S are
 * the application menu's (🔒 YAZ-1775 D10, 🔒 YAZ-1775 D3) and grey out on any other tab;
 * ⌘S, ⌘F and ⌘C are bound on the drawing's own element in the capture phase and suppressed
 * whenever the keystroke could have meant something else — which is why ⌘C still copies a selection.
 */
export const CANVAS_HOTKEYS: readonly HotkeyEntry[] = [
  { keys: '⌘⇧E', label: "Export image… — the engine's own PNG / SVG dialog" },
  { keys: '⌘⇧S', label: 'Export drawing… — write a standalone .excalidraw with its images embedded' },
  // Autosave already runs on a 500 ms timer, so this is "write it NOW" (🔒 YAZ-1810).
  { keys: '⌘S', label: 'Save the drawing in front now — it autosaves anyway' },
  { keys: '⌘F', label: 'Open the Images tab of the canvas panel' },
  { keys: '⌘C', label: 'Open the Components tab of the canvas panel — when nothing is selected and no text is being edited' },
]

export const MOUSE_TIPS: readonly HotkeyEntry[] = [
  { keys: '⌘-click file', label: 'Open it in a background tab' },
  // The multi-select gesture (YAZ-1336 🔒 D2, folders too since YAZ-1578) and what it is FOR
  // (YAZ-1337): the two plural menu items. Shift toggles one row at a time — it never opens
  // anything and never folds a folder.
  { keys: '⇧-click file or folder', label: 'Add or remove it from a multi-selection — right-click for Copy N paths / Open N in new tabs' },
  { keys: 'Right-click file', label: 'Cut / Copy / Paste, Copy path, New drawing…, Open in ▸ (new window, VS Code, default app, Finder)' },
]

/** The three groups as Settings › Hotkeys shows them, heading first — one place to add a fourth. */
export const HOTKEY_GROUPS: readonly { title: string; entries: readonly HotkeyEntry[] }[] = [
  { title: 'Window', entries: WINDOW_HOTKEYS },
  { title: 'Canvas', entries: CANVAS_HOTKEYS },
  { title: 'Mouse', entries: MOUSE_TIPS },
]
