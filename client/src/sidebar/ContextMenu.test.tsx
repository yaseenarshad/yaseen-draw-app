/**
 * Context-menu MECHANICS only (🔒 D8, YAZ-1674): the items arrive as data from `buildMenuSections`
 * — its gating rules are `menuSections.test.ts`'s subject — and this file pins what the component
 * itself does with them: viewport clamping (GRO-2204), one group per NON-EMPTY section (🔒 D7),
 * disabled / danger / hint rendering, the select-then-close order, the ways out (Escape,
 * click-away, a stray right-click), and the "Open in ▸" flyout (D7 amended): how it opens, stays,
 * switches, positions and flips. Sizes come from mocked `getBoundingClientRect` (jsdom has no
 * layout); the jsdom viewport is 1024×768.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ContextMenu } from './ContextMenu'
import type { MenuAction, MenuParent, MenuSection } from './menuSections'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Box = { width?: number; height?: number; left?: number; top?: number }

/** Per-class mocked boxes, FIRST match wins (insertion order); anything unlisted measures 0×0 (the jsdom default). */
let boxes: Record<string, Box> = {}

const asRect = ({ width = 0, height = 0, left = 0, top = 0 }: Box): DOMRect =>
  ({ width, height, left, top, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  boxes = {}
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    for (const [cls, box] of Object.entries(boxes)) if (this.classList.contains(cls)) return asRect(box)
    return asRect({})
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

const item = (id: string, over: Partial<MenuAction> = {}): MenuAction => ({ id, label: id, onSelect: vi.fn(), ...over })
const parent = (id: string, children: readonly MenuAction[][], over: Partial<MenuParent> = {}): MenuParent => ({ id, label: id, children, ...over })

/** A plain two-item menu — enough for every case that is not about groups or flyouts. */
const ONE_GROUP: MenuSection[] = [[item('Open'), item('Reveal')]]

function mount(x: number, y: number, sections: readonly MenuSection[] = ONE_GROUP, onClose: () => void = vi.fn()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ContextMenu x={x} y={y} sections={sections} onClose={onClose} />))
  return container
}

const menu = (el: HTMLElement): HTMLElement => {
  const m = el.querySelector<HTMLElement>('.ctx-menu:not(.ctx-menu__sub)')
  if (m === null) throw new Error('missing menu')
  return m
}
const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')]
const labelsOf = (el: HTMLElement) => buttons(el).map((b) => b.textContent)
const buttonOf = (el: HTMLElement, label: string) => buttons(el).find((b) => b.textContent === label)
const flyout = (el: HTMLElement) => el.querySelector<HTMLElement>('.ctx-menu__sub')
const flyoutLabels = (el: HTMLElement) => [...(flyout(el)?.querySelectorAll<HTMLButtonElement>('.ctx-menu__item') ?? [])].map((b) => b.textContent)
/** React's onMouseEnter is synthesised from `mouseover`; a bubbling one with no relatedTarget enters from outside. */
const hover = (target: Element | null | undefined) => act(() => void target?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
const key = (target: Element | Window | null | undefined, k: string) => act(() => void target?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))

describe('menu clamping (GRO-2204)', () => {
  it('renders at the requested position when it fits', () => {
    boxes = { 'ctx-menu': { width: 160, height: 180 } }
    const el = mount(100, 120)
    expect(menu(el).style.left).toBe('100px')
    expect(menu(el).style.top).toBe('120px')
  })

  it('clamps at the right and bottom viewport edges instead of spilling off screen', () => {
    boxes = { 'ctx-menu': { width: 160, height: 180 } }
    const el = mount(1000, 700)
    expect(menu(el).style.left).toBe('864px') // 1024 - 160
    expect(menu(el).style.top).toBe('588px') // 768 - 180
  })
})

/**
 * Groups (🔒 D7): one `role="group"` per NON-EMPTY section, in the order given — the separator is
 * CSS between adjacent groups, so skipping the empty ones is what keeps a short menu from ending
 * in a stray rule. The items inside keep their section's order.
 */
describe('groups', () => {
  it('renders one role="group" per non-empty section, in order, and drops the empty ones', () => {
    const el = mount(0, 0, [[item('a')], [], [item('b'), item('c')], [], []])
    const groups = [...el.querySelectorAll<HTMLElement>('.ctx-menu__group')]
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.getAttribute('role') === 'group')).toBe(true)
    expect(groups.map((g) => [...g.querySelectorAll('.ctx-menu__item')].map((b) => b.textContent))).toEqual([['a'], ['b', 'c']])
    expect(labelsOf(el)).toEqual(['a', 'b', 'c'])
  })

  it('keeps role="menu" on the surface and role="menuitem" on every button', () => {
    const el = mount(0, 0, [[item('a')], [item('b')]])
    expect(menu(el).getAttribute('role')).toBe('menu')
    expect(buttons(el).every((b) => b.getAttribute('role') === 'menuitem' && b.type === 'button')).toBe(true)
  })
})

