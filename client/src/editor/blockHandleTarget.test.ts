import { describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@milkdown/kit/prose/view'
import { handleTargetPos, isDragHandleGrab, PROBE_OFFSET_PX } from './blockHandleTarget'

function makeHandle(): { handle: HTMLElement; item: HTMLElement } {
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  const item = document.createElement('div')
  item.className = 'operation-item'
  handle.appendChild(item)
  document.body.appendChild(handle)
  return { handle, item }
}

describe('isDragHandleGrab', () => {
  it('is true for a descendant of .operation-item and false otherwise', () => {
    const { handle, item } = makeHandle()
    const icon = document.createElement('span')
    item.appendChild(icon)
    expect(isDragHandleGrab(item)).toBe(true)
    expect(isDragHandleGrab(icon)).toBe(true)
    // The real pointer lands on the icon's <svg>/<path> — an SVGElement, not an HTMLElement.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    svg.appendChild(pathEl)
    icon.appendChild(svg)
    expect(isDragHandleGrab(pathEl)).toBe(true)
    expect(isDragHandleGrab(handle)).toBe(false)
    expect(isDragHandleGrab(document.body)).toBe(false)
    expect(isDragHandleGrab(null)).toBe(false)
    handle.remove()
  })
})

describe('handleTargetPos', () => {
  it('probes right of the handle at the pointer y and returns pos + inside', () => {
    const { handle, item } = makeHandle()
    handle.getBoundingClientRect = () => ({ right: 100 }) as DOMRect
    const posAtCoords = vi.fn(() => ({ pos: 7, inside: 3 }))
    const view = { posAtCoords, dom: document.createElement('div') } as unknown as EditorView
    const e = { target: item, clientY: 42 } as unknown as MouseEvent
    expect(handleTargetPos(view, e)).toEqual({ pos: 7, inside: 3 })
    expect(posAtCoords).toHaveBeenCalledWith({ left: 100 + PROBE_OFFSET_PX, top: 42 })
    handle.remove()
  })

  it.each([0.5, 1, 1.25, 2, 4])('keeps its logical probe offset at %× document zoom — read from the CONTENT, since the handle itself is unzoomed (YAZ-1710 D14)', (zoom) => {
    const { handle, item } = makeHandle()
    handle.getBoundingClientRect = () => ({ right: 100 }) as DOMRect
    const dom = document.createElement('div')
    Object.defineProperty(dom, 'currentCSSZoom', { value: zoom, configurable: true })
    const posAtCoords = vi.fn(() => ({ pos: 7, inside: 3 }))
    const view = { posAtCoords, dom } as unknown as EditorView

    handleTargetPos(view, { target: item, clientY: 42 } as unknown as MouseEvent)

    expect(posAtCoords).toHaveBeenCalledWith({ left: 100 + PROBE_OFFSET_PX * zoom, top: 42 })
    handle.remove()
  })

  it('returns null when the probe misses', () => {
    const { handle, item } = makeHandle()
    const view = { posAtCoords: () => null, dom: document.createElement('div') } as unknown as EditorView
    expect(handleTargetPos(view, { target: item, clientY: 0 } as unknown as MouseEvent)).toBeNull()
    handle.remove()
  })
})
