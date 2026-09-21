/**
 * The renderer-owned tab model (Tabs I2, GRO-2234): the pure reducer's invariants
 * (`active ∈ tabs`, `tabs: []` ⇔ `active: null`, de-duplication, the keep-mounted set),
 * the boot snapshot precedence, and the hook's ONE-explicit-`setIdentity({tabs, file})`
 * mirror per change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultAppState, type AppState, type WindowIdentity } from '@shared/types'
import { storage } from '../lib/storage'
import { bootTabs, tabsReducer, useWorkspace, type TabsState, type UseWorkspace } from './useWorkspace'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const state = (tabs: string[], active: string | null, mounted?: string[]): TabsState => ({
  tabs,
  active,
  mounted: mounted ?? (active === null ? [] : [active]),
  history: {},
})

describe('tabsReducer', () => {
  describe('open-current (rule 4: replace the active tab)', () => {
    it('creates the first tab of an empty window', () => {
      expect(tabsReducer(state([], null), { type: 'open-current', path: '/v/a.md' })).toEqual({
        ...state(['/v/a.md'], '/v/a.md'),
        history: {},
      })
    })

    it('replaces the active tab in its slot; the replaced path leaves the mounted set', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md', ['/v/b.md', '/v/a.md'])
      expect(tabsReducer(s, { type: 'open-current', path: '/v/c.md' })).toEqual({
        tabs: ['/v/c.md', '/v/b.md'],
        active: '/v/c.md',
        mounted: ['/v/b.md', '/v/c.md'],
        history: { '/v/c.md': { entries: ['/v/a.md', '/v/c.md'], index: 1 } },
      })
    })

    it('ACTIVATES an already-open path instead of duplicating (rule 3)', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-current', path: '/v/b.md' })).toEqual({
        tabs: ['/v/a.md', '/v/b.md'],
        active: '/v/b.md',
        mounted: ['/v/a.md', '/v/b.md'],
        history: {},
      })
    })

    it('re-opening the active path is a no-op (same state object — no identity mirror)', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-current', path: '/v/a.md' })).toBe(s)
    })
  })

  describe('open-new / open-background (rule 5)', () => {
    it('open-new appends at the end and activates', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-new', path: '/v/b.md' })).toEqual({
        tabs: ['/v/a.md', '/v/b.md'],
        active: '/v/b.md',
        mounted: ['/v/a.md', '/v/b.md'],
        history: {},
      })
    })

    it('open-new on an already-open path activates its tab', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/b.md')
      expect(tabsReducer(s, { type: 'open-new', path: '/v/a.md' })).toEqual(state(['/v/a.md', '/v/b.md'], '/v/a.md', ['/v/b.md', '/v/a.md']))
    })

    it('open-background appends WITHOUT activating or mounting (the editor lazy-mounts on first activation)', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-background', path: '/v/b.md' })).toEqual({
        tabs: ['/v/a.md', '/v/b.md'],
        active: '/v/a.md',
        mounted: ['/v/a.md'],
        history: {},
      })
    })

    it('open-background on an already-open path is a no-op — it never yanks activation', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'open-background', path: '/v/b.md' })).toBe(s)
    })

    it('open-background as the FIRST tab activates: non-empty tabs require a non-null file', () => {
      expect(tabsReducer(state([], null), { type: 'open-background', path: '/v/a.md' })).toEqual(state(['/v/a.md'], '/v/a.md'))
    })
  })

  describe('activate', () => {
    it('activates a listed tab and adds it to the mounted set once', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/a.md')
      const next = tabsReducer(s, { type: 'activate', path: '/v/b.md' })
      expect(next).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/a.md', '/v/b.md']))
      // Re-activating keeps the mounted set stable (no duplicates).
      const back = tabsReducer(tabsReducer(next, { type: 'activate', path: '/v/a.md' }), { type: 'activate', path: '/v/b.md' })
      expect(back.mounted).toEqual(['/v/a.md', '/v/b.md'])
    })

    it('an unknown path or the already-active path is a no-op', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'activate', path: '/v/zzz.md' })).toBe(s)
      expect(tabsReducer(s, { type: 'activate', path: '/v/a.md' })).toBe(s)
    })
  })

  describe('close (rule 7 ladder)', () => {
    const abc = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/b.md')

    it('closing the active tab activates its RIGHT neighbour', () => {
      expect(tabsReducer(abc, { type: 'close', path: '/v/b.md' })).toEqual(state(['/v/a.md', '/v/c.md'], '/v/c.md', ['/v/c.md']))
    })

    it('closing the active LAST tab falls back to the left neighbour', () => {
      const s = state(['/v/a.md', '/v/b.md'], '/v/b.md')
      expect(tabsReducer(s, { type: 'close', path: '/v/b.md' })).toEqual(state(['/v/a.md'], '/v/a.md'))
    })

    it('closing a NON-active tab keeps the active one (and prunes the mounted set)', () => {
      const s = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/b.md', ['/v/c.md', '/v/b.md'])
      expect(tabsReducer(s, { type: 'close', path: '/v/c.md' })).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/b.md']))
    })

    it('closing the only tab leaves the empty state (tabs: [] ⇔ active: null); the window stays alive', () => {
      expect(tabsReducer(state(['/v/a.md'], '/v/a.md'), { type: 'close', path: '/v/a.md' })).toEqual(state([], null))
    })

    it('closing an unknown path is a no-op', () => {
      expect(tabsReducer(abc, { type: 'close', path: '/v/zzz.md' })).toBe(abc)
    })
  })

  describe('move (I3 drag-to-reorder, GRO-2235)', () => {
    const abc = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/b.md')

    it('moves the tab at `from` to final index `to`; active and mounted are untouched', () => {
      expect(tabsReducer(abc, { type: 'move', from: 0, to: 2 })).toEqual(state(['/v/b.md', '/v/c.md', '/v/a.md'], '/v/b.md'))
      expect(tabsReducer(abc, { type: 'move', from: 2, to: 0 })).toEqual(state(['/v/c.md', '/v/a.md', '/v/b.md'], '/v/b.md'))
      const withMounts = state(['/v/a.md', '/v/b.md'], '/v/b.md', ['/v/a.md', '/v/b.md'])
      expect(tabsReducer(withMounts, { type: 'move', from: 1, to: 0 }).mounted).toEqual(['/v/a.md', '/v/b.md'])
    })

    it('the same slot, an out-of-range `from`, or a `to` clamped back onto `from` are no-ops (same object)', () => {
      expect(tabsReducer(abc, { type: 'move', from: 1, to: 1 })).toBe(abc)
      expect(tabsReducer(abc, { type: 'move', from: 3, to: 0 })).toBe(abc)
      expect(tabsReducer(abc, { type: 'move', from: -1, to: 0 })).toBe(abc)
      expect(tabsReducer(abc, { type: 'move', from: 2, to: 99 })).toBe(abc) // clamped to the last slot — its own
    })
  })

  describe('cycle (rule 9: wraparound, plain left→right order)', () => {
    const abc = state(['/v/a.md', '/v/b.md', '/v/c.md'], '/v/c.md')

    it('next wraps from the last tab to the first; prev wraps back', () => {
      const next = tabsReducer(abc, { type: 'cycle', dir: 1 })
      expect(next.active).toBe('/v/a.md')
      expect(tabsReducer(next, { type: 'cycle', dir: -1 }).active).toBe('/v/c.md')
    })

    it('is a no-op with fewer than two tabs', () => {
      const one = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(one, { type: 'cycle', dir: 1 })).toBe(one)
      const none = state([], null)
      expect(tabsReducer(none, { type: 'cycle', dir: -1 })).toBe(none)
    })
  })

  describe('reset', () => {
    it('normalizes: de-duplicates and PREPENDS an active file missing from the list (main\'s order)', () => {
      expect(tabsReducer(state([], null), { type: 'reset', tabs: ['/v/a.md', '/v/a.md', '/v/b.md'], active: '/v/c.md' })).toEqual(
        state(['/v/c.md', '/v/a.md', '/v/b.md'], '/v/c.md'),
      )
    })

    it('a null active forces the empty state; resetting an already-empty state is a no-op', () => {
      const s = state(['/v/a.md'], '/v/a.md')
      expect(tabsReducer(s, { type: 'reset', tabs: ['/v/a.md'], active: null })).toEqual(state([], null))
      const empty = state([], null)
      expect(tabsReducer(empty, { type: 'reset', tabs: [], active: null })).toBe(empty)
    })

    it('mounts ONLY the active tab (rule 15: restore shows all tabs, one editor)', () => {
      const next = tabsReducer(state([], null), { type: 'reset', tabs: ['/v/a.md', '/v/b.md'], active: '/v/b.md' })
      expect(next.mounted).toEqual(['/v/b.md'])
    })
  })

  describe('rename (Links E1, GRO-2194: an open tab follows its renamed file)', () => {
    it('remaps the tab in place — slot, activation and the mounted set all follow', () => {
      const s = state(['/v/old.md', '/v/x.md'], '/v/old.md', ['/v/x.md', '/v/old.md'])
      expect(tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })).toEqual({
        tabs: ['/v/new.md', '/v/x.md'],
        active: '/v/new.md',
        mounted: ['/v/x.md', '/v/new.md'],
        history: {},
      })
    })

    it('remaps a background tab without touching activation', () => {
      const s = state(['/v/x.md', '/v/old.md'], '/v/x.md')
      expect(tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })).toEqual(state(['/v/x.md', '/v/new.md'], '/v/x.md'))
    })

    it('is a no-op (same state object — no identity mirror) when the old path is not open', () => {
      const s = state(['/v/x.md'], '/v/x.md')
      expect(tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })).toBe(s)
    })

    it('drops the old tab when the new path is somehow already open (dedupe), keeping activation sane', () => {
      const s = state(['/v/old.md', '/v/new.md'], '/v/old.md', ['/v/old.md'])
      const next = tabsReducer(s, { type: 'rename', oldPath: '/v/old.md', newPath: '/v/new.md' })
      expect(next.tabs).toEqual(['/v/new.md'])
      expect(next.active).toBe('/v/new.md')
      expect(next.mounted).toEqual(['/v/new.md'])
    })
  })

  describe('rename-dir (Links E1b, GRO-2241: every tab under a renamed folder follows by prefix)', () => {
    it('remaps every tab under the old prefix in place — slots, activation and the mounted set follow', () => {
      const s = state(['/v/Old/a.md', '/v/x.md', '/v/Old/deep/b.md'], '/v/Old/a.md', ['/v/x.md', '/v/Old/a.md'])
      expect(tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })).toEqual({
        tabs: ['/v/New/a.md', '/v/x.md', '/v/New/deep/b.md'],
        active: '/v/New/a.md',
        mounted: ['/v/x.md', '/v/New/a.md'],
        history: {},
      })
    })

    it('is a no-op (same state object — no identity mirror) when nothing is open under the folder', () => {
      const s = state(['/v/x.md', '/v/Older/a.md'], '/v/x.md') // `/v/Older` is NOT under `/v/Old` — prefix means `/v/Old/`
      expect(tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })).toBe(s)
    })

    it('drops a remapped tab whose target path is somehow already open (dedupe), keeping activation sane', () => {
      const s = state(['/v/Old/a.md', '/v/New/a.md'], '/v/Old/a.md', ['/v/Old/a.md'])
      const next = tabsReducer(s, { type: 'rename-dir', oldPath: '/v/Old', newPath: '/v/New' })
      expect(next.tabs).toEqual(['/v/New/a.md'])
      expect(next.active).toBe('/v/New/a.md')
      expect(next.mounted).toEqual(['/v/New/a.md'])
    })
  })
})

/** A fake `window.yaseenDraw` with just the surface storage touches (the storage.test.ts pattern). */
type IdentityFixture = Omit<WindowIdentity, 'sidebarCollapsed' | 'sidebarLens' | 'focusDirs' | 'focusFavorites'> & Partial<Pick<WindowIdentity, 'sidebarCollapsed' | 'sidebarLens' | 'focusDirs' | 'focusFavorites'>>

