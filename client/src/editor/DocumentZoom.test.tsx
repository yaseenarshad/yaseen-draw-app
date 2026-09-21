import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DocumentZoom, stepZoom, stepZoomByKey } from './DocumentZoom'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let changed: ReturnType<typeof vi.fn>

function mount() {
  changed = vi.fn()
  function Harness() {
    const [value, setValue] = useState(100)
    return <>
      <DocumentZoom value={value} onChange={(next) => { changed(next); setValue(next) }} />
      <button data-outside>Outside</button>
      <div data-outside-surface>Outside surface</div>
    </>
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

const trigger = () => container.querySelector<HTMLButtonElement>('.document-zoom__trigger')!
const panel = () => container.querySelector<HTMLElement>('.document-zoom__menu')
const input = () => container.querySelector<HTMLInputElement>('.document-zoom__custom input')!
const outsideButton = () => container.querySelector<HTMLButtonElement>('[data-outside]')!
const stepOut = () => container.querySelector<HTMLButtonElement>('.document-zoom__step[aria-label="Zoom out"]')!
const stepIn = () => container.querySelector<HTMLButtonElement>('.document-zoom__step[aria-label="Zoom in"]')!

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function open() {
  click(trigger())
}

function type(text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(key: string) {
  act(() => input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}

function choose(value: number) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.document-zoom__presets button'))
    .find((candidate) => candidate.textContent?.startsWith(`${value}%`))!
  click(button)
}

describe('DocumentZoom', () => {
  it('the percentage alone is the dropdown button — no arrow (YAZ-1710)', () => {
    mount()
    expect(trigger().textContent).toBe('100%')
    expect(trigger().querySelector('svg')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    click(trigger().querySelector('.document-zoom__value')!)
    expect(panel()).not.toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    key('Escape')
    expect(panel()).toBeNull()
  })

  it('puts a labeled custom input above the preset buttons and divider', () => {
    mount()
    open()
    expect(container.querySelector('label')?.textContent).toBe('Custom')
    expect(input().labels?.item(0)?.textContent).toBe('Custom')
    expect(document.activeElement).toBe(input())
    expect(panel()!.children.item(0)?.classList.contains('document-zoom__custom')).toBe(true)
    expect(panel()!.children.item(1)?.classList.contains('document-zoom__divider')).toBe(true)
    expect(Array.from(container.querySelectorAll('.document-zoom__presets button'), (button) => button.textContent)).toEqual([
      '50%', '75%', '90%', '100%✓', '125%', '150%', '200%', '300%', '400%',
    ])
  })

  it.each(['50', '115', '115%', ' 125% ', '200', '201', '400'])('applies %s on Enter, closes, and returns focus to the trigger', (text) => {
    mount()
    open()
    type(text)
    expect(trigger().textContent).toContain('100%')
    key('Enter')

    const value = Number(text.trim().replace('%', ''))
    expect(changed).toHaveBeenLastCalledWith(value)
    expect(trigger().textContent).toContain(`${value}%`)
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it.each(['', '49', '401', '999', '100.5', '-50', '1e2', 'abc', '100%%'])('rejects %s without changing the applied zoom', (text) => {
    mount()
    open()
    type(text)
    key('Enter')

    expect(changed).not.toHaveBeenCalled()
    expect(trigger().textContent).toContain('100%')
    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(input().getAttribute('aria-describedby')).toBe(container.querySelector('[role="alert"]')?.id)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('50–400%')
    expect(panel()).not.toBeNull()
  })

  it('recovers from invalid text and Escape cancels the draft', () => {
    mount()
    open()
    type('bad')
    key('Enter')
    type('125%')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    key('Escape')

    expect(changed).not.toHaveBeenCalled()
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    open()
    expect(input().value).toBe('100%')
  })

  it('applies a valid draft when focus leaves the zoom control without stealing focus', () => {
    mount()
    open()
    type('117')
    act(() => outsideButton().focus())

    expect(changed).toHaveBeenCalledExactlyOnceWith(117)
    expect(trigger().textContent).toContain('117%')
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(outsideButton())
  })

  it('applies a valid draft when a non-focusable outside surface is clicked', () => {
    mount()
    open()
    type('118%')
    click(container.querySelector('[data-outside-surface]')!)

    expect(changed).toHaveBeenCalledExactlyOnceWith(118)
    expect(trigger().textContent).toContain('118%')
    expect(panel()).toBeNull()
  })

  it('keeps an invalid outside-dismissal attempt readable and recoverable', () => {
    mount()
    open()
    type('49')
    act(() => outsideButton().focus())

    expect(changed).not.toHaveBeenCalled()
    expect(trigger().textContent).toContain('100%')
    expect(panel()).not.toBeNull()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    type('90')
    key('Enter')
    expect(changed).toHaveBeenCalledExactlyOnceWith(90)
  })

  it('lets a preset override a valid draft without committing the draft first', () => {
    mount()
    open()
    type('115')
    choose(75)

    expect(changed).toHaveBeenCalledExactlyOnceWith(75)
    expect(trigger().textContent).toContain('75%')
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    open()
    expect(container.querySelector<HTMLButtonElement>('.document-zoom__presets button[aria-pressed="true"]')?.textContent).toBe('75%✓')
  })

  it('lets a preset recover invalid input and clears the old draft before reopening', () => {
    mount()
    open()
    type('bad')
    key('Enter')
    choose(125)

    expect(changed).toHaveBeenCalledExactlyOnceWith(125)
    open()
    expect(input().value).toBe('125%')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('cancels a draft when the open trigger is clicked and does not restore it later', () => {
    mount()
    open()
    type('150')
    click(trigger())
    expect(changed).not.toHaveBeenCalled()
    expect(panel()).toBeNull()

    open()
    expect(input().value).toBe('100%')
  })

  describe('− / + step buttons (YAZ-1710)', () => {
    it.each([
      [50, 1, 75], [75, 1, 90], [90, 1, 100], [100, 1, 125], [125, 1, 150], [150, 1, 200], [200, 1, 300], [300, 1, 400], [400, 1, null],
      [400, -1, 300], [300, -1, 200], [200, -1, 150], [100, -1, 90], [75, -1, 50], [50, -1, null],
      [117, 1, 125], [117, -1, 100], [51, -1, 50], [199, 1, 200], [149, 1, 150], [151, -1, 150], [250, 1, 300], [350, -1, 300],
    ] as const)('stepZoom(%i, %i) → %s (the pill and menu ladder, D2 + D12)', (value, direction, expected) => {
      expect(stepZoom(value, direction)).toBe(expected)
    })

    it.each([
      [100, 1, 125], [150, 1, 200], [200, 1, 225], [225, 1, 250], [375, 1, 400], [400, 1, null],
      [400, -1, 375], [225, -1, 200], [200, -1, 150], [117, 1, 125],
      [210, 1, 225], [210, -1, 200], [390, -1, 375], [201, -1, 200],
    ] as const)('stepZoomByKey(%i, %i) → %s (⌘+ / ⌘−: the ladder to 200, then 25 at a time, D16)', (value, direction, expected) => {
      expect(stepZoomByKey(value, direction)).toBe(expected)
    })

    it('flanks the trigger: [−] [value ▾] [+] inside one labelled group', () => {
      mount()
      const group = container.querySelector('.document-zoom')!
      expect(group.getAttribute('role')).toBe('group')
      expect(group.getAttribute('aria-label')).toBe('Document zoom')
      expect(Array.from(group.children, (child) => child.className)).toEqual([
        'document-zoom__step', 'document-zoom__trigger', 'document-zoom__step',
      ])
    })

    it('steps to the next preset in each direction without opening the menu', () => {
      mount()
      click(stepIn())
      expect(changed).toHaveBeenLastCalledWith(125)
      expect(trigger().textContent).toContain('125%')
      expect(panel()).toBeNull()
      click(stepOut())
      click(stepOut())
      expect(changed).toHaveBeenLastCalledWith(90)
      expect(trigger().textContent).toContain('90%')
    })

    it('snaps a custom value to the nearest preset in the step direction', () => {
      mount()
      open()
      type('117')
      key('Enter')
      click(stepIn())
      expect(changed).toHaveBeenLastCalledWith(125)
      open()
      type('117')
      key('Enter')
      click(stepOut())
      expect(changed).toHaveBeenLastCalledWith(100)
    })

    it('disables the button at the end of the ladder and re-enables it on the way back', () => {
      mount()
      open()
      choose(400)
      expect(stepIn().disabled).toBe(true)
      expect(stepOut().disabled).toBe(false)
      click(stepOut())
      expect(stepIn().disabled).toBe(false)
      open()
      choose(50)
      expect(stepOut().disabled).toBe(true)
      expect(stepIn().disabled).toBe(false)
    })

    it('a step overrides an open menu and its draft, closes the menu and keeps focus on the button', () => {
      mount()
      open()
      type('11')
      act(() => stepIn().focus())
      click(stepIn())
      expect(changed).toHaveBeenCalledExactlyOnceWith(125)
      expect(panel()).toBeNull()
      expect(document.activeElement).toBe(stepIn())
      open()
      expect(input().value).toBe('125%')
      expect(container.querySelector('[role="alert"]')).toBeNull()
    })

    it('a step clears an invalid draft and its error', () => {
      mount()
      open()
      type('bad')
      key('Enter')
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
      click(stepOut())
      expect(changed).toHaveBeenCalledExactlyOnceWith(90)
      expect(panel()).toBeNull()
      expect(container.querySelector('[role="alert"]')).toBeNull()
    })
  })
})
