/**
 * The page title (⚡ YAZ-888): the note's name, editable in place. The title IS the file name,
 * a commit is a RENAME (through App's one door, which confirms), and the page answering
 * `[[Home]]` is inert — it explains itself through the passive notice instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { HOME_TITLE_NOTICE, PageTitle } from './PageTitle'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const PATH = '/vault/Docs/Old Note.md'

function mount(opts: { path?: string; isHome?: boolean } = {}) {
  const onRename = vi.fn()
  const onNotice = vi.fn()
  const onArrowDown = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <PageTitle path={opts.path ?? PATH} isHome={opts.isHome ?? false} onRename={onRename} onNotice={onNotice} onArrowDown={onArrowDown} />,
    ),
  )
  return { el: container, onRename, onNotice, onArrowDown }
}

const heading = (el: HTMLElement) => el.querySelector<HTMLHeadingElement>('.page-title__text')
const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.page-title__input')
/** The open input, or a loud failure — every editing test starts here. */
const field = (el: HTMLElement) => {
  const f = input(el)
  if (f === null) throw new Error('the title input is not open')
  return f
}
const press = (node: Element, key: string) => act(() => void node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
const blur = (node: Element) => act(() => void node.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

/** Type into the open input the way a user does, then press `key`. */
function type(el: HTMLElement, value: string, key = 'Enter') {
  const f = field(el)
  f.value = value
  press(f, key)
}

describe('PageTitle (⚡ YAZ-888)', () => {
  it('shows the file name minus its extension — the title IS the file name', () => {
    const { el } = mount()
    expect(heading(el)?.textContent).toBe('Old Note')
    expect(input(el)).toBeNull()
  })

  it('a click swaps the heading for an input prefilled with the current name', () => {
    const { el } = mount()
    act(() => heading(el)?.click())
    expect(heading(el)).toBeNull()
    expect(input(el)?.defaultValue).toBe('Old Note')
  })

  it('Enter commits the RENAMED PATH — same directory, extension re-appended (`renamedPath`)', () => {
    const { el, onRename } = mount()
    act(() => heading(el)?.click())
    type(el, 'New Note')
    expect(onRename).toHaveBeenCalledWith('/vault/Docs/New Note.md')
    // The input closes on commit; the heading still reads the OLD name until the path changes.
    expect(input(el)).toBeNull()
    expect(heading(el)?.textContent).toBe('Old Note')
  })

  it('Escape reverts and renames nothing', () => {
    const { el, onRename } = mount()
    act(() => heading(el)?.click())
    type(el, 'Discarded', 'Escape')
    expect(onRename).not.toHaveBeenCalled()
    expect(heading(el)?.textContent).toBe('Old Note')
  })

  it('leaving the field commits — click-away is the same gesture as Enter (YAZ-1553)', () => {
    const { el, onRename } = mount()
    act(() => heading(el)?.click())
    const f = field(el)
    f.value = 'Left Behind'
    blur(f)
    expect(onRename).toHaveBeenCalledWith('/vault/Docs/Left Behind.md')
    expect(input(el)).toBeNull()
  })

  it('Escape followed by the trailing blur Chromium fires on removal commits nothing (YAZ-1553, the settled guard)', () => {
    const { el, onRename } = mount()
    act(() => heading(el)?.click())
    const f = field(el)
    f.value = 'Discarded'
    act(() => {
      f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      f.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onRename).not.toHaveBeenCalled()
    expect(heading(el)?.textContent).toBe('Old Note')
  })

  it('one leave commits ONCE even when the trailing blur follows it (YAZ-1553)', () => {
    const { el, onRename } = mount()
    act(() => heading(el)?.click())
    const f = field(el)
    f.value = 'Once'
    act(() => {
      f.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      f.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('an empty or whitespace-only name never commits, and neither does the unchanged one', () => {
    const { el, onRename } = mount()
    act(() => heading(el)?.click())
    type(el, '   ')
    expect(onRename).not.toHaveBeenCalled()
    act(() => heading(el)?.click())
    type(el, 'Old Note')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('a name the sidebar\'s own rules reject lands in the passive notice, not in a rename', () => {
    const { el, onRename, onNotice } = mount()
    act(() => heading(el)?.click())
    type(el, 'Docs/Nested')
    expect(onRename).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledWith('Name cannot contain "/"')
  })

  it('ArrowDown is a leave too: it commits the changed name AND hands focus on to the editor (YAZ-1553)', () => {
    const { el, onRename, onArrowDown } = mount()
    act(() => heading(el)?.click())
    type(el, 'Half typed', 'ArrowDown')
    expect(onArrowDown).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('/vault/Docs/Half typed.md')
    expect(input(el)).toBeNull()
  })

  it('HOME is inert: the click explains itself through the passive notice and opens no input (🔒 the Home guard)', () => {
    const { el, onRename, onNotice } = mount({ path: '/vault/Home.md', isHome: true })
    expect(heading(el)?.textContent).toBe('Home')
    act(() => heading(el)?.click())
    expect(input(el)).toBeNull()
    expect(onRename).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledWith(HOME_TITLE_NOTICE)
    expect(HOME_TITLE_NOTICE).toBe('Home anchors this vault — it keeps its name.')
  })

  it('a rename never REQUIRES the mouse: the heading is focusable and Enter opens the input (⚡ YAZ-891)', () => {
    const { el } = mount()
    expect(heading(el)?.tabIndex).toBe(0)
    press(heading(el)!, 'Enter')
    expect(input(el)?.value).toBe('Old Note')
  })

  it('HOME stays out of the tab order — an inert stop would only slow the way into the note (⚡ YAZ-891)', () => {
    const { el } = mount({ path: '/vault/Home.md', isHome: true })
    expect(heading(el)?.hasAttribute('tabindex')).toBe(false)
    press(heading(el)!, 'Enter')
    expect(input(el)).toBeNull()
  })
})