function installBridge(app: AppState, identity: IdentityFixture) {
  const bridge = {
    state: {
      get: vi.fn(async () => app),
      setFolder: vi.fn(async () => undefined),
      onChange: vi.fn(() => () => undefined),
    },
    window: {
      identity: vi.fn(async (): Promise<WindowIdentity> => ({
        ...identity,
        sidebarCollapsed: identity.sidebarCollapsed ?? false,
        sidebarLens: identity.sidebarLens ?? 'files',
        focusDirs: identity.focusDirs ?? [],
        focusFavorites: identity.focusFavorites ?? [],
      })),
      setIdentity: vi.fn(async () => undefined),
    },
  }
  Object.defineProperty(window, 'yaseenDraw', { value: bridge, configurable: true, writable: true })
  return bridge
}

afterEach(() => {
  history.replaceState(null, '', '/')
  delete (window as unknown as Record<string, unknown>).yaseenDraw
  vi.restoreAllMocks()
})

describe('bootTabs (rules 12/15)', () => {
  const seeded: AppState = {
    ...defaultAppState(),
    folders: { '/v': { expanded: [], lastFile: '/v/last.md' } },
  }

  it('restores the stored tabs with the identity file active; only the active tab mounts', async () => {
    installBridge(seeded, { id: 'w1', root: '/v', file: '/v/b.md', tabs: ['/v/a.md', '/v/b.md'], sidebarCollapsed: false })
    await storage.init()
    expect(bootTabs('/v')).toEqual(state(['/v/a.md', '/v/b.md'], '/v/b.md'))
  })

  it('a pasted #hash wins as active and is PREPENDED when missing from the stored tabs', async () => {
    installBridge(seeded, { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], sidebarCollapsed: false })
    await storage.init()
    history.replaceState(null, '', '#/v/pasted.md')
    expect(bootTabs('/v')).toEqual(state(['/v/pasted.md', '/v/a.md'], '/v/pasted.md'))
  })

  it('a fresh window falls back to the folder lastFile; a null root (Welcome) is empty', async () => {
    installBridge(seeded, { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false })
    await storage.init()
    expect(bootTabs('/v')).toEqual(state(['/v/last.md'], '/v/last.md'))
    expect(bootTabs(null)).toEqual(state([], null))
  })
})

