/**
 * The search bar's results (YAZ-803; 2H/YAZ-1814): the tree the Sidebar ALREADY holds, turned into
 * the ⌘K catalog and ranked per keystroke — no index read, no watch subscription, nothing to fail.
 * The catalog carries the tree's FOLDERS as well as its drawings (🔒 YAZ-1491 D1), folders first; it is
 * built LAZILY, on the first non-empty query, and stays live from then on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode } from '@shared/types'
import * as catalog from './searchCandidates'
import { useSearchResults } from './useSearchResults'


const file = (name: string, folder = ''): TreeNode => ({
  type: 'file',
  name: `${name}.excalidraw`,
  path: `/v/${folder === '' ? '' : `${folder}/`}${name}.excalidraw`,
  size: 1,
  mtime: 1,
  kind: 'drawing',
})

const dir = (name: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name, path: `/v/${name}`, children })

let reactRoot: Root | null = null
let container: HTMLElement | null = null
/** The rendered rows' labels — the hook's whole output, flattened for assertions. */
const labels = () => (container?.textContent === '' ? [] : (container?.textContent ?? '').split('|').filter((s) => s !== ''))

function Harness({ query, tree }: { query: string; tree: readonly TreeNode[] | null }) {
  const results = useSearchResults('/v', query, tree)
  return <>{results.map((r) => `${r.kind === 'dir' ? '📁' : ''}${r.label}|`)}</>
}

function mount(tree: readonly TreeNode[] | null, query: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  const render = (q: string, nextTree: readonly TreeNode[] | null = tree) =>
    act(() => reactRoot?.render(<StrictMode><Harness query={q} tree={nextTree} /></StrictMode>))
  render(query)
  return { rerender: render }
}

afterEach(() => {
  act(() => reactRoot?.unmount())
  reactRoot = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

describe('useSearchResults', () => {
  it('ranks the tree it was handed against the query', () => {
    mount([file('Meeting notes'), file('Other')], 'meet')
    expect(labels()).toEqual(['Meeting notes'])
  })

  it('a drawing reads under its name, never its file name', () => {
    mount([file('Alpha')], 'alpha')
    expect(labels()).toEqual(['Alpha'])
  })

  it('an empty or whitespace query yields no rows at all (the shared matcher would match everything)', () => {
    const { rerender } = mount([file('Alpha'), file('Beta')], '')
    expect(labels()).toEqual([])
    rerender('   ')
    expect(labels()).toEqual([])
    rerender('a')
    expect(labels()).toEqual(['Alpha', 'Beta'])
  })

  it('a grown tree is searchable on the very next render — a drawing made a second ago needs no restart', () => {
    const { rerender } = mount([file('Alpha')], 'a')
    expect(labels()).toEqual(['Alpha'])
    rerender('a', [file('Alpha'), file('Anchor')])
    expect(labels()).toEqual(['Alpha', 'Anchor'])
  })

  it('the tree`s folders are rows too, ahead of a same-rank drawing (🔒 D1, YAZ-1491)', () => {
    mount([dir('Archive', [dir('Old')]), file('Archive'), file('Archived plan')], 'archive')
    // Exact bucket: the folder sits above the file; prefix bucket: the file; `Old` never matches.
    expect(labels()).toEqual(['📁Archive', 'Archive', 'Archived plan'])
  })

  it('folder rows stand on their own — a tree with no drawings still answers', () => {
    mount([dir('Archive')], 'arch')
    expect(labels()).toEqual(['📁Archive'])
  })

  it('a drawing never matches on its folder (🔒 D3, YAZ-739)', () => {
    mount([dir('Archive', [file('Note', 'Archive')])], 'note').rerender('archive')
    expect(labels()).toEqual(['📁Archive'])
  })

  it('no match is an empty list, not an error surface', () => {
    mount([file('Alpha'), dir('Archive')], 'zzzz')
    expect(labels()).toEqual([])
  })

  it('a vault still loading its tree answers nothing rather than throwing', () => {
    mount(null, 'a')
    expect(labels()).toEqual([])
  })

  describe('the lazy, latching feed (2H)', () => {
    it('builds NOTHING until the first non-empty query', () => {
      const build = vi.spyOn(catalog, 'buildDrawingCatalog')
      const { rerender } = mount([file('Alpha')], '')
      expect(build).not.toHaveBeenCalled()
      rerender('a')
      expect(build).toHaveBeenCalled()
      expect(labels()).toEqual(['Alpha'])
    })

    it('keeps the catalog after the query is cleared — the second search pays nothing', () => {
      const { rerender } = mount([file('Alpha')], 'a')
      const build = vi.spyOn(catalog, 'buildDrawingCatalog')
      rerender('')
      rerender('al')
      rerender('alp')
      expect(build).not.toHaveBeenCalled()
      expect(labels()).toEqual(['Alpha'])
    })

    it('rebuilds once per NEW tree while latched, and not per keystroke', () => {
      const { rerender } = mount([file('Alpha')], 'a')
      const build = vi.spyOn(catalog, 'buildDrawingCatalog')
      rerender('al')
      rerender('alp')
      expect(build).not.toHaveBeenCalled()
      // A NEW tree does rebuild — once per tree, not once per keystroke. (StrictMode renders
      // twice, so the memo runs twice for the one tree; the assertion that matters is above.)
      rerender('alp', [file('Alpha'), file('Alpine')])
      expect(build).toHaveBeenCalled()
      expect(labels()).toEqual(['Alpha', 'Alpine'])
    })
  })
})
