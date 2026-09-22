/**
 * The Present tab (YAZ-1820). The element package is stubbed at `loadExcalidrawElement`, like the
 * Components tab's test, so what is pinned here is what the PANEL does: which frames it lists, in
 * what order, and that every reorder and rename is a write to the SCENE — never to the shell.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../engine', () => ({ loadExcalidrawElement: vi.fn() }))

import { loadExcalidrawElement } from '../engine'
import { NO_FRAMES_BODY, PresentationSidebar, type PresentationEngine, type PresentationSidebarTarget } from './PresentationSidebar'
import { getOrderedPresentationFrames, type SlideElementApi } from './slides'

const loadElement = vi.mocked(loadExcalidrawElement)


const frame = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'frame', frameId: null, name: null, x: 0, y: 0, width: 100, height: 100, ...over })
const ordered = (id: string, order: number, over: Record<string, unknown> = {}) => frame(id, { customData: { presentationOrder: order }, ...over })

const element = { newElementWith: vi.fn((el: object, updates: object) => ({ ...el, ...updates })) } as unknown as SlideElementApi
const engine = { CaptureUpdateAction: { IMMEDIATELY: 'immediately' } } as unknown as PresentationEngine

function fakeCanvas(elements: readonly unknown[]) {
  let scene = elements
  let listener: ((els: readonly unknown[], appState: { selectedElementIds: Record<string, true> }) => void) | null = null
  // The engine answers its own `updateScene` with an `onChange`, and the panel is driven by that
  // round trip rather than by its own optimism — so the fake has to close the loop too.
  const updateScene = vi.fn((update: { elements?: readonly unknown[] }) => {
    if (update.elements === undefined) return
    scene = update.elements
    listener?.(scene, { selectedElementIds: {} })
  })
  const setViewport = vi.fn()
  const setActiveTool = vi.fn()
  return {
    updateScene,
    setViewport,
    setActiveTool,
    api: {
      getAppState: () => ({ selectedElementIds: {} }),
      getSceneElements: () => scene,
      updateScene,
      setViewport,
      setActiveTool,
      onChange: (cb: typeof listener) => {
        listener = cb
        return () => (listener = null)
      },
    } as unknown as PresentationSidebarTarget,
    /** The deck as the file now holds it — the assertion that the order really travelled. */
    deck: () => getOrderedPresentationFrames(scene).map(({ frame: f, order }) => `${f.id}:${order}`),
  }
}

let root: Root | null = null
let container: HTMLElement | null = null
const onStartPresentation = vi.fn()

beforeEach(() => {
  onStartPresentation.mockReset()
  loadElement.mockReset().mockResolvedValue(element as never)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

async function mount(elements: readonly unknown[]) {
  const canvas = fakeCanvas(elements)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<PresentationSidebar engine={engine} excalidrawAPI={canvas.api} onStartPresentation={onStartPresentation} />)
  })
  return { canvas, el: container as HTMLElement }
}

