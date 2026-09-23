/**
 * The sidebar's cloud-off icon (YAZ-1801 D3): a file the last sync pass held back as over
 * GitHub's limit wears a red broken cloud right of its name — boards and non-board files alike,
 * at any depth — labelled for a screen reader and on hover. Every other row wears nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { TreeNode } from '@shared/types'
import { TOO_LARGE_LABEL } from '../lib/syncAttention'
import { Tree, type TreeFileMove, type TreeSelection } from './Tree'

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const file = (path: string, kind: 'drawing' | null = 'drawing'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, size: 1, mtime: 0, kind })
const NODES: TreeNode[] = [
  { type: 'dir', name: 'Folder', path: '/v/Folder', children: [file('/v/Folder/Nested huge.excalidraw')] },
  file('/v/Big video.mov', null),
  file('/v/Small.excalidraw'),
  file('/v/Too big.excalidraw'),
]
const MOVE: TreeFileMove = { dragging: null, dropDir: null, start: vi.fn(), end: vi.fn(), hover: vi.fn(), drop: vi.fn() }
const SELECTION: TreeSelection = { paths: new Set(), toggle: vi.fn(), set: vi.fn() }

function mount(tooLarge?: ReadonlySet<string>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <Tree
        nodes={NODES}
        dirPath="/v"
        expanded={new Set(['/v/Folder'])}
        activeFile={null}
        onToggle={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenFileBackground={vi.fn()}
        onOpenDefault={vi.fn()}
        onNodeContextMenu={vi.fn()}
        pending={null}
        renaming={null}
        move={MOVE}
        selection={SELECTION}
        tooLarge={tooLarge}
      />,
    ),
  )
  return container
}

const iconOn = (el: HTMLElement, path: string) => el.querySelector(`[data-path="${CSS.escape(path)}"] .tree__too-large`)

describe('Tree — files over GitHub\'s limit (YAZ-1801 D3)', () => {
  it('marks exactly the held-back rows — a board, a non-board file, a nested board — with a labelled icon', () => {
    const el = mount(new Set(['/v/Too big.excalidraw', '/v/Big video.mov', '/v/Folder/Nested huge.excalidraw']))
    for (const path of ['/v/Too big.excalidraw', '/v/Big video.mov', '/v/Folder/Nested huge.excalidraw']) {
      const icon = iconOn(el, path)
      expect(icon, path).not.toBeNull()
      expect(icon?.getAttribute('aria-label')).toBe(TOO_LARGE_LABEL)
      expect(icon?.getAttribute('title')).toBe("Over GitHub's 100 MB limit — only on this Mac")
    }
    expect(iconOn(el, '/v/Small.excalidraw')).toBeNull()
  })

  it('shows nothing when no list is given', () => {
    const el = mount()
    expect(el.querySelectorAll('.tree__too-large')).toHaveLength(0)
  })
})
