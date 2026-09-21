/**
 * The delete-comment sheet's copy and keyboard behaviour (YAZ-1472, 🔒 D17) — the shape of
 * `sidebar/ConfirmDelete.test.tsx`, minus "Don't ask me again": a comment has no Trash behind
 * it, so the sheet is the only undo there is and always asks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmDeleteComment, deleteCommentMessage } from './ConfirmDeleteComment'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('deleteCommentMessage', () => {
  it('no label: "this comment", and that it cannot be undone', () => {
    expect(deleteCommentMessage(null, 0)).toBe('Delete this comment? This cannot be undone.')
  })

  it('a label names the number the row wears', () => {
    expect(deleteCommentMessage('#3', 0)).toBe('Delete comment #3? This cannot be undone.')
    expect(deleteCommentMessage('#3.1', 0)).toBe('Delete comment #3.1? This cannot be undone.')
  })

  it('one reply goes with it, singular', () => {
    expect(deleteCommentMessage('#3', 1)).toBe('Delete comment #3 and its reply? This cannot be undone.')
  })

  it('several replies go with it, counted', () => {
    expect(deleteCommentMessage('#3', 2)).toBe('Delete comment #3 and its 2 replies? This cannot be undone.')
    expect(deleteCommentMessage(null, 2)).toBe('Delete this comment and its 2 replies? This cannot be undone.')
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

function mount(label: string | null = '#3', replies = 0) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ConfirmDeleteComment label={label} replies={replies} onConfirm={onConfirm} onCancel={onCancel} />))
  return { el: container, onConfirm, onCancel }
}

const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

describe('ConfirmDeleteComment', () => {
  it('focuses CANCEL, not Delete — a stray Enter must destroy nothing', () => {
    const { el } = mount()
    expect(document.activeElement).toBe(btn(el, 'Cancel'))
  })

  it('Escape cancels and deletes nothing', () => {
    const { onConfirm, onCancel } = mount()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('click-away cancels and deletes nothing', () => {
    const { el, onConfirm, onCancel } = mount()
    act(() => void el.querySelector('.confirm-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a click inside the sheet does NOT cancel it', () => {
    const { el, onCancel } = mount()
    act(() => void el.querySelector('.confirm')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Enter confirms', () => {
    const { onConfirm, onCancel } = mount()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('the Delete button confirms; the Cancel button cancels', () => {
    const a = mount()
    act(() => btn(a.el, 'Delete')?.click())
    expect(a.onConfirm).toHaveBeenCalledTimes(1)
    const b = mount()
    act(() => btn(b.el, 'Cancel')?.click())
    expect(b.onCancel).toHaveBeenCalledTimes(1)
    expect(b.onConfirm).not.toHaveBeenCalled()
  })

  it('is an in-app dialog labelled by its own text, with NO "Don\'t ask me again" — the sheet is the only undo', () => {
    const { el } = mount('#3', 2)
    const dialog = el.querySelector('.confirm')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('confirm-delete-comment-text')
    expect(el.querySelector('#confirm-delete-comment-text')?.textContent).toBe('Delete comment #3 and its 2 replies? This cannot be undone.')
    expect(el.querySelector('.confirm__ask')).toBeNull()
    expect(el.querySelector('input[type="checkbox"]')).toBeNull()
    expect(btn(el, 'Delete')?.classList.contains('confirm__btn--danger')).toBe(true)
  })
})
