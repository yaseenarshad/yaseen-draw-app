/**
 * The search bar's results (YAZ-803): the tree the Sidebar ALREADY holds, ranked per keystroke —
 * no index read, no watch subscription, nothing to fail. Since YAZ-1491 the list carries the
 * tree's FOLDERS as well as its files (🔒 D1): one feed, folders spliced in FIRST so a folder
 * sits above a file it ties with.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode } from '@shared/types'
import { useSearchResults } from './useSearchResults'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const file = (name: string, folder = ''): TreeNode => ({
  type: 'file',
  name: `${name}.excalidraw`,
  path: `/v/${folder === '' ? '' : `${folder}/`}${name}.excalidraw`,
  size: 1,
  mtime: 1,
  kind: 'drawing',
})

let reactRoot: Root | null = null
let container: HTMLElement | null = null
/** The rendered rows' labels — the hook's whole output, flattened for assertions. */
const labels = () => (container?.textContent === '' ? [] : (container?.textContent ?? '').split('|').filter((s) => s !== ''))

/** The Sidebar's own `dirs` (🔒 D1, YAZ-1491): absolute paths in tree order. */
const NO_DIRS: readonly string[] = []

function Harness({ query, dirs, files }: { query: string; dirs: readonly string[]; files: readonly TreeNode[] }) {
  const results = useSearchResults('/v', query, dirs, files)
  return <>{results.map((r) => `${r.kind === 'dir' ? '📁' : ''}${r.label}|`)}</>
}

function mount(files: readonly TreeNode[], query: string, dirs: readonly string[] = NO_DIRS) {
  container = document.createElement('div')
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  const render = (q: string, nextFiles: readonly TreeNode[] = files, nextDirs: readonly string[] = dirs) =>
    act(() => reactRoot?.render(<StrictMode><Harness query={q} dirs={nextDirs} files={nextFiles} /></StrictMode>))
  render(query)
  return { rerender: render }
}

afterEach(() => {
  act(() => reactRoot?.unmount())
  reactRoot = null
  container?.remove()
  container = null
})

describe('useSearchResults (YAZ-803)', () => {
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

  it("a grown tree is searchable on the very next render — the feed IS the Sidebar's tree", () => {
    const { rerender } = mount([file('Alpha')], 'a')
    expect(labels()).toEqual(['Alpha'])
    rerender('a', [file('Alpha'), file('Anchor')])
    expect(labels()).toEqual(['Alpha', 'Anchor'])
  })

  it("the tree's folders are rows too, ahead of a same-rank file (🔒 D1, YAZ-1491)", () => {
    mount([file('Archive'), file('Archived plan')], 'archive', ['/v/Archive', '/v/Archive/Old'])
    // Exact bucket: the folder sits above the file; prefix bucket: the file; `Old` never matches.
    expect(labels()).toEqual(['📁Archive', 'Archive', 'Archived plan'])
  })

  it('folder rows stand on their own — a tree with no files still answers', () => {
    mount([], 'arch', ['/v/Archive'])
    expect(labels()).toEqual(['📁Archive'])
  })

  it('a file never matches on its folder (🔒 D3, YAZ-739)', () => {
    mount([file('Note', 'Archive')], 'archive', NO_DIRS)
    expect(labels()).toEqual([])
  })

  it('no match is an empty list, not an error surface', () => {
    mount([file('Alpha')], 'zzzz', ['/v/Archive'])
    expect(labels()).toEqual([])
  })
})
