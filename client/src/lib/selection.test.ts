/**
 * Pure multi-select reducer (YAZ-1336, 🔒 D1): the sidebar's selection is a path-keyed
 * `ReadonlySet<string>` — toggle-accumulate is the ONLY building gesture (🔒 D2 amended:
 * Yasin ruled toggle, range is out of v1). Reference-equality bailouts matter: Sidebar
 * feeds this to React state, so a no-op action must return the SAME set to skip a render.
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_SELECTION, orderedSelection, selectionReducer } from './selection'

const toggle = (sel: ReadonlySet<string>, path: string) => selectionReducer(sel, { type: 'toggle', path })

describe('selectionReducer (YAZ-1336)', () => {
  it('toggle adds an absent path and removes a present one', () => {
    const one = toggle(EMPTY_SELECTION, '/v/a.md')
    expect([...one]).toEqual(['/v/a.md'])
    const two = toggle(one, '/v/b.md')
    expect([...two].sort()).toEqual(['/v/a.md', '/v/b.md'])
    const back = toggle(two, '/v/a.md')
    expect([...back]).toEqual(['/v/b.md'])
  })

  it('toggle never mutates the previous set (and never the shared empty set)', () => {
    const one = toggle(EMPTY_SELECTION, '/v/a.md')
    toggle(one, '/v/b.md')
    toggle(one, '/v/a.md')
    expect([...one]).toEqual(['/v/a.md'])
    expect(EMPTY_SELECTION.size).toBe(0)
  })

  it('clear empties the selection and bails out by reference when already empty', () => {
    const two = toggle(toggle(EMPTY_SELECTION, '/v/a.md'), '/v/b.md')
    const cleared = selectionReducer(two, { type: 'clear' })
    expect(cleared.size).toBe(0)
    expect(selectionReducer(cleared, { type: 'clear' })).toBe(cleared)
  })

  it('prune drops paths that stopped existing and bails out by reference when nothing changed', () => {
    const two = toggle(toggle(EMPTY_SELECTION, '/v/a.md'), '/v/b.md')
    expect(selectionReducer(two, { type: 'prune', exists: () => true })).toBe(two)
    const pruned = selectionReducer(two, { type: 'prune', exists: (p) => p === '/v/b.md' })
    expect([...pruned]).toEqual(['/v/b.md'])
  })
})

/**
 * ⚡ Fable's ruling on YAZ-1338: the SELECTION is the truth, the DOM is only the ORDER. So the
 * list always holds every selected path — the ones on screen in the order the panel draws them,
 * the rest appended — and its length is the selection's own size, whatever the user folded away.
 */
describe('orderedSelection (YAZ-1337, as ⚡ YAZ-1338 rules it)', () => {
  /** Rows exactly as both trees draw them: `.tree__row` carrying `data-path` (revealRow's mark). */
  const panel = (...paths: string[]): HTMLElement => {
    const host = document.createElement('div')
    for (const path of paths) {
      const row = document.createElement('button')
      row.className = 'tree__row'
      row.dataset.path = path
      host.append(row)
    }
    return host
  }

  it('orders by the rows on screen, never by the order the paths were picked', () => {
    const selected = new Set(['/v/c.md', '/v/a.md'])
    expect(orderedSelection(selected, panel('/v/a.md', '/v/b.md', '/v/c.md'))).toEqual(['/v/a.md', '/v/c.md'])
  })

  it('appends a selected path with no row — a folded folder hides the row, not the pick', () => {
    const selected = new Set(['/v/sub/hidden.md', '/v/a.md'])
    expect(orderedSelection(selected, panel('/v/a.md'))).toEqual(['/v/a.md', '/v/sub/hidden.md'])
  })

  it('counts one path ONCE however many rows draw it (🔒 D3: a page under two parents)', () => {
    expect(orderedSelection(new Set(['/v/Shared.md']), panel('/v/Shared.md', '/v/Shared.md'))).toEqual(['/v/Shared.md'])
  })

  it('never returns an unselected path, and always returns every selected one', () => {
    const selected = new Set(['/v/a.md', '/v/z.md'])
    const out = orderedSelection(selected, panel('/v/a.md', '/v/other.md'))
    expect(out).toEqual(['/v/a.md', '/v/z.md'])
    expect(out).toHaveLength(selected.size)
  })

  it('falls back to the set own order with no panel to read (the collapsed sidebar, YAZ-1338)', () => {
    expect(orderedSelection(new Set(['/v/b.md', '/v/a.md']), null)).toEqual(['/v/b.md', '/v/a.md'])
    expect(orderedSelection(EMPTY_SELECTION, null)).toEqual([])
  })
})
