import { describe, expect, it } from 'vitest'
import { inStripBand } from './blockHandleGate'

describe('inStripBand', () => {
  // Geometry mirrors guideLines.ts: strip centre = ul.left − (2.15em/2 + 5px), half-width 5px.
  // At 16px font: centre = left − 22.2.
  it('hits the 10px band centred left of the list edge', () => {
    const left = 342
    const centre = left - (2.15 * 16) / 2 - 5
    expect(inStripBand(centre, left, 16)).toBe(true)
    expect(inStripBand(centre - 5, left, 16)).toBe(true)
    expect(inStripBand(centre + 5, left, 16)).toBe(true)
    expect(inStripBand(centre - 6, left, 16)).toBe(false)
    expect(inStripBand(centre + 6, left, 16)).toBe(false)
  })

  it('scales with the font size like the CSS strip does', () => {
    const left = 100
    expect(inStripBand(left - (2.15 * 28) / 2 - 5, left, 28)).toBe(true)
    // The 16px-font centre is 12.9px away from the 28px-font centre — outside the 5px half-width.
    expect(inStripBand(left - (2.15 * 16) / 2 - 5, left, 28)).toBe(false)
  })

  it.each([0.5, 1, 1.25, 2])('scales the strip geometry at %× document zoom', (zoom) => {
    const left = 342
    const centre = left - ((2.15 * 16) / 2 + 5) * zoom
    expect(inStripBand(centre, left, 16, zoom)).toBe(true)
    expect(inStripBand(centre - 5 * zoom, left, 16, zoom)).toBe(true)
    expect(inStripBand(centre + 5 * zoom, left, 16, zoom)).toBe(true)
    expect(inStripBand(centre - 6 * zoom, left, 16, zoom)).toBe(false)
    expect(inStripBand(centre + 6 * zoom, left, 16, zoom)).toBe(false)
  })
})

describe('own-editor scoping (YAZ-747)', () => {
  // Tabs keep hidden editors mounted, each with its own handle in its view.dom.parentElement.
  // The gate must only ever touch ITS editor's handle — never the first one in the document.
  it('mutes its own handle, not another editor\'s', async () => {
    const { createCrepe } = await import('./createCrepe')
    const { editorViewCtx } = await import('@milkdown/kit/core')
    const { HANDLE_MUTED_CLASS } = await import('./blockHandleGate')

    const mount = async () => {
      const root = document.createElement('div')
      document.body.appendChild(root)
      const crepe = createCrepe({ root, defaultValue: '* a\n' })
      await crepe.create()
      const view = crepe.editor.ctx.get(editorViewCtx)
      const handle = document.createElement('div')
      handle.className = 'milkdown-block-handle'
      view.dom.parentElement!.appendChild(handle)
      return { crepe, root, view, handle }
    }
    const a = await mount()
    const b = await mount()
    // Force editor B's gate to see an affordance under the pointer: a fold chevron in the stack.
    const chevron = document.createElement('span')
    chevron.className = 'outline-toggle'
    const originalFrom = document.elementsFromPoint
    document.elementsFromPoint = () => [chevron]
    try {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      // BOTH gates ran on the same document mousemove; each must have muted only its own handle.
      expect(a.handle.classList.contains(HANDLE_MUTED_CLASS)).toBe(true)
      expect(b.handle.classList.contains(HANDLE_MUTED_CLASS)).toBe(true)
      // Un-mute: pointer leaves the affordance — again, each gate updates its own handle.
      document.elementsFromPoint = () => []
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      expect(a.handle.classList.contains(HANDLE_MUTED_CLASS)).toBe(false)
      expect(b.handle.classList.contains(HANDLE_MUTED_CLASS)).toBe(false)
    } finally {
      document.elementsFromPoint = originalFrom
      await a.crepe.destroy(); a.root.remove()
      await b.crepe.destroy(); b.root.remove()
    }
  })

  // A heading chevron (YAZ-1140) is the same kind of affordance as the bullet one: the handle must
  // step aside so the click lands on it.
  it('mutes the handle for a heading chevron too', async () => {
    const { createCrepe } = await import('./createCrepe')
    const { editorViewCtx } = await import('@milkdown/kit/core')
    const { HANDLE_MUTED_CLASS } = await import('./blockHandleGate')
    const { HEADING_TOGGLE_CLASS } = await import('./outline/headingFolding')

    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: '# Section\n\nBody.\n' })
    await crepe.create()
    const view = crepe.editor.ctx.get(editorViewCtx)
    const handle = document.createElement('div')
    handle.className = 'milkdown-block-handle'
    view.dom.parentElement!.appendChild(handle)

    const chevron = view.dom.querySelector(`.${HEADING_TOGGLE_CLASS}`)!
    const originalFrom = document.elementsFromPoint
    document.elementsFromPoint = () => [chevron]
    try {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      expect(handle.classList.contains(HANDLE_MUTED_CLASS)).toBe(true)
      document.elementsFromPoint = () => []
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      expect(handle.classList.contains(HANDLE_MUTED_CLASS)).toBe(false)
    } finally {
      document.elementsFromPoint = originalFrom
      await crepe.destroy()
      root.remove()
    }
  })
})
