/**
 * The move sheet's copy and keyboard behaviour (YAZ-991) — the same contract every confirm
 * sheet in the house keeps (`ConfirmDelete.test.tsx` is the template): pure copy function pinned
 * first, then focus-on-Cancel, Esc/Enter, click-away. The copy names PAGES the way the rows do
 * (basename, single quotes — `removeMemberMessage`'s rule), says what is NOT happening (the file
 * does not move on disk), and answers the multi-parent question by name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmMove, moveConfirmMessage } from './ConfirmMove'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('moveConfirmMessage', () => {
  it('names the page, the source and the destination, then says the file stays put', () => {
    expect(moveConfirmMessage('Agent Fundamentals', 'Courses', 'AI Curriculum', [])).toBe(
      "Move 'Agent Fundamentals' from 'Courses' into 'AI Curriculum'? The file stays put — only its folder pages change.",
    )
  })

  it('a page dragged out of Uncategorized has no source to name', () => {
    expect(moveConfirmMessage('Agent Fundamentals', null, 'AI Curriculum', [])).toBe(
      "Move 'Agent Fundamentals' into 'AI Curriculum'? The file stays put — only its folder pages change.",
    )
  })

  it('other folder pages the page stays in are answered by name', () => {
    expect(moveConfirmMessage('Agent Fundamentals', 'Courses', 'AI Curriculum', ['KPIs', 'Notes'])).toBe(
      "Move 'Agent Fundamentals' from 'Courses' into 'AI Curriculum'? The file stays put — only its folder pages change. It also stays in: KPIs, Notes.",
    )
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

function mount(over: { from?: string | null } = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ConfirmMove page="Agent Fundamentals" from={over.from === undefined ? 'Courses' : over.from} to="AI Curriculum" others={[]} onConfirm={onConfirm} onCancel={onCancel} />,
    ),
  )
  return { el: container, onConfirm, onCancel }
}

const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

describe('ConfirmMove', () => {
  it('focuses CANCEL, not Move — a stray Enter from the tree must move nothing', () => {
    const { el } = mount()
    expect(document.activeElement).toBe(btn(el, 'Cancel'))
  })

  it('Escape cancels and moves nothing', () => {
    const { onConfirm, onCancel } = mount()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('click-away cancels and moves nothing', () => {
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
    const { onConfirm } = mount()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('the confirm button says Move and clicking it confirms once', () => {
    const { el, onConfirm } = mount()
    act(() => btn(el, 'Move')?.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('is an in-app dialog, labelled by its own text — never a native one', () => {
    const { el } = mount({ from: null })
    const dialog = el.querySelector('.confirm')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(el.querySelector('#confirm-move-text')?.textContent).toContain('The file stays put')
  })
})
