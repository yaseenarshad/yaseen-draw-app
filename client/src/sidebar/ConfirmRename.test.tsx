/**
 * The rename confirm (⚡ YAZ-888, amending decision E / GRO-2096 for NAME changes): a name IS the
 * file on disk and the title on screen, so changing it asks first. Moves stay silent. The copy is
 * LOCKED, so it is pinned character for character; the sheet's behaviour is pinned as the mirror
 * of `ConfirmDelete`'s: own sheet never a native dialog, initial focus on CANCEL, Esc cancels,
 * Enter confirms, click-away cancels.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmRename, isNameChange, renameConfirmMessage } from './ConfirmRename'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('renameConfirmMessage (⚡ YAZ-888) — the LOCKED copy', () => {
  it('names both spellings, and promises nothing else', () => {
    expect(renameConfirmMessage('Old Note', 'New Note')).toBe("Rename 'Old Note' to 'New Note'?")
    expect(renameConfirmMessage('Sketch', 'Diagram')).toBe("Rename 'Sketch' to 'Diagram'?")
  })
})

describe('isNameChange (⚡ YAZ-888) — the rule the one door asks', () => {
  it('a changed last segment is a NAME change', () => {
    expect(isNameChange('/v/Old.excalidraw', '/v/New.excalidraw')).toBe(true)
    expect(isNameChange('/v/Docs', '/v/Notes')).toBe(true)
  })

  it('a MOVE keeps the name — it never asks', () => {
    expect(isNameChange('/v/Old.excalidraw', '/v/Docs/Old.excalidraw')).toBe(false)
    expect(isNameChange('/v/Docs/Old.excalidraw', '/v/Old.excalidraw')).toBe(false)
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

const OLD = '/v/Old Note.excalidraw'
const NEW = '/v/New Note.excalidraw'

function mount() {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ConfirmRename oldPath={OLD} newPath={NEW} onConfirm={onConfirm} onCancel={onCancel} />))
  return { el: container, onConfirm, onCancel }
}

const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)
/** Keys reach the sheet the way a user's do: from the focused button INSIDE it. */
const press = (el: HTMLElement, key: string) => act(() => void btn(el, 'Cancel')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

describe('ConfirmRename', () => {
  it('renders the LOCKED copy over PAGE names — basenames minus the extension, never file names', () => {
    const { el } = mount()
    expect(el.querySelector('.confirm__text')?.textContent).toBe("Rename 'Old Note' to 'New Note'?")
  })

  it('offers exactly Cancel and Rename', () => {
    const { el } = mount()
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Rename'])
  })

  it('focuses CANCEL, not Rename — a stray Enter from the tree or the inline rename must rename nothing', () => {
    const { el } = mount()
    expect(document.activeElement).toBe(btn(el, 'Cancel'))
  })

  it('Escape cancels and renames nothing', () => {
    const { el, onConfirm, onCancel } = mount()
    press(el, 'Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Enter confirms', () => {
    const { el, onConfirm } = mount()
    press(el, 'Enter')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  /**
   * The one departure from `ConfirmDelete`'s mirror, and the reason for it: this sheet can be
   * opened BY an Enter (the sidebar's inline rename), and React flushes its effects inside that
   * same keydown's dispatch — a window listener would hear the keystroke that opened it and
   * rename before the sheet was ever read.
   */
  it('ignores a key arriving from OUTSIDE it — the very keystroke that opened it renames nothing', () => {
    const { onConfirm, onCancel } = mount()
    act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('clicking Rename confirms', () => {
    const { el, onConfirm } = mount()
    act(() => btn(el, 'Rename')?.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('click-away cancels and renames nothing', () => {
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

  it("is an in-app dialog, labelled by its own text — never a native one (ConfirmDelete's roles)", () => {
    const { el } = mount()
    const dialog = el.querySelector('.confirm')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('confirm-rename-text')
    expect(el.querySelector('#confirm-rename-text')?.textContent).toBe("Rename 'Old Note' to 'New Note'?")
  })

  it('carries NO "Don\'t ask me again" checkbox and no danger styling — nothing is destroyed here', () => {
    const { el } = mount()
    expect(el.querySelector('.confirm__ask')).toBeNull()
    expect(el.querySelector('input[type="checkbox"]')).toBeNull()
    expect(el.querySelector('.confirm__btn--danger')).toBeNull()
  })
})