describe('useWorkspace legacy main-tab mirror', () => {
  let reactRoot: Root | null = null
  let latest: UseWorkspace
  let bridge: ReturnType<typeof installBridge>

  function Probe({ root }: { root: string | null }) {
    latest = useWorkspace(root)
    return null
  }

  beforeEach(async () => {
    bridge = installBridge(defaultAppState(), { id: 'w1', root: '/v', file: null, tabs: [], sidebarCollapsed: false })
    await storage.init()
    reactRoot = createRoot(document.createElement('div'))
    act(() => reactRoot?.render(<Probe root="/v" />))
  })

  afterEach(() => {
    act(() => reactRoot?.unmount())
    reactRoot = null
  })

  it('every mutating action sends ONE setIdentity carrying BOTH tabs and file, plus the folder lastFile', () => {
    act(() => latest.openCurrent('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md'], file: '/v/a.md' })
    expect(bridge.state.setFolder).toHaveBeenLastCalledWith('/v', { lastFile: '/v/a.md' })

    act(() => latest.openBackground('/v/b.md'))
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/a.md' })

    act(() => latest.next())
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md', '/v/b.md'], file: '/v/b.md' })

    act(() => latest.close('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md'], file: '/v/b.md' })
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(4)
  })

  it('a no-op action mirrors nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    act(() => latest.activate('/v/a.md')) // already active
    act(() => latest.openBackground('/v/a.md')) // already open
    act(() => latest.prev()) // one tab: nothing to cycle
    act(() => latest.close('/v/zzz.md')) // unknown
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(1)
  })

  it('move mirrors the reorder as ONE {tabs, file} write with the active file unchanged; a no-op move mirrors nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.openBackground('/v/b.md'))
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.move(0, 1))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/b.md', '/v/a.md'], file: '/v/a.md' })
    act(() => latest.move(1, 1))
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
  })

  it('closeActive reports whether there was a tab to close (false → App escalates to closeSelf)', () => {
    let closed: boolean | undefined
    act(() => {
      closed = latest.closeActive()
    })
    expect(closed).toBe(false)
    act(() => latest.openCurrent('/v/a.md'))
    act(() => {
      closed = latest.closeActive()
    })
    expect(closed).toBe(true)
    expect(latest.tabs).toEqual([])
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: [], file: null })
  })

  it('canBack / canForward read the ACTIVE tab\'s place in its own stack (YAZ-721 D1)', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.openCurrent('/v/b.md'))
    act(() => latest.openCurrent('/v/c.md'))
    expect(latest.canBack).toBe(true)
    expect(latest.canForward).toBe(false)

    act(() => latest.back())
    expect(latest.active).toBe('/v/b.md')
    expect(latest.canBack).toBe(true)
    expect(latest.canForward).toBe(true)
  })

  it('back mirrors ONE {tabs, file} write — the stacks never reach storage', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.openCurrent('/v/b.md'))
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.back())
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes + 1)
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/v/a.md'], file: '/v/a.md' })
  })

  it('back at the start of the stack (and forward at its end) mirror nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.back())
    act(() => latest.forward())
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes)
  })

  it('reset with a restored file mirrors against the EXPLICIT new root; an empty reset mirrors nothing', () => {
    act(() => latest.openCurrent('/v/a.md'))
    act(() => latest.reset('/w', '/w/b.md'))
    expect(latest.tabs).toEqual(['/w/b.md'])
    expect(bridge.state.setFolder).toHaveBeenLastCalledWith('/w', { lastFile: '/w/b.md' })
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/w/b.md'], file: '/w/b.md' })
    const writes = bridge.window.setIdentity.mock.calls.length
    act(() => latest.reset(null, null)) // rides on setRoot's own {root, file: null, tabs: []} write
    expect(latest.tabs).toEqual([])
    expect(latest.active).toBeNull()
    expect(bridge.window.setIdentity).toHaveBeenCalledTimes(writes)
  })
})

