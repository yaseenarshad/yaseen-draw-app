/** The confirm sheet's copy and keyboard behaviour (GRO-2272 `C2-`). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmDelete, deleteConfirmMessage, type DeleteTarget } from './ConfirmDelete'


describe('deleteConfirmMessage', () => {
  it('a file says only what happens', () => {
    expect(deleteConfirmMessage({ path: '/v/Roadmap.excalidraw', kind: 'file' })).toBe('Delete "Roadmap.excalidraw"? It moves to the Trash.')
  })


  it('an unavailable backlink count prints no count line at all', () => {
    expect(deleteConfirmMessage({ path: '/v/Roadmap.md', kind: 'file' })).toBe('Delete "Roadmap.md"? It moves to the Trash.')
  })

  it('a folder reports its contents, pluralised on each half', () => {
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { files: 12, folders: 2 } })).toBe('Delete "Docs"? 12 files and 2 folders move to the Trash.')
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { files: 1, folders: 1 } })).toBe('Delete "Docs"? 1 file and 1 folder move to the Trash.')
    // A single item takes a singular verb: "1 file moves", not "1 file move".
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { files: 1, folders: 0 } })).toBe('Delete "Docs"? 1 file moves to the Trash.')
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { files: 0, folders: 1 } })).toBe('Delete "Docs"? 1 folder moves to the Trash.')
  })

  it('a folder with only files, or only subfolders, omits the empty half', () => {
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { files: 4, folders: 0 } })).toBe('Delete "Docs"? 4 files move to the Trash.')
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { files: 0, folders: 3 } })).toBe('Delete "Docs"? 3 folders move to the Trash.')
  })

  it('an EMPTY folder never prints "0 files and 0 folders"', () => {
    expect(deleteConfirmMessage({ path: '/v/Docs', kind: 'dir', children: { files: 0, folders: 0 } })).toBe('Delete "Docs"? It moves to the Trash.')
  })
})

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount(target: DeleteTarget, over: { onConfirm?: (d: boolean) => void; onCancel?: () => void } = {}) {
  const onConfirm = vi.fn(over.onConfirm)
  const onCancel = vi.fn(over.onCancel)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ConfirmDelete target={target} onConfirm={onConfirm} onCancel={onCancel} />))
  return { el: container, onConfirm, onCancel }
}

const FILE: DeleteTarget = { path: '/v/a.excalidraw', kind: 'file' }
const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

describe('ConfirmDelete', () => {
  it('focuses CANCEL, not Delete — a stray Enter from the tree must destroy nothing', () => {
    const { el } = mount(FILE)
    expect(document.activeElement).toBe(btn(el, 'Cancel'))
  })

  it('Escape cancels and deletes nothing', () => {
    const { onConfirm, onCancel } = mount(FILE)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('click-away cancels and deletes nothing', () => {
    const { el, onConfirm, onCancel } = mount(FILE)
    act(() => void el.querySelector('.confirm-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a click inside the sheet does NOT cancel it', () => {
    const { el, onCancel } = mount(FILE)
    act(() => void el.querySelector('.confirm')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Enter confirms', () => {
    const { onConfirm } = mount(FILE)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('reports the "Don\'t ask me again" checkbox state to onConfirm', () => {
    const { el, onConfirm } = mount(FILE)
    const box = el.querySelector<HTMLInputElement>('.confirm__ask input')
    act(() => void box?.click())
    act(() => btn(el, 'Delete')?.click())
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('is an in-app dialog, labelled by its own text — never a native one', () => {
    const { el } = mount(FILE)
    const dialog = el.querySelector('.confirm')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(el.querySelector('#confirm-delete-text')?.textContent).toContain('moves to the Trash')
  })
})
