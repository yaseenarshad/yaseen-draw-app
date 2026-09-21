/**
 * The turn-back sheet's copy and keyboard behaviour (🔒 D5, YAZ-817). The copy is LOCKED
 * verbatim, so it is pinned character for character here — and the behaviour is pinned against
 * `ConfirmDelete`'s, which this sheet mirrors: own sheet never a native dialog, initial focus on
 * CANCEL, Esc cancels, Enter confirms, click-away cancels.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmTurnBack, turnBackConfirmMessage } from './ConfirmTurnBack'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('turnBackConfirmMessage', () => {
  it('is the LOCKED copy, verbatim, around the page name', () => {
    expect(turnBackConfirmMessage('/v/Projects.md')).toBe(
      "Turn 'Projects.md' back into a normal page? Pages that belong to it keep their entries — any that belong nowhere else will appear in Uncategorized until this is a folder page again. Nothing is deleted.",
    )
  })

  it('names the page the way the delete sheet does — basename, extension and all', () => {
    expect(turnBackConfirmMessage('/v/Docs/Sub/Reading list.md')).toContain("Turn 'Reading list.md' back into a normal page?")
  })

  it('promises that nothing is deleted — the whole point of the lossless reverse (🔒 D3)', () => {
    expect(turnBackConfirmMessage('/v/a.md')).toContain('Nothing is deleted.')
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

function mount(path: string) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ConfirmTurnBack path={path} onConfirm={onConfirm} onCancel={onCancel} />))
  return { el: container, onConfirm, onCancel }
}

const PATH = '/v/Projects.md'
const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

describe('ConfirmTurnBack', () => {
  it('offers exactly Cancel and "Turn back"', () => {
    const { el } = mount(PATH)
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Turn back'])
  })

  it('focuses CANCEL, not "Turn back" — a stray Enter from the tree must change nothing', () => {
    const { el } = mount(PATH)
    expect(document.activeElement).toBe(btn(el, 'Cancel'))
  })

  it('Escape cancels and turns nothing back', () => {
    const { onConfirm, onCancel } = mount(PATH)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Enter confirms', () => {
    const { onConfirm } = mount(PATH)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('clicking "Turn back" confirms', () => {
    const { el, onConfirm } = mount(PATH)
    act(() => btn(el, 'Turn back')?.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('click-away cancels and turns nothing back', () => {
    const { el, onConfirm, onCancel } = mount(PATH)
    act(() => void el.querySelector('.confirm-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a click inside the sheet does NOT cancel it', () => {
    const { el, onCancel } = mount(PATH)
    act(() => void el.querySelector('.confirm')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('is an in-app dialog, labelled by its own text — never a native one (ConfirmDelete\'s roles)', () => {
    const { el } = mount(PATH)
    const dialog = el.querySelector('.confirm')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('confirm-turn-back-text')
    expect(el.querySelector('#confirm-turn-back-text')?.textContent).toContain('back into a normal page?')
  })

  it('carries NO "Don\'t ask me again" checkbox — deliberately, unlike the delete sheet (🔒 D5)', () => {
    const { el } = mount(PATH)
    expect(el.querySelector('.confirm__ask')).toBeNull()
    expect(el.querySelector('input[type="checkbox"]')).toBeNull()
  })
})