const button = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const rows = (el: HTMLElement) => [...el.querySelectorAll('.presentation-sidebar__name')].map((n) => n.textContent)
const click = async (node: Element | null | undefined) => act(async () => void node?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

describe('the slide list', () => {
  it('a board with NO frames shows the empty state and offers the frame tool', async () => {
    const { canvas, el } = await mount([{ id: 'r', type: 'rectangle' }])
    expect(el.textContent).toContain(NO_FRAMES_BODY)
    expect(el.querySelector('.presentation-sidebar__slides')).toBe(null)
    await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Create a frame'))
    expect(canvas.setActiveTool).toHaveBeenCalledWith({ type: 'frame' })
  })

  it('lists frames in presentationOrder, nameless ones numbered', async () => {
    const { el } = await mount([ordered('a', 2, { name: 'Outro' }), ordered('b', 1), { id: 'r', type: 'rectangle' }])
    expect(rows(el)).toEqual(['Slide 1', 'Outro'])
    expect(el.textContent).toContain('2 slides')
  })

  it('a single slide is singular', async () => {
    const { el } = await mount([frame('a')])
    expect(el.textContent).toContain('1 slide')
  })

  it('a row click flies the camera to that frame', async () => {
    const { canvas, el } = await mount([frame('a'), frame('b')])
    await click(button(el, 'Go to slide 2'))
    expect(canvas.setViewport).toHaveBeenCalledWith({ target: 'b', fit: 'contain', animation: true, offsets: { ui: true } })
  })

})

describe('reordering writes the order into the FILE', () => {
  it('the down arrow moves a slide and the new order is what the scene now says', async () => {
    const { canvas, el } = await mount([frame('a'), frame('b'), frame('c')])
    await click(button(el, 'Move slide 1 down'))
    expect(canvas.updateScene).toHaveBeenCalledWith({ elements: expect.any(Array), captureUpdate: 'immediately' })
    expect(canvas.deck()).toEqual(['b:1', 'a:2', 'c:3'])
    // And the panel is showing what the FILE now says, because it re-derived from the scene.
    expect(button(el, 'Go to slide 1')?.textContent).toContain('Slide 1')
  })

  it('Alt+↑ / Alt+↓ on a row do the same, and a plain arrow does nothing', async () => {
    const { canvas, el } = await mount([frame('a'), frame('b')])
    const row = el.querySelector('[data-testid="presentation-slide-b"]')
    await act(async () => void row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    expect(canvas.updateScene).not.toHaveBeenCalled()
    await act(async () => void row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })))
    expect(canvas.deck()).toEqual(['b:1', 'a:2'])
  })

  it('the ends are dead ends: up on the first and down on the last are disabled', async () => {
    const { el } = await mount([frame('a'), frame('b')])
    expect(button(el, 'Move slide 1 up')?.disabled).toBe(true)
    expect(button(el, 'Move slide 2 down')?.disabled).toBe(true)
  })

  /**
   * The pointer drag: the same reorder the arrows do, plus three things only it can go wrong at —
   * Escape abandoning a held slide, and a slide vanishing from the scene mid-drag.
   */
  describe('dragging a slide by its handle', () => {
    /** jsdom lays nothing out, so each row states where it is: 20 px tall, stacked from y=0. */
    function layOutRows(el: HTMLElement) {
      ;[...el.querySelectorAll('[data-testid^="presentation-slide-"]')].forEach((row, i) => {
        row.getBoundingClientRect = () => ({ top: i * 20, bottom: i * 20 + 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: i * 20, toJSON: () => ({}) })
      })
    }
    const handle = (el: HTMLElement, order: number) => button(el, `Reorder slide ${order}`)!
    /** jsdom has no PointerEvent; React reads these four fields off whatever is dispatched. */
    const pointer = (node: Element, type: string, clientY: number, button = 0) =>
      act(async () => {
        const event = new MouseEvent(type, { bubbles: true, clientY, button })
        Object.defineProperty(event, 'pointerId', { value: 1 })
        Object.defineProperty(event, 'pointerType', { value: 'mouse' })
        node.dispatchEvent(event)
      })

    it('drops the slide where the pointer let go, and the scene is what changed', async () => {
      const { canvas, el } = await mount([frame('a'), frame('b'), frame('c')])
      layOutRows(el)
      const grip = handle(el, 1)
      await pointer(grip, 'pointerdown', 5)
      await pointer(grip, 'pointermove', 45) // past the middle of row 3
      await pointer(grip, 'pointerup', 45)
      expect(canvas.deck()).toEqual(['b:1', 'c:2', 'a:3'])
      expect(el.querySelector('.presentation-sidebar__live')?.textContent).toBe('Slide moved to position 3')
    })

    it('a drop that never left its own slot writes nothing', async () => {
      const { canvas, el } = await mount([frame('a'), frame('b')])
      layOutRows(el)
      const grip = handle(el, 1)
      await pointer(grip, 'pointerdown', 5)
      await pointer(grip, 'pointerup', 5)
      expect(canvas.updateScene).not.toHaveBeenCalled()
    })

    it('Escape abandons the drag, and the drop that follows writes nothing', async () => {
      const { canvas, el } = await mount([frame('a'), frame('b'), frame('c')])
      layOutRows(el)
      const grip = handle(el, 1)
      await pointer(grip, 'pointerdown', 5)
      await pointer(grip, 'pointermove', 45)
      await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
      await pointer(grip, 'pointerup', 45)
      expect(canvas.updateScene).not.toHaveBeenCalled()
      expect(canvas.deck()).toEqual(['a:1', 'b:2', 'c:3'])
    })

    it('a slide that vanishes from the scene mid-drag drops the drag instead of moving a ghost', async () => {
      const { canvas, el } = await mount([frame('a'), frame('b'), frame('c')])
      layOutRows(el)
      const grip = handle(el, 1)
      await pointer(grip, 'pointerdown', 5)
      await pointer(grip, 'pointermove', 45)
      // Someone deleted the held frame on the canvas; the panel re-derives from the scene.
      await act(async () => void canvas.updateScene({ elements: [frame('b'), frame('c')] }))
      canvas.updateScene.mockClear()
      await pointer(grip, 'pointerup', 45)
      expect(canvas.updateScene).not.toHaveBeenCalled()
      expect(canvas.deck()).toEqual(['b:1', 'c:2'])
    })

    it('a right-click on the handle is not a drag', async () => {
      const { canvas, el } = await mount([frame('a'), frame('b')])
      layOutRows(el)
      const grip = handle(el, 1)
      await pointer(grip, 'pointerdown', 5, 2)
      await pointer(grip, 'pointermove', 45)
      await pointer(grip, 'pointerup', 45)
      expect(canvas.updateScene).not.toHaveBeenCalled()
    })
  })

  it('a reorder announces itself for a screen reader', async () => {
    const { el } = await mount([frame('a'), frame('b')])
    await click(button(el, 'Move slide 1 down'))
    expect(el.querySelector('.presentation-sidebar__live')?.textContent).toBe('Slide moved to position 2')
  })
})

