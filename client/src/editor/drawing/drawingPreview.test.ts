/**
 * Drawing previews (YAZ-878): real editor (`createCrepe`), `![[x.excalidraw]]` renders as the
 * scene through DECORATIONS ONLY. Pinned here: the targeting (only `.excalidraw` embeds — every
 * other embed and link is untouched), the three states, the caret reveal and its EXCLUSIVE
 * boundaries, the click callback, the feed's poke → re-read, and byte-identical round trip.
 *
 * The disk read and the Excalidraw export are the two module boundaries this plugin owns; both
 * are mocked, so nothing here loads the real package (that import is lazy by contract).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createDrawingFeed, type MutableDrawingFeed } from '../../drawings/drawingFeed'
import { loadDrawingScene, type DrawingScene } from '../../drawings/drawingScene'
import { renderSceneToSvg } from '../../drawings/renderScene'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { DRAWING_BROKEN_CLASS, DRAWING_CLICKABLE_CLASS, DRAWING_PREVIEW_CLASS, DRAWING_SYNTAX_CLASS } from './drawingPreview'

vi.mock('../../drawings/drawingScene', async (original) => ({
  ...(await original<typeof import('../../drawings/drawingScene')>()),
  loadDrawingScene: vi.fn(),
}))
vi.mock('../../drawings/renderScene', () => ({ renderSceneToSvg: vi.fn() }))

const load = vi.mocked(loadDrawingScene)
const render = vi.mocked(renderSceneToSvg)

const SCENE: DrawingScene = { elements: [], appState: {}, files: null }

/** A recognisable stand-in for what `exportToSvg` returns. */
function fakeSvg(marker: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.dataset.marker = marker
  return svg
}

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, extra: { feed?: MutableDrawingFeed; onOpenDrawing?: (target: string) => void } = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, drawingPreview: { root: '/v', ...extra } })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

const previews = (root: HTMLElement) => Array.from(root.querySelectorAll(`.${DRAWING_PREVIEW_CLASS}`))
const hidden = (root: HTMLElement) =>
  Array.from(root.querySelectorAll(`.${DRAWING_SYNTAX_CLASS}`))
    .map((el) => el.textContent ?? '')
    .join('')

function viewOf(crepe: Crepe): EditorView {
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx))
}

