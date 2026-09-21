import { describe, expect, it } from 'vitest'
import { VIEW_HOTKEYS, HOTKEYS, MOUSE_TIPS, WINDOW_HOTKEYS } from './hotkeys'

describe('HOTKEYS source of truth', () => {
  it('covers every shipped keyboard binding', () => {
    const keys = HOTKEYS.map((h) => h.keys)
    // One entry per binding shipped by hotkeys.ts / zoom.ts / marks + history (GRO-2067 Q4).
    for (const expected of ['⌘↑ / ⌘↓', '⌘⇧U', '⌘⇧I', '⌘Z', '⌘⇧Z', '⌘.', '⌘⇧.', '⌘+ / ⌘− / ⌘0', '⌘⏎', '⌘U', '⌘⇧H', '⌘⇧X', 'Tab / ⇧Tab', '⇧↑ / ⇧↓']) {
      expect(keys).toContain(expected)
    }
    expect(HOTKEYS.find((h) => h.keys === '⌘⇧U')?.label).toMatch(/bullets and headings/i)
    expect(HOTKEYS.find((h) => h.keys === '⌘⇧I')?.label).toMatch(/bullets and headings/i)
  })

  it('covers the folder-page view bindings', () => {
    const keys = VIEW_HOTKEYS.map((h) => h.keys)
    // Table cell navigation (4B), cell editors (5B), board drag cancel (5C) — 7B, GRO-2148.
    for (const expected of ['↑ ↓ ← →', '⌘⏎ / ⌥⏎', '⏎ / Esc', 'Esc']) {
      expect(keys).toContain(expected)
    }
    // YAZ-1557: arrows walk board cards too, and the modifier-Enter pair names both targets in order.
    expect(VIEW_HOTKEYS.find((h) => h.keys === '↑ ↓ ← →')?.label).toMatch(/board cards/i)
    expect(VIEW_HOTKEYS.find((h) => h.keys === '⌘⏎ / ⌥⏎')?.label).toMatch(/background tab.*right panel/i)
  })

  it('covers the window & tab shortcuts from the application menu (B3 + Tabs) plus the open-beside tip', () => {
    const keys = WINDOW_HOTKEYS.map((h) => h.keys)
    // ⌘⇧N / ⌘⇧O / ⌘W (Close Tab) / ⌘⇧W (Close Window) and the tab-switch pairs live in the
    // menu (menu.ts, GRO-2161/2232); ⌥-click Open Recent = open beside (GRO-2211).
    for (const expected of ['⌘⇧N', '⌘⇧O', '⌘O', '⌘K', '⌘,', '⌘B', '⌘⇧C', '⌘X / ⌘C', '⌘V', '⌘W', '⌘⇧W', '⌃Tab / ⌃⇧Tab', '⌘⇧] / ⌘⇧[', '⌥ Open Recent']) {
      expect(keys).toContain(expected)
    }
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘B')?.label).toMatch(/outside editing surfaces/i)
    // ⌘O (YAZ-1767 D8): the switcher's two verbs, filter then open — in a NEW window, never in place.
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘O')?.label).toMatch(/switch vault.*filter.*new window/i)
    // ⌘⇧C (🔒 D4, YAZ-1338): the multi-selection FIRST, the open file as the fallback — the
    // order matters, so the label has to name both and in that order.
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘⇧C')?.label).toMatch(/selection.*else the open file/i)
    // The ⌘W ladder swap (GRO-2232, locked): ⌘W closes the TAB, ⌘⇧W the window — never the reverse.
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘W')?.label).toMatch(/close tab/i)
    expect(WINDOW_HOTKEYS.find((h) => h.keys === '⌘⇧W')?.label).toMatch(/close window/i)
  })

  it('the mouse tips carry the I3 + Links C click rulings: link click = current tab (create-on-missing), shared ⌘-click = background tab, right-click = new window', () => {
    const byKeys = (keys: string) => MOUSE_TIPS.find((t) => t.keys === keys)
    // GRO-2192: editor wiki links — click opens in the current tab, an unresolved link creates first.
    expect(byKeys('Click link')?.label).toMatch(/current tab/i)
    expect(byKeys('Click link')?.label).toMatch(/created/i)
    // ONE shared ⌘-click convention: sidebar file rows (I3) AND editor wiki links (Links C).
    expect(byKeys('⌘-click file or link')?.label).toMatch(/background tab/i)
    expect(byKeys('Right-click file')?.label).toMatch(/new window/i)
    // Multi-select (YAZ-1336 🔒 D2 → YAZ-1337): ⇧-click toggles rows, and the tip has to say what
    // that is FOR — the two plural items a right-click then offers.
    expect(byKeys('⇧-click file or folder')?.label).toMatch(/multi-selection/i)
    expect(byKeys('⇧-click file or folder')?.label).toMatch(/Copy N paths/)
    expect(byKeys('⇧-click file or folder')?.label).toMatch(/Open N in new tabs/)
    // YAZ-1557 (D1/D2): click = select on a board card, ⌥ = the right panel on both folder-page views.
    expect(byKeys('Click card')?.label).toMatch(/select/i)
    expect(byKeys('⌥-click name or card')?.label).toMatch(/right panel/i)
  })

  it('every entry is renderable (non-empty keys and label)', () => {
    for (const entry of [...HOTKEYS, ...VIEW_HOTKEYS, ...WINDOW_HOTKEYS, ...MOUSE_TIPS]) {
      expect(entry.keys.length).toBeGreaterThan(0)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })
})