describe('renaming writes the frame’s own name', () => {
  it('Enter commits, and the scene is what changed', async () => {
    const { canvas, el } = await mount([frame('a')])
    await click(button(el, 'Rename slide 1'))
    const field = el.querySelector<HTMLInputElement>('input[aria-label="Slide 1 name"]')
    expect(field).not.toBe(null)
    field!.value = 'Intro'
    await act(async () => void field!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(canvas.updateScene).toHaveBeenCalledWith({ elements: expect.any(Array), captureUpdate: 'immediately' })
    expect(rows(el)).toEqual(['Intro'])
  })

  it('Escape closes the field and writes nothing', async () => {
    const { canvas, el } = await mount([frame('a')])
    await click(button(el, 'Rename slide 1'))
    const field = el.querySelector<HTMLInputElement>('input[aria-label="Slide 1 name"]')!
    field.value = 'Never'
    await act(async () => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(canvas.updateScene).not.toHaveBeenCalled()
    expect(el.querySelector('input')).toBe(null)
  })

  it('an empty name is not a name', async () => {
    const { canvas, el } = await mount([frame('a', { name: 'Intro' })])
    await click(button(el, 'Rename slide 1'))
    const field = el.querySelector<HTMLInputElement>('input[aria-label="Slide 1 name"]')!
    field.value = '   '
    await act(async () => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(canvas.updateScene).not.toHaveBeenCalled()
  })
})

describe('Play', () => {
  it('hands the surface the slide that is selected, or null for the first', async () => {
    const { el } = await mount([frame('a'), frame('b')])
    await click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Start presentation')))
    expect(onStartPresentation).toHaveBeenCalledWith(null)
    await click(button(el, 'Go to slide 2'))
    await click([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Start presentation')))
    expect(onStartPresentation).toHaveBeenLastCalledWith('b')
  })
})
