import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeDrawingSection, DRAWING_COMMAND_EVENT, requestDrawingCommand, type DrawingCommand } from './drawingCommand'

/** Two mounted tabs, as the workspace renders them: one visible layer, one hidden. */
function stack(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

const VISIBLE = '<div class="tabstack__layer"><section class="editor editor--drawing" data-which="visible"></section></div>'
const HIDDEN = '<div class="tabstack__layer tabstack__layer--hidden"><section class="editor editor--drawing" data-which="hidden"></section></div>'

describe('activeDrawingSection', () => {
  it('finds the VISIBLE layer`s drawing and never a hidden one', () => {
    const host = stack(HIDDEN + VISIBLE)
    expect(activeDrawingSection(host)?.getAttribute('data-which')).toBe('visible')
  })

  it('is null when every mounted drawing is hidden', () => {
    expect(activeDrawingSection(stack(HIDDEN))).toBeNull()
  })

  it('is null when the visible tab is not a drawing', () => {
    expect(activeDrawingSection(stack('<div class="tabstack__layer"><section class="editor"></section></div>' + HIDDEN))).toBeNull()
  })
})

describe('requestDrawingCommand', () => {
  it('dispatches to the visible drawing ONLY — the hidden tab`s engine never hears it', () => {
    const host = stack(HIDDEN + VISIBLE)
    const seen: Array<[string, DrawingCommand]> = []
    for (const section of host.querySelectorAll('.editor--drawing')) {
      section.addEventListener(DRAWING_COMMAND_EVENT, (e) => seen.push([section.getAttribute('data-which') ?? '', (e as CustomEvent<DrawingCommand>).detail]))
    }
    expect(requestDrawingCommand({ kind: 'export-image' }, host)).toBe(true)
    expect(requestDrawingCommand({ kind: 'canvas-background', color: '#fffce8' }, host)).toBe(true)
    expect(seen).toEqual([
      ['visible', { kind: 'export-image' }],
      ['visible', { kind: 'canvas-background', color: '#fffce8' }],
    ])
  })

  it('does not bubble — a listener on an ancestor is not a second claimant', () => {
    const host = stack(VISIBLE)
    const onHost = vi.fn()
    host.addEventListener(DRAWING_COMMAND_EVENT, onHost)
    requestDrawingCommand({ kind: 'export-image' }, host)
    expect(onHost).not.toHaveBeenCalled()
  })

  it('answers false when nothing is there to take it', () => {
    expect(requestDrawingCommand({ kind: 'export-image' }, stack(HIDDEN))).toBe(false)
  })
})
