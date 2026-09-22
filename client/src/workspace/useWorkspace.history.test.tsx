/**
 * Per-tab back/forward history (YAZ-721, ruling D1): a path-keyed side table on `TabsState`,
 * renderer-only and session-only. These tests are the contract; the reducer must satisfy
 * them without changing the existing main-tab reducer expectations beyond `history: {}`.
 */
import { describe, expect, it } from 'vitest'
import { tabsReducer, type TabsState } from './useWorkspace'

const A = '/v/a.excalidraw'
const B = '/v/b.excalidraw'
const C = '/v/c.excalidraw'
const D = '/v/d.excalidraw'

const nav = (s: TabsState, path: string): TabsState => tabsReducer(s, { type: 'open-current', path })
const fresh = (): TabsState => nav({ tabs: [], active: null, mounted: [], history: {} }, A)
/** A → B → C in one tab. */
const abc = (): TabsState => nav(nav(fresh(), B), C)
/** A second tab on `path`, appended and activated — ⌘-click, then the tab strip. */
const secondTab = (s: TabsState, path: string): TabsState => tabsReducer(tabsReducer(s, { type: 'open-background', path }), { type: 'activate', path })

describe('history recording', () => {
  it('same-tab navigation pushes and re-keys the record under the new path', () => {
    const s = abc()
    expect(s.tabs).toEqual([C])
    expect(s.history).toEqual({ [C]: { entries: [A, B, C], index: 2 } })
  })

  it('navigating after going back discards the forward stack', () => {
    const s = nav(tabsReducer(abc(), { type: 'back' }), D)
    expect(s.active).toBe(D)
    expect(s.history).toEqual({ [D]: { entries: [A, B, D], index: 2 } })
  })

  it('activating an already-open tab records nothing on either tab', () => {
    const two = tabsReducer(abc(), { type: 'open-background', path: D })
    const s = nav(two, D)
    expect(s.active).toBe(D)
    expect(s.history).toEqual(two.history)
  })

  it('a tab opened without navigating has no record until it navigates', () => {
    const s = secondTab(fresh(), B)
    expect(s.history).toEqual({})
    const moved = nav(s, C)
    expect(moved.history).toEqual({ [C]: { entries: [B, C], index: 1 } })
  })
})

describe('back / forward', () => {
  it('back swaps the previous page into the same slot and keeps the forward entries', () => {
    const s = tabsReducer(abc(), { type: 'back' })
    expect(s.tabs).toEqual([B])
    expect(s.active).toBe(B)
    expect(s.mounted).toEqual([B])
    expect(s.history).toEqual({ [B]: { entries: [A, B, C], index: 1 } })
  })

  it('forward after back returns to the later page', () => {
    const s = tabsReducer(tabsReducer(abc(), { type: 'back' }), { type: 'forward' })
    expect(s.active).toBe(C)
    expect(s.history).toEqual({ [C]: { entries: [A, B, C], index: 2 } })
  })

  it('back at the start and forward at the end return the SAME state object', () => {
    const start = tabsReducer(tabsReducer(abc(), { type: 'back' }), { type: 'back' })
    expect(tabsReducer(start, { type: 'back' })).toBe(start)
    const end = abc()
    expect(tabsReducer(end, { type: 'forward' })).toBe(end)
  })

  it('with no active tab or no record, back and forward are no-ops', () => {
    const empty: TabsState = { tabs: [], active: null, mounted: [], history: {} }
    expect(tabsReducer(empty, { type: 'back' })).toBe(empty)
    const noRecord: TabsState = { tabs: [A], active: A, mounted: [A], history: {} }
    expect(tabsReducer(noRecord, { type: 'forward' })).toBe(noRecord)
  })

  it('back to a page that is open in ANOTHER tab activates that tab; both histories untouched', () => {
    const s = tabsReducer(abc(), { type: 'open-background', path: B })
    const next = tabsReducer(s, { type: 'back' })
    expect(next.tabs).toEqual([C, B])
    expect(next.active).toBe(B)
    expect(next.history).toEqual(s.history)
  })

  it('operates on the active tab only: the other tab keeps its own record', () => {
    const s = nav(secondTab(abc(), D), B)
    // tab 1: [A,B,C] at C · tab 2: [D,B] at B
    const back = tabsReducer(s, { type: 'back' })
    expect(back.tabs).toEqual([C, D])
    expect(back.history).toEqual({ [C]: { entries: [A, B, C], index: 2 }, [D]: { entries: [D, B], index: 0 } })
  })
})

describe('history consistency through rename, delete, close', () => {
  it('rename remaps both the key and every entry', () => {
    const s = tabsReducer(abc(), { type: 'rename', oldPath: C, newPath: D })
    expect(s.history).toEqual({ [D]: { entries: [A, B, D], index: 2 } })
    const mid = tabsReducer(abc(), { type: 'rename', oldPath: B, newPath: D })
    expect(mid.history).toEqual({ [C]: { entries: [A, D, C], index: 2 } })
  })

  it('rename-dir remaps by prefix inside entries', () => {
    const s = tabsReducer(abc(), { type: 'rename-dir', oldPath: '/v', newPath: '/w' })
    expect(s.history).toEqual({ '/w/c.excalidraw': { entries: ['/w/a.excalidraw', '/w/b.excalidraw', '/w/c.excalidraw'], index: 2 } })
  })

  it('delete prunes the path from every surviving record and clamps the index', () => {
    const two = tabsReducer(abc(), { type: 'open-background', path: D })
    const s = tabsReducer(two, { type: 'delete', path: B })
    expect(s.tabs).toEqual([C, D])
    expect(s.history).toEqual({ [C]: { entries: [A, C], index: 1 } })
    const backed = tabsReducer(tabsReducer(abc(), { type: 'back' }), { type: 'back' }) // at A, idx 0
    const pruned = tabsReducer(backed, { type: 'delete', path: C })
    expect(pruned.history).toEqual({ [A]: { entries: [A, B], index: 0 } })
  })

  it('deleting the active page drops its record; the heir keeps its own', () => {
    const two = nav(secondTab(abc(), D), B) // tab2 [D,B] at B
    const s = tabsReducer(two, { type: 'delete', path: B })
    expect(s.active).toBe(C)
    expect(s.history).toEqual({ [C]: { entries: [A, C], index: 1 } })
  })

  it('delete-dir prunes every path under the folder from a surviving tab that is NOT under it', () => {
    const s = nav(abc(), '/x/z.excalidraw') // [A,B,C,/x/z.excalidraw] at z
    const pruned = tabsReducer(s, { type: 'delete-dir', path: '/v' })
    expect(pruned.tabs).toEqual(['/x/z.excalidraw'])
    expect(pruned.history).toEqual({ '/x/z.excalidraw': { entries: ['/x/z.excalidraw'], index: 0 } })
  })

  it('close drops the record of the closed tab only', () => {
    const two = nav(secondTab(abc(), D), B)
    const s = tabsReducer(two, { type: 'close', path: B })
    expect(s.history).toEqual({ [C]: { entries: [A, B, C], index: 2 } })
  })

  it('reset empties history', () => {
    const s = tabsReducer(abc(), { type: 'reset', tabs: [A, B], active: A })
    expect(s.history).toEqual({})
  })
})
