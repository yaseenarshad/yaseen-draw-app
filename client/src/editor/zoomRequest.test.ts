import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZOOM_EVENT, requestZoom } from './zoomRequest'

const zoom = vi.fn(async () => undefined)
Object.defineProperty(window, 'yaseenDocs', { value: { window: { zoom } }, configurable: true, writable: true })

afterEach(() => {
  zoom.mockClear()
  document.body.replaceChildren()
})

describe('requestZoom (YAZ-1710)', () => {
  it('lets the note that contains the focus claim the step and then leaves the app alone', () => {
    const section = document.createElement('section')
    const input = document.createElement('input')
    section.append(input)
    document.body.append(section)
    input.focus()
    const seen: number[] = []
    section.addEventListener(ZOOM_EVENT, (event) => {
      seen.push((event as CustomEvent<number>).detail)
      event.preventDefault()
    })

    requestZoom(1)
    expect(seen).toEqual([1])
    expect(zoom).not.toHaveBeenCalled()
  })

  it('zooms the whole app when nothing claims it — focus outside every note, or nowhere at all', () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    requestZoom(-1)
    expect(zoom).toHaveBeenCalledExactlyOnceWith(-1)

    button.blur()
    expect(document.activeElement).toBe(document.body)
    requestZoom(0)
    expect(zoom).toHaveBeenLastCalledWith(0)
  })
})