describe('item rendering', () => {
  it('the ONLY text child is the label — the hint rides on data-hint, so textContent stays bare', () => {
    const el = mount(0, 0, [[item('Cut', { hint: '⌘X' }), item('Rename')]])
    const cut = buttonOf(el, 'Cut')
    expect(cut?.textContent).toBe('Cut')
    expect(cut?.childNodes).toHaveLength(1)
    expect(cut?.getAttribute('data-hint')).toBe('⌘X')
    expect(buttonOf(el, 'Rename')?.hasAttribute('data-hint')).toBe(false)
  })

  it('a danger item carries the modifier class; the others do not', () => {
    const el = mount(0, 0, [[item('Rename')], [item('Delete', { danger: true })]])
    expect(buttonOf(el, 'Delete')?.classList.contains('ctx-menu__item--danger')).toBe(true)
    expect(buttonOf(el, 'Rename')?.classList.contains('ctx-menu__item--danger')).toBe(false)
  })

  it('a disabled item renders inert: it reads its label, and a click fires neither onSelect nor onClose', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const el = mount(0, 0, [[item('Paste', { disabled: true, onSelect })]], onClose)
    const paste = buttonOf(el, 'Paste')
    expect(paste?.disabled).toBe(true)
    act(() => paste?.click())
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('selecting and closing', () => {
  it('a click runs onSelect THEN onClose, once each (🔒 D8)', () => {
    const calls: string[] = []
    const onClose = vi.fn(() => calls.push('close'))
    const el = mount(0, 0, [[item('Reveal', { onSelect: () => calls.push('select') })]], onClose)
    act(() => buttonOf(el, 'Reveal')?.click())
    expect(calls).toEqual(['select', 'close'])
  })

  it('Escape closes', () => {
    const onClose = vi.fn()
    mount(0, 0, ONE_GROUP, onClose)
    key(window, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mousedown on the overlay closes; mousedown inside the menu does not', () => {
    const onClose = vi.fn()
    const el = mount(0, 0, ONE_GROUP, onClose)
    act(() => void menu(el).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).not.toHaveBeenCalled()
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a stray right-click on the overlay is swallowed and closes', () => {
    const onClose = vi.fn()
    const el = mount(0, 0, ONE_GROUP, onClose)
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(ev))
    expect(ev.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/**
 * The "Open in ▸" flyout (D7 amended, YAZ-1674). The parent is a `menuitem`
 * with `aria-haspopup`, its chevron CSS so the text stays bare; it opens on hover AND click,
 * stays while the pointer is inside the row or the flyout, closes when the pointer enters a
 * DIFFERENT top-level item, and only one flyout stands at a time. The flyout is drawn by the
 * root's own group renderer, to the RIGHT of the parent — or to the LEFT when the right edge
 * would spill.
 */
describe('the "Open in ▸" flyout (D7 amended)', () => {
  const OPEN_IN = () => parent('Open in', [[item('New window'), item('VS Code')], [item('Reveal in Finder')]])
  const WITH_FLYOUT = (): MenuSection[] => [[item('Open 2 in new tabs'), OPEN_IN(), item('Focus on folder')], [item('Cut')]]

  it('the parent renders as a menuitem with aria-haspopup, collapsed, bare-labelled, chevron class on — no flyout yet', () => {
    const el = mount(0, 0, WITH_FLYOUT())
    const p = buttonOf(el, 'Open in')
    expect(p?.getAttribute('role')).toBe('menuitem')
    expect(p?.getAttribute('aria-haspopup')).toBe('menu')
    expect(p?.getAttribute('aria-expanded')).toBe('false')
    expect(p?.textContent).toBe('Open in')
    expect(p?.classList.contains('ctx-menu__item--parent')).toBe(true)
    expect(flyout(el)).toBeNull()
    expect(labelsOf(el)).toEqual(['Open 2 in new tabs', 'Open in', 'Focus on folder', 'Cut'])
  })

  it('hover opens: the flyout is a second role="menu" drawn with the same groups — a separator between its two sections', () => {
    const el = mount(0, 0, WITH_FLYOUT())
    hover(buttonOf(el, 'Open in'))
    const sub = flyout(el)
    expect(sub).not.toBeNull()
    expect(sub?.getAttribute('role')).toBe('menu')
    expect(buttonOf(el, 'Open in')?.getAttribute('aria-expanded')).toBe('true')
    expect([...(sub?.querySelectorAll('.ctx-menu__group') ?? [])].map((g) => [...g.querySelectorAll('.ctx-menu__item')].map((b) => b.textContent))).toEqual([['New window', 'VS Code'], ['Reveal in Finder']])
  })

  it('click opens too', () => {
    const el = mount(0, 0, WITH_FLYOUT())
    act(() => buttonOf(el, 'Open in')?.click())
    expect(flyoutLabels(el)).toEqual(['New window', 'VS Code', 'Reveal in Finder'])
  })

  it('clicking the parent never closes the menu — it has no select of its own', () => {
    const onClose = vi.fn()
    const el = mount(0, 0, WITH_FLYOUT(), onClose)
    act(() => buttonOf(el, 'Open in')?.click())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open while the pointer is inside the flyout; closes when the pointer enters a DIFFERENT top-level item', () => {
    const el = mount(0, 0, WITH_FLYOUT())
    hover(buttonOf(el, 'Open in'))
    hover(buttonOf(el, 'VS Code'))
    expect(flyout(el)).not.toBeNull()
    hover(buttonOf(el, 'Focus on folder'))
    expect(flyout(el)).toBeNull()
    expect(buttonOf(el, 'Open in')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('only one flyout stands at a time: hovering a second parent swaps them', () => {
    const el = mount(0, 0, [[OPEN_IN(), parent('Sort by', [[item('Name')]])]])
    hover(buttonOf(el, 'Open in'))
    expect(flyoutLabels(el)).toEqual(['New window', 'VS Code', 'Reveal in Finder'])
    hover(buttonOf(el, 'Sort by'))
    expect(el.querySelectorAll('.ctx-menu__sub')).toHaveLength(1)
    expect(flyoutLabels(el)).toEqual(['Name'])
    expect(buttonOf(el, 'Open in')?.getAttribute('aria-expanded')).toBe('false')
    expect(buttonOf(el, 'Sort by')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('selecting a child runs its onSelect, then closes EVERYTHING', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const el = mount(0, 0, [[parent('Open in', [[item('VS Code', { onSelect })]])]], onClose)
    hover(buttonOf(el, 'Open in'))
    act(() => buttonOf(el, 'VS Code')?.click())
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens to the RIGHT of the parent row, top-aligned', () => {
    boxes = { 'ctx-menu__sub': { width: 120, height: 90 }, 'ctx-menu__item--parent': { left: 100, top: 150, width: 160, height: 26 }, 'ctx-menu': { width: 160, height: 180 } }
    const el = mount(0, 0, WITH_FLYOUT())
    hover(buttonOf(el, 'Open in'))
    expect(flyout(el)?.style.left).toBe('260px') // 100 + 160
    expect(flyout(el)?.style.top).toBe('150px')
    expect(flyout(el)?.style.visibility).toBe('')
  })

  it('flips to the LEFT of the parent when the right edge would spill, and clamps the top like the root', () => {
    boxes = { 'ctx-menu__sub': { width: 120, height: 90 }, 'ctx-menu__item--parent': { left: 900, top: 740, width: 120, height: 26 }, 'ctx-menu': { width: 120, height: 180 } }
    const el = mount(0, 0, WITH_FLYOUT())
    hover(buttonOf(el, 'Open in'))
    expect(flyout(el)?.style.left).toBe('780px') // 900 - 120: 1020 + 120 would spill past 1024
    expect(flyout(el)?.style.top).toBe('678px') // 768 - 90
  })

  it('near the BOTTOM of the screen it keeps the right side and pulls its top up to fit', () => {
    boxes = { 'ctx-menu__sub': { width: 120, height: 90 }, 'ctx-menu__item--parent': { left: 100, top: 740, width: 160, height: 26 }, 'ctx-menu': { width: 160, height: 180 } }
    const el = mount(0, 0, WITH_FLYOUT())
    hover(buttonOf(el, 'Open in'))
    expect(flyout(el)?.style.left).toBe('260px') // no flip: 260 + 120 fits
    expect(flyout(el)?.style.top).toBe('678px') // 768 - 90
  })

  it('keyboard: ArrowRight / Enter on the parent open; ArrowLeft in the flyout closes it alone', () => {
    const onClose = vi.fn()
    const el = mount(0, 0, WITH_FLYOUT(), onClose)
    key(buttonOf(el, 'Open in'), 'ArrowRight')
    expect(flyout(el)).not.toBeNull()
    key(buttonOf(el, 'VS Code'), 'ArrowLeft')
    expect(flyout(el)).toBeNull()
    key(buttonOf(el, 'Open in'), 'Enter')
    expect(flyout(el)).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape closes the flyout FIRST; a second Escape closes the menu', () => {
    const onClose = vi.fn()
    const el = mount(0, 0, WITH_FLYOUT(), onClose)
    hover(buttonOf(el, 'Open in'))
    key(window, 'Escape')
    expect(flyout(el)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    key(window, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an empty child section is skipped inside the flyout too — no stray separator', () => {
    const el = mount(0, 0, [[parent('Open in', [[item('VS Code')], []])]])
    hover(buttonOf(el, 'Open in'))
    expect(flyout(el)?.querySelectorAll('.ctx-menu__group')).toHaveLength(1)
  })
})
