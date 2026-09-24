/**
 * The tree's rows (🔒 YAZ-1802 D15): a draw.io diagram wears its type mark in the slot a folder's
 * chevron takes, every other file row keeps that slot EMPTY, and so a file's name starts where a
 * sibling folder's does at any depth — in the Files lens and the Favorites lens alike (one `Tree`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode } from '@shared/types'
import { Tree } from './Tree'

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const file = (path: string, kind: 'drawing' | 'diagram' | null): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 1, kind })
const dir = (path: string, children: TreeNode[]): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })

const TREE = [
  dir('/v/a', [dir('/v/a/b', [dir('/v/a/b/c', []), file('/v/a/b/Deep.drawio', 'diagram'), file('/v/a/b/Deep.excalidraw', 'drawing')])]),
  file('/v/Flow.drawio', 'diagram'),
  file('/v/A very long diagram name that will not fit in the sidebar.drawio', 'diagram'),
  file('/v/Note.excalidraw', 'drawing'),
  file('/v/Flow.drawio.svg', null),
]

function mount(reorder = false): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const move = { dragging: null, dropDir: null, start: vi.fn(), end: vi.fn(), hover: vi.fn(), drop: vi.fn() }
  act(() =>
    root?.render(
      <Tree
        nodes={TREE}
        dirPath="/v"
        expanded={new Set(['/v/a', '/v/a/b'])}
        activeFile={null}
        onToggle={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenFileBackground={vi.fn()}
        onOpenDefault={vi.fn()}
        onNodeContextMenu={vi.fn()}
        pending={null}
        renaming={null}
        move={move}
        selection={{ paths: new Set(), toggle: vi.fn(), set: vi.fn() }}
        reorder={reorder ? { dragging: null, over: null, start: vi.fn(), end: vi.fn(), hover: vi.fn(), drop: vi.fn() } : undefined}
      />,
    ),
  )
  return host
}

const row = (host: HTMLElement, path: string) => host.querySelector<HTMLElement>(`[data-path="${path}"]`)!

describe('Tree rows (🔒 YAZ-1802 D15)', () => {
  it('marks a diagram row once, and gives every other file row the same slot, empty', () => {
    const host = mount()
    expect(row(host, '/v/Flow.drawio').querySelectorAll('[aria-label="draw.io diagram"]')).toHaveLength(1)
    for (const path of ['/v/Note.excalidraw', '/v/Flow.drawio.svg']) {
      const slot = row(host, path).firstElementChild
      expect(slot?.className).toBe('tree__kind')
      expect(slot?.getAttribute('aria-hidden')).toBe('true')
      expect(slot?.childElementCount).toBe(0)
    }
  })

  it('starts a file`s name where a sibling folder`s starts: the same indent, then one 14 px slot — at depth 0 and 2', () => {
    const host = mount()
    const lead = (el: HTMLElement) => [el.style.paddingLeft, el.firstElementChild?.className.split(' ')[0]]
    expect(lead(row(host, '/v/Flow.drawio'))).toEqual(['8px', 'tree__kind'])
    expect(lead(row(host, '/v/a'))).toEqual(['8px', 'tree__chevron'])
    expect(lead(row(host, '/v/a/b/Deep.drawio'))).toEqual(['36px', 'tree__kind'])
    expect(lead(row(host, '/v/a/b/Deep.excalidraw'))).toEqual(['36px', 'tree__kind'])
    expect(lead(row(host, '/v/a/b/c'))).toEqual(['36px', 'tree__chevron'])
  })

  it('a long diagram name is one label after the mark — the label is what ellipses, never the mark', () => {
    const long = row(mount(), '/v/A very long diagram name that will not fit in the sidebar.drawio')
    expect([...long.children].map((c) => c.className)).toEqual(['tree__kind', 'tree__label'])
    expect(long.querySelector('.tree__label')?.textContent).toBe('A very long diagram name that will not fit in the sidebar')
  })

  it('keeps the mark in the Favorites lens (a reorderable tree)', () => {
    expect(row(mount(true), '/v/Flow.drawio').querySelector('[aria-label="draw.io diagram"]')).not.toBeNull()
  })
})
