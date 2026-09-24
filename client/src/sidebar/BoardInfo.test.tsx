import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileNode } from '@shared/treeSort'
import { BoardInfo } from './BoardInfo'
const NOW = Date.UTC(2026, 8, 22, 12, 0)
const board = (over: Partial<FileNode> = {}): FileNode => ({ type: 'file', name: 'Plan.excalidraw', path: '/v/Projects/Plan.excalidraw', size: 1536, mtime: NOW - 3_600_000, kind: 'drawing', ...over })

let root: Root | null = null
let el: HTMLElement | null = null
const render = (node: FileNode, vault = '/v') => {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<BoardInfo node={node} root={vault} now={NOW} />))
  return el
}
const rows = (host: HTMLElement) => Object.fromEntries([...host.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]))
afterEach(() => {
  act(() => root?.unmount())
  el?.remove()
})

describe('BoardInfo (🔒 YAZ-1835 D6/D7)', () => {
  it('shows the seven rows off the tree node: name, type, vault-relative folder, size, the two block dates and the disk time', () => {
    const r = rows(render(board({ meta: { createdAt: NOW - 2 * 86_400_000, updatedAt: NOW - 3_600_000 } })))
    expect(r.Name).toBe('Plan.excalidraw')
    expect(r.Type).toBe('Excalidraw drawing')
    expect(r.Folder).toBe('Projects')
    expect(r.Size).toBe('1.5 KB')
    expect(r.Created).toMatch(/2026, .*· 2 days ago$/)
    expect(r.Updated).toMatch(/· 1 hour ago$/)
    expect(r['On disk']).toMatch(/· 1 hour ago$/)
  })

  it('names the engine in Type (🔒 YAZ-1802 D13) — the tree hides the extension that would', () => {
    expect(rows(render(board({ name: 'Flow.drawio', path: '/v/Flow.drawio', kind: 'diagram' }))).Type).toBe('draw.io diagram')
  })

  it('a board without a block says so for the two dates and still shows the disk time; a root-level board reads "/"', () => {
    const r = rows(render(board({ path: '/v/Plan.excalidraw' })))
    expect(r.Folder).toBe('/')
    expect(r.Created).toBe('Not stamped yet · written on the next save')
    expect(r.Updated).toBe('Not stamped yet · written on the next save')
    expect(r['On disk']).toMatch(/· 1 hour ago$/)
  })
})
