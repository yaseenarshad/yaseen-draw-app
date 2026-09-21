import { describe, expect, it } from 'vitest'
import { CANVAS_HOTKEYS, HOTKEY_GROUPS, MOUSE_TIPS, WINDOW_HOTKEYS } from './hotkeys'

describe('HOTKEYS source of truth', () => {
  it('covers the window & tab shortcuts from the application menu (B3 + Tabs + View › Zoom) plus the open-beside tip', () => {
    const keys = WINDOW_HOTKEYS.map((h) => h.keys)
    // ⌘⇧N / ⌘⇧O / ⌘W (Close Tab) / ⌘⇧W (Close Window), the tab-switch pairs and the zoom trio
    // live in the menu (menu.ts, GRO-2161/2232, YAZ-1710); ⌥-click Open Recent = open beside (GRO-2211).
    for (const expected of ['⌘⇧N', '⌘⇧O', '⌘O', '⌘K', '⌘,', '⌘B', '⌘+ / ⌘− / ⌘0', '⌘X / ⌘C', '⌘V', '⌘S', '⌘W', '⌘⇧W', '⌃Tab / ⌃⇧Tab', '⌘⇧] / ⌘⇧[', '⌥ Open Recent']) {
      expect(keys).toContain(expected)
    }
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘B')?.label).toMatch(/outside editing surfaces/i)
    // ⌘O (YAZ-1767 D8): the switcher's two verbs, filter then open — in a NEW window, never in place.
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘O')?.label).toMatch(/switch vault.*filter.*new window/i)
    // YAZ-1710: main applies the step to the whole window — there is no per-document zoom to name.
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘+ / ⌘− / ⌘0')?.label).toMatch(/the app/i)
    // The ⌘W ladder swap (GRO-2232, locked): ⌘W closes the TAB, ⌘⇧W the window — never the reverse.
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘W')?.label).toMatch(/close tab/i)
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘⇧W')?.label).toMatch(/close window/i)
  })

  it('the mouse tips carry the I3 click rulings: ⌘-click = background tab, right-click = new window', () => {
    const byKeys = (keys: string) => MOUSE_TIPS.find((t) => t.keys === keys)
    expect(byKeys('⌘-click file')?.label).toMatch(/background tab/i)
    expect(byKeys('Right-click file')?.label).toMatch(/new window/i)
    // The context menu's create group leads on the one document birth (⚡ D8 amended).
    expect(byKeys('Right-click file')?.label).toMatch(/new drawing/i)
    // Multi-select (YAZ-1336 🔒 D2 → YAZ-1337): ⇧-click toggles rows, and the tip has to say what
    // that is FOR — the two plural items a right-click then offers.
    expect(byKeys('⇧-click file or folder')?.label).toMatch(/multi-selection/i)
    expect(byKeys('⇧-click file or folder')?.label).toMatch(/Copy N paths/)
    expect(byKeys('⇧-click file or folder')?.label).toMatch(/Open N in new tabs/)
  })

  /**
   * The old document layer is gone (YAZ-1808), and so is everything it bound: the outliner's
   * fold / zoom / mark chords, the folder-page view surface, wiki links, the right panel and the
   * ⌘⇧C copy-path chord. The reference may not advertise a key the app no longer answers.
   */
  it('advertises NO binding of a deleted feature', () => {
    const all = HOTKEY_GROUPS.flatMap((group) => group.entries)
    for (const gone of ['⌘⇧U', '⌘⇧I', '⌘.', '⌘⇧.', '⌘⏎', '⌘U', '⌘⇧H', '⌘⇧X', 'Tab / ⇧Tab', '⌘⇧C', '⌘⏎ / ⌥⏎', 'Click glyph', 'Click link', 'Click card']) {
      expect(all.map((h) => h.keys)).not.toContain(gone)
    }
    for (const word of [/bullet/i, /heading/i, /wiki/i, /right panel/i, /board card/i, /topic/i]) {
      expect(all.filter((h) => word.test(h.label))).toEqual([])
    }
  })

  it('is THREE groups — Window, Canvas and Mouse — in the order the page shows them', () => {
    expect(HOTKEY_GROUPS.map((g) => g.title)).toEqual(['Window', 'Canvas', 'Mouse'])
    expect(HOTKEY_GROUPS.map((g) => g.entries)).toEqual([WINDOW_HOTKEYS, CANVAS_HOTKEYS, MOUSE_TIPS])
  })

  it('the Canvas table carries the drawing`s own keys (YAZ-1812), and says what gates ⌘C', () => {
    expect(CANVAS_HOTKEYS.map((h) => h.keys)).toEqual(['⌘⇧E', '⌘F', '⌘C'])
    expect(CANVAS_HOTKEYS.find((h) => h.keys === '⌘⇧E')?.label).toMatch(/export image/i)
    expect(CANVAS_HOTKEYS.find((h) => h.keys === '⌘C')?.label).toMatch(/nothing is selected/i)
    // ⌘S is a window-level key, listed with the rest (🔒 YAZ-1810 autosave still owns the file).
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘S')?.label).toMatch(/autosaves/i)
  })

  it('every entry is renderable (non-empty keys and label)', () => {
    for (const entry of [...WINDOW_HOTKEYS, ...MOUSE_TIPS]) {
      expect(entry.keys.length).toBeGreaterThan(0)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })
})