/**
 * Delete (GRO-2272 `B2-`): deleting a tab IS closing it. These assertions exist to keep the
 * two in step — divergence would show up as "deleting the active note picks a different tab
 * than ⌘W does", which nobody reports and everybody feels.
 */
describe('delete / delete-dir (GRO-2272)', () => {
  const S = (tabs: string[], active: string | null, mounted: string[] = tabs): TabsState => ({ tabs, active, mounted, history: {} })

  it('deleting a NON-active tab leaves the active one alone', () => {
    const next = tabsReducer(S(['/a.md', '/b.md', '/c.md'], '/a.md'), { type: 'delete', path: '/b.md' })
    expect(next.tabs).toEqual(['/a.md', '/c.md'])
    expect(next.active).toBe('/a.md')
    expect(next.mounted).toEqual(['/a.md', '/c.md'])
  })

  it('deleting the ACTIVE tab promotes the right neighbour', () => {
    const next = tabsReducer(S(['/a.md', '/b.md', '/c.md'], '/b.md'), { type: 'delete', path: '/b.md' })
    expect(next.tabs).toEqual(['/a.md', '/c.md'])
    expect(next.active).toBe('/c.md')
  })

  it('deleting the LAST tab falls back to the left neighbour', () => {
    const next = tabsReducer(S(['/a.md', '/b.md'], '/b.md'), { type: 'delete', path: '/b.md' })
    expect(next.active).toBe('/a.md')
  })

  it('deleting the ONLY tab empties the window; it stays alive', () => {
    const next = tabsReducer(S(['/a.md'], '/a.md'), { type: 'delete', path: '/a.md' })
    expect(next).toEqual({ tabs: [], active: null, mounted: [], history: {} })
  })

  it('deleting a path that is not open returns the SAME state object (no identity mirror)', () => {
    const before = S(['/a.md'], '/a.md')
    expect(tabsReducer(before, { type: 'delete', path: '/never.md' })).toBe(before)
  })

  it('delete matches close exactly — the heir ladder is shared, not re-implemented', () => {
    const before = S(['/a.md', '/b.md', '/c.md'], '/b.md')
    expect(tabsReducer(before, { type: 'delete', path: '/b.md' })).toEqual(tabsReducer(before, { type: 'close', path: '/b.md' }))
  })

  it('delete-dir drops every tab under the prefix in one dispatch and picks a survivor', () => {
    const next = tabsReducer(S(['/Docs/a.md', '/x.md', '/Docs/deep/b.md'], '/Docs/a.md'), { type: 'delete-dir', path: '/Docs' })
    expect(next.tabs).toEqual(['/x.md'])
    expect(next.active).toBe('/x.md')
    expect(next.mounted).toEqual(['/x.md'])
  })

  it('delete-dir empties the window when every tab was under the folder', () => {
    const next = tabsReducer(S(['/Docs/a.md', '/Docs/b.md'], '/Docs/a.md'), { type: 'delete-dir', path: '/Docs' })
    expect(next).toEqual({ tabs: [], active: null, mounted: [], history: {} })
  })

  it('delete-dir needs a real path segment: /Docsy.md is not under /Docs', () => {
    const before = S(['/Docsy.md'], '/Docsy.md')
    expect(tabsReducer(before, { type: 'delete-dir', path: '/Docs' })).toBe(before)
  })

  it('every invariant survives both actions: active in tabs, empty iff null, mounted a subset', () => {
    for (const action of [{ type: 'delete', path: '/b.md' }, { type: 'delete-dir', path: '/Docs' }] as const) {
      const next = tabsReducer(S(['/Docs/a.md', '/b.md', '/c.md'], '/b.md'), action)
      if (next.active !== null) expect(next.tabs).toContain(next.active)
      expect(next.tabs.length === 0).toBe(next.active === null)
      expect(new Set(next.tabs).size).toBe(next.tabs.length)
      for (const m of next.mounted) expect(next.tabs).toContain(m)
    }
  })
})
