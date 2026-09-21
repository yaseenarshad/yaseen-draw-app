/**
 * Anchored popover (YAZ-743): `Popover` mounted on its own with react-dom in jsdom, both rects
 * stubbed. With `anchor` it goes `position: fixed` under that element, clamped to the viewport,
 * and click-away measures the anchor instead of the parent so the trigger still toggles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Popover } from './Popover'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rect = (r: Partial<DOMRect>): DOMRect => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}), ...r }) as DOMRect

let root: Root | null = null
let container: HTMLElement | null = null

/** The popover measures 200 x 100; the anchor's own rect wins over the prototype stub. */
function anchorAt(r: Partial<DOMRect>): HTMLElement {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect({ width: 200, height: 100 }))
  const el = document.createElement('button')
  el.getBoundingClientRect = () => rect(r)
  document.body.appendChild(el)
  return el
}

function mount(anchor?: HTMLElement, constrainToViewport = false) {
  const onClose = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <Popover label="View menu" constrainToViewport={constrainToViewport} anchor={anchor} onClose={onClose}>
        <div role="menu" />
      </Popover>,
    ),
  )
  const pop = container.querySelector<HTMLElement>('.view-popover')
  if (pop === null) throw new Error('missing .view-popover')
  return { pop, onClose }
}

const mousedown = (el: Node): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.querySelectorAll('button').forEach((b) => b.remove())
})

describe('anchored popover', () => {
  it('hangs fixed 6px under the anchor', () => {
    const { pop } = mount(anchorAt({ top: 20, bottom: 48, left: 30, right: 70 }))
    expect(pop.style.position).toBe('fixed')
    expect(pop.style.top).toBe('54px')
    expect(pop.style.left).toBe('30px')
    expect(pop.className).toBe('view-popover view-popover--fixed')
  })

  it('keeps the CSS position without an anchor', () => {
    expect(mount().pop.getAttribute('style')).toBeNull()
  })

  it('clamps back inside the viewport at the right edge', () => {
    const { pop } = mount(anchorAt({ top: 20, bottom: 48, left: 1000, right: 1024 }))
    expect(window.innerWidth).toBe(1024)
    expect(pop.style.left).toBe('824px')
    expect(pop.style.top).toBe('54px')
  })

  it('closes on a mousedown away from the anchor, not on the anchor itself', () => {
    const anchor = anchorAt({ top: 20, bottom: 48, left: 30, right: 70 })
    const { onClose } = mount(anchor)
    mousedown(anchor)
    expect(onClose).not.toHaveBeenCalled()
    mousedown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a scroll under the anchor, and never without one', () => {
    const { onClose } = mount(anchorAt({ top: 20, bottom: 48, left: 30, right: 70 }))
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => root?.unmount())
    const plain = mount()
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(plain.onClose).not.toHaveBeenCalled()
  })

  it('refits when anchored content grows and shrinks without closing', () => {
    let resized: ResizeObserverCallback = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resized = callback }
      observe = observe
      disconnect = disconnect
    })
    const { pop, onClose } = mount(anchorAt({ top: 620, bottom: 650, left: 900, right: 950 }))
    expect(pop.style.top).toBe('656px')
    expect(observe).toHaveBeenCalledWith(pop)
    pop.getBoundingClientRect = () => rect({ width: 300, height: 350 })
    act(() => resized([], {} as ResizeObserver))
    expect(pop.style.top).toBe('418px')
    expect(pop.style.left).toBe('724px')
    pop.getBoundingClientRect = () => rect({ width: 200, height: 100 })
    act(() => resized([], {} as ResizeObserver))
    expect(pop.style.top).toBe('656px')
    expect(pop.style.left).toBe('824px')
    act(() => pop.firstElementChild?.dispatchEvent(new Event('scroll')))
    expect(onClose).not.toHaveBeenCalled()
    act(() => root?.unmount())
    root = null
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})


describe('toolbar menu placement', () => {
  it('keeps a left-overflowing menu inside the viewport without closing on option scroll', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect({ left: -80, right: 260, top: 50, bottom: 200, width: 340, height: 150 }))
    const { pop, onClose } = mount(undefined, true)
    expect(pop.style.translate).toBe('92px 0px')
    act(() => pop.firstElementChild?.dispatchEvent(new Event('scroll')))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('preserves the existing menu width cap on a wide viewport', () => {
    const style = document.createElement('style')
    style.textContent = '.view-popover { max-width: 420px; }'
    document.head.appendChild(style)
    try {
      const { pop } = mount(undefined, true)
      expect(pop.style.maxWidth).toBe('420px')
    } finally {
      style.remove()
    }
  })

  it('fits a resized menu within its editor scroller as well as the viewport', () => {
    let measure = rect({ left: 180, right: 520, top: 300, bottom: 600, width: 340, height: 300 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('view-popover') ? measure : rect({ left: 220, right: 600, top: 40, bottom: 480, width: 380, height: 440 })
    })
    const { pop, onClose } = mount(undefined, true)
    container!.style.overflowX = 'auto'
    container!.style.overflowY = 'auto'
    act(() => window.dispatchEvent(new Event('resize')))
    expect(pop.style.translate).toBe('52px -132px')
    expect(pop.style.maxWidth).toBe('356px')
    measure = rect({ left: 300, right: 640, top: 100, bottom: 300, width: 340, height: 200 })
    act(() => window.dispatchEvent(new Event('resize')))
    expect(pop.style.translate).toBe('-52px 0px')
    expect(onClose).not.toHaveBeenCalled()
  })
})
