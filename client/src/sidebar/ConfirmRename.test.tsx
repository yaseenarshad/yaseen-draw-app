/**
 * The rename confirm (⚡ YAZ-888, amending decision E / GRO-2096 for NAME changes): renaming
 * triggers a chain — the file on disk, then links across the vault — so a name change asks
 * first, with the honest count. Moves stay silent. The copy is LOCKED, so it is pinned
 * character for character; the sheet's behaviour is pinned against `ConfirmTurnBack`'s, which
 * it mirrors: own sheet never a native dialog, initial focus on CANCEL, Esc cancels, Enter
 * confirms, click-away cancels.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmRename, isNameChange, renameConfirmMessage } from './ConfirmRename'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('renameConfirmMessage (⚡ YAZ-888) — the LOCKED copy', () => {
  it('names both spellings and the count, plural and singular', () => {
    expect(renameConfirmMessage('Old Note', 'New Note', 3)).toBe("Rename 'Old Note' to 'New Note'? Links in 3 notes will be updated.")
    expect(renameConfirmMessage('Old Note', 'New Note', 1)).toBe("Rename 'Old Note' to 'New Note'? Links in 1 note will be updated.")
  })

  it('a page nobody links to says so instead of promising an update of nothing', () => {
    expect(renameConfirmMessage('Old Note', 'New Note', 0)).toBe("Rename 'Old Note' to 'New Note'? No other notes link to it.")
  })
})

describe('isNameChange (⚡ YAZ-888) — the rule the one door asks', () => {
  it('a changed last segment is a NAME change', () => {
    expect(isNameChange('/v/Old.md', '/v/New.md')).toBe(true)
    expect(isNameChange('/v/Docs', '/v/Notes')).toBe(true)
  })

  it('a MOVE keeps the name — it never asks', () => {
    expect(isNameChange('/v/Old.md', '/v/Docs/Old.md')).toBe(false)
    expect(isNameChange('/v/Docs/Old.md', '/v/Old.md')).toBe(false)
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

const OLD = '/v/Old Note.md'
const NEW = '/v/New Note.md'

function mount(count: number) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ConfirmRename oldPath={OLD} newPath={NEW} count={count} onConfirm={onConfirm} onCancel={onCancel} />))
  return { el: container, onConfirm, onCancel }
}

const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)
/** Keys reach the sheet the way a user's do: from the focused button INSIDE it. */
const press = (el: HTMLElement, key: string) => act(() => void btn(el, 'Cancel')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

describe('ConfirmRename', () => {
  it('renders the LOCKED copy over PAGE names — basenames minus the extension, never file names', () => {
    const { el } = mount(2)
    expect(el.querySelector('.confirm__text')?.textContent).toBe("Rename 'Old Note' to 'New Note'? Links in 2 notes will be updated.")
  })

  it('offers exactly Cancel and Rename', () => {
    const { el } = mount(0)
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Rename'])
  })

  it('focuses CANCEL, not Rename — a stray Enter from the tree or the title input must rename nothing', () => {
    const { el } = mount(0)
    expect(document.activeElement).toBe(btn(el, 'Cancel'))
  })

  it('Escape cancels and renames nothing', () => {
    const { el, onConfirm, onCancel } = mount(1)
    press(el, 'Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Enter confirms', () => {
    const { el, onConfirm } = mount(1)
    press(el, 'Enter')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  /**
   * The one departure from `ConfirmTurnBack`'s mirror, and the reason for it: this sheet can be
   * opened BY an Enter (the title input, the sidebar's inline rename), and React flushes its
   * effects inside that same keydown's dispatch — a window listener would hear the keystroke
   * that opened it and rename before the sheet was ever read.
   */
  it('ignores a key arriving from OUTSIDE it — the very keystroke that opened it renames nothing', () => {
    const { onConfirm, onCancel } = mount(1)
    act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('clicking Rename confirms', () => {
    const { el, onConfirm } = mount(1)
    act(() => btn(el, 'Rename')?.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('click-away cancels and renames nothing', () => {
    const { el, onConfirm, onCancel } = mount(1)
    act(() => void el.querySelector('.confirm-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a click inside the sheet does NOT cancel it', () => {
    const { el, onCancel } = mount(1)
    act(() => void el.querySelector('.confirm')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('is an in-app dialog, labelled by its own text — never a native one (ConfirmTurnBack\'s roles)', () => {
    const { el } = mount(3)
    const dialog = el.querySelector('.confirm')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('confirm-rename-text')
    expect(el.querySelector('#confirm-rename-text')?.textContent).toContain('Links in 3 notes will be updated.')
  })

  it('carries NO "Don\'t ask me again" checkbox and no danger styling — nothing is destroyed here', () => {
    const { el } = mount(0)
    expect(el.querySelector('.confirm__ask')).toBeNull()
    expect(el.querySelector('input[type="checkbox"]')).toBeNull()
    expect(el.querySelector('.confirm__btn--danger')).toBeNull()
  })
})
