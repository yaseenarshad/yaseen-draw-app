import { describe, expect, it, vi } from 'vitest'
import { openByGesture, openTarget, type Modifiers } from './openGesture'

const mods = (over: Partial<Modifiers> = {}): Modifiers => ({ metaKey: false, altKey: false, shiftKey: false, ctrlKey: false, ...over })

describe('openTarget (YAZ-1557)', () => {
  it.each([
    ['plain', mods(), 'current'],
    ['⌘', mods({ metaKey: true }), 'background'],
    ['⌥', mods({ altKey: true }), 'right'],
    ['⇧ — the selection gesture, never an open', mods({ shiftKey: true }), null],
    ['⌃', mods({ ctrlKey: true }), null],
    ['⌘⌥ — ⌘ wins', mods({ metaKey: true, altKey: true }), 'background'],
    ['⌘⇧ — ⇧ still vetoes', mods({ metaKey: true, shiftKey: true }), null],
  ] as const)('%s', (_, e, expected) => {
    expect(openTarget(e)).toBe(expected)
  })
})

describe('openByGesture', () => {
  it('routes to the one matching handler and reports the target', () => {
    const h = { onOpenFile: vi.fn(), onOpenFileRight: vi.fn(), onOpenFileBackground: vi.fn() }
    expect(openByGesture(mods(), '/v/a.md', h)).toBe('current')
    expect(openByGesture(mods({ metaKey: true }), '/v/b.md', h)).toBe('background')
    expect(openByGesture(mods({ altKey: true }), '/v/c.md', h)).toBe('right')
    expect(openByGesture(mods({ shiftKey: true }), '/v/d.md', h)).toBeNull()
    expect(h.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    expect(h.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/b.md')
    expect(h.onOpenFileRight).toHaveBeenCalledExactlyOnceWith('/v/c.md')
  })

  it('a missing handler is a no-op, not a throw — the surface simply lacks that pane', () => {
    expect(openByGesture(mods({ altKey: true }), '/v/a.md', {})).toBe('right')
  })
})