function caret(crepe: Crepe, pos: number): void {
  const view = viewOf(crepe)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

/** Waits for the read → render → poke chain to reach the DOM. */
const settled = (root: HTMLElement, cls: string) => vi.waitFor(() => expect(root.querySelector(`.${DRAWING_PREVIEW_CLASS}--${cls}`)).not.toBeNull())

beforeEach(() => {
  load.mockReset().mockResolvedValue(SCENE)
  render.mockReset().mockImplementation(() => Promise.resolve(fakeSvg('a')))
})

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

describe('targeting', () => {
  it('renders the scene for a `.excalidraw` embed and hides its raw text', async () => {
    const { root } = await mount('![[Sketch.excalidraw]]')
    await settled(root, 'ready')
    expect(load).toHaveBeenCalledWith('/v', 'Sketch.excalidraw')
    expect(previews(root)).toHaveLength(1)
    expect(root.querySelector(`.${DRAWING_PREVIEW_CLASS} svg`)?.getAttribute('data-marker')).toBe('a')
    // The embed text is still in the document — only hidden (CSS `display: none`).
    expect(hidden(root)).toBe('![[Sketch.excalidraw]]')
  })

  it('leaves every other embed and every link exactly as they were', async () => {
    const { root } = await mount('![[img.png]]\n\n[[note]]\n\n[[Sketch.excalidraw]]')
    await Promise.resolve()
    expect(previews(root)).toHaveLength(0)
    expect(hidden(root)).toBe('')
    // `[[Sketch.excalidraw]]` is a LINK, not an embed — rule 23 renders it, this plugin does not.
    expect(load).not.toHaveBeenCalled()
  })

  it('a path target goes to readAsset raw — resolution is the asset pipe`s rule', async () => {
    const { root } = await mount('![[assets/drawings/Sketch.excalidraw]]')
    await settled(root, 'ready')
    expect(load).toHaveBeenCalledWith('/v', 'assets/drawings/Sketch.excalidraw')
  })

  it('reads each distinct target ONCE, however many times it is embedded', async () => {
    const { root } = await mount('![[Sketch.excalidraw]]\n\n![[Sketch.excalidraw]]\n\n![[Other.excalidraw]]')
    await vi.waitFor(() => expect(root.querySelectorAll(`.${DRAWING_PREVIEW_CLASS}--ready`)).toHaveLength(3))
    expect(load.mock.calls.map((c) => c[1])).toEqual(['Sketch.excalidraw', 'Other.excalidraw'])
  })

  it('an embed inside a code block is not a drawing', async () => {
    const { root } = await mount('```\n![[Sketch.excalidraw]]\n```')
    await Promise.resolve()
    expect(previews(root)).toHaveLength(0)
    expect(load).not.toHaveBeenCalled()
  })
})

describe('states', () => {
  it('shows a quiet loading box before the scene lands, and no raw text under it', async () => {
    let settle = (_: DrawingScene) => {}
    load.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    const { root } = await mount('![[Sketch.excalidraw]]')
    expect(root.querySelector(`.${DRAWING_PREVIEW_CLASS}--loading`)).not.toBeNull()
    expect(root.querySelector(`.${DRAWING_PREVIEW_CLASS} svg`)).toBeNull()
    expect(hidden(root)).toBe('![[Sketch.excalidraw]]')
    settle(SCENE)
    await settled(root, 'ready')
  })

  it('a missing or unreadable sidecar becomes an inert chip and the embed text stays VISIBLE', async () => {
    load.mockRejectedValue(new Error('NOT_FOUND'))
    const { root } = await mount('![[Gone.excalidraw]]')
    await settled(root, 'broken')
    expect(root.querySelector(`.${DRAWING_BROKEN_CLASS}`)?.textContent).toBe('Broken drawing')
    // Nothing hidden: a drawing whose file is gone must stay a line the user can fix by hand.
    expect(hidden(root)).toBe('')
    expect(root.textContent).toContain('![[Gone.excalidraw]]')
  })

  it('a scene that will not export is broken too, never a crash', async () => {
    render.mockRejectedValue(new Error('bad elements'))
    const { root } = await mount('![[Sketch.excalidraw]]')
    await settled(root, 'broken')
    expect(previews(root)).toHaveLength(1)
  })
})

describe('caret', () => {
  it('the caret INSIDE the embed reveals raw, editable syntax', async () => {
    const { crepe, root } = await mount('![[Sketch.excalidraw]]')
    await settled(root, 'ready')
    caret(crepe, 5) // inside `![[Sket…`
    expect(previews(root)).toHaveLength(0)
    expect(hidden(root)).toBe('')
  })

  it('the boundaries are EXCLUSIVE: the caret right after the embed keeps the preview', async () => {
    // Which is what the YAZ-877 insert leaves behind — the preview must be there immediately.
    const { crepe, root } = await mount('![[Sketch.excalidraw]]')
    await settled(root, 'ready')
    const end = viewOf(crepe).state.doc.content.size - 1
    caret(crepe, end)
    expect(previews(root)).toHaveLength(1)
    caret(crepe, end - 1) // one step in — revealed
    expect(previews(root)).toHaveLength(0)
  })
})

describe('click', () => {
  it('a rendered preview calls onOpenDrawing with the embed`s target', async () => {
    const onOpenDrawing = vi.fn()
    const { root } = await mount('![[Sketch.excalidraw]]', { onOpenDrawing })
    await settled(root, 'ready')
    const preview = root.querySelector(`.${DRAWING_PREVIEW_CLASS}`) as HTMLElement
    expect(preview.classList.contains(DRAWING_CLICKABLE_CLASS)).toBe(true)
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onOpenDrawing).toHaveBeenCalledWith('Sketch.excalidraw')
  })

  it('without a handler the preview is inert — no click class, nothing to call', async () => {
    const { root } = await mount('![[Sketch.excalidraw]]')
    await settled(root, 'ready')
    expect(root.querySelector(`.${DRAWING_CLICKABLE_CLASS}`)).toBeNull()
  })

  it('a BROKEN chip is inert even when a handler is threaded', async () => {
    const onOpenDrawing = vi.fn()
    load.mockRejectedValue(new Error('NOT_FOUND'))
    const { root } = await mount('![[Gone.excalidraw]]', { onOpenDrawing })
    await settled(root, 'broken')
    ;(root.querySelector(`.${DRAWING_PREVIEW_CLASS}`) as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onOpenDrawing).not.toHaveBeenCalled()
  })
})

describe('the refresh feed', () => {
  it('a poke re-reads THAT target and re-renders it; the document never changes', async () => {
    const feed = createDrawingFeed()
    const { crepe, root } = await mount('![[Sketch.excalidraw]]', { feed })
    await settled(root, 'ready')
    expect(load).toHaveBeenCalledTimes(1)

    render.mockResolvedValue(fakeSvg('b'))
    feed.poke('Sketch.excalidraw')
    await vi.waitFor(() => expect(root.querySelector(`.${DRAWING_PREVIEW_CLASS} svg`)?.getAttribute('data-marker')).toBe('b'))
    expect(load).toHaveBeenCalledTimes(2)
    expect(getMarkdownForSave(crepe)).toBe('![[Sketch.excalidraw]]\n')
  })

  it('a poke for a target this editor does not show changes nothing', async () => {
    const feed = createDrawingFeed()
    const { root } = await mount('![[Sketch.excalidraw]]', { feed })
    await settled(root, 'ready')
    feed.poke('Elsewhere.excalidraw')
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on destroy — a poke after the editor is gone reaches nobody', async () => {
    const feed = createDrawingFeed()
    const { crepe, root } = await mount('![[Sketch.excalidraw]]', { feed })
    await settled(root, 'ready')
    await crepe.destroy()
    mounted.length = 0
    root.remove()
    expect(() => feed.poke('Sketch.excalidraw')).not.toThrow()
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('round trip', () => {
  it('the decorations never touch the document: the markdown comes back byte-identical', async () => {
    const md = '# Notes\n\nBefore\n\n![[Sketch.excalidraw]]\n\nAfter\n'
    const { crepe, root } = await mount(md)
    await settled(root, 'ready')
    expect(getMarkdownForSave(crepe)).toBe(md)
  })
})
