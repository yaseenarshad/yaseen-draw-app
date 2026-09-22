/**
 * The player's KEYBOARD STATE MACHINE and its camera (YAZ-1820). The engine is a stub at the two
 * seams the player names — the imperative handle and `viewportCoordsToSceneCoords` — so what is
 * pinned here is what each key does to the deck, what the camera is asked for, and what a
 * presentation puts back when it ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PRESENTATION_ACTIVE_CLASS, PRESENTATION_TOOLS_CLASS, PRESENTATION_TRANSITION_DURATION, PresentationPlayer, type PresentationPlayerEngine, type PresentationPlayerTarget } from './PresentationPlayer'
import { PRESENTATION_CAMERA_RESERVE } from './camera'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const frame = (id: string, order: number, over: Record<string, unknown> = {}) => ({
  id,
  type: 'frame',
  frameId: null,
  name: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  customData: { presentationOrder: order },
  ...over,
})

const DECK = [frame('a', 1), frame('b', 2), frame('c', 3)]

function fakeCanvas(elements: readonly unknown[] = DECK) {
  let scene = elements
  let listener: ((els: readonly unknown[], appState: { selectedElementIds: Record<string, true> }) => void) | null = null
  const setViewport = vi.fn()
  const setActiveTool = vi.fn()
  const updateFrameRendering = vi.fn()
  const api = {
    getAppState: () => ({ activeTool: { type: 'rectangle' }, selectedElementIds: {} }),
    getSceneElements: () => scene,
    setViewport,
    setActiveTool,
    updateFrameRendering,
    onChange: (cb: typeof listener) => {
      listener = cb
      return () => (listener = null)
    },
  } as unknown as PresentationPlayerTarget
  return {
    api,
    setViewport,
    setActiveTool,
    updateFrameRendering,
    /** The scene changing under the presenter, as `onChange` delivers it. */
    change: async (next: readonly unknown[]) => {
      scene = next
      await act(async () => listener?.(next, { selectedElementIds: {} }))
    },
  }
}

const engine = { viewportCoordsToSceneCoords: vi.fn(() => ({ x: 50, y: 50 })) } as unknown as PresentationPlayerEngine

let root: Root | null = null
let surface: HTMLElement | null = null
const onExit = vi.fn()
const onRestoreFrames = vi.fn()

beforeEach(() => {
  onExit.mockReset()
  onRestoreFrames.mockReset()
  vi.mocked(engine.viewportCoordsToSceneCoords).mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  act(() => root?.unmount())
  surface?.remove()
  root = null
  surface = null
  vi.useRealTimers()
})

async function mount(canvas = fakeCanvas(), initialFrameId: string | null = null) {
  // The player lives inside the surface's own element: that is its containing block, the thing it
  // puts the chrome classes on, and what the camera reserve is measured from.
  surface = document.createElement('div')
  surface.className = 'drawing-surface'
  Object.defineProperty(surface, 'clientWidth', { value: 1000, configurable: true })
  document.body.appendChild(surface)
  root = createRoot(surface)
  await act(async () => {
    root?.render(<PresentationPlayer engine={engine} excalidrawAPI={canvas.api} initialFrameId={initialFrameId} onExit={onExit} onRestoreFrames={onRestoreFrames} />)
  })
  return { canvas, el: surface as HTMLElement }
}

const key = async (k: string, init: KeyboardEventInit = {}) => {
  await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
}
const status = (el: HTMLElement) => el.querySelector('.presentation-player__status')?.textContent ?? ''
const control = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
/** The last frame id `setViewport` was aimed at. */
const lastTarget = (setViewport: ReturnType<typeof vi.fn>) => setViewport.mock.calls.at(-1)?.[0]?.target

describe('starting a presentation', () => {
  it('hides the frame outlines, takes the hand tool, and flies to the first slide', async () => {
    const { canvas } = await mount()
    expect(canvas.updateFrameRendering).toHaveBeenCalledWith({ outline: false, name: false })
    expect(canvas.setActiveTool).toHaveBeenCalledWith({ type: 'hand' })
    expect(canvas.setViewport).toHaveBeenCalledWith({
      target: 'a',
      fit: 'contain',
      animation: { duration: PRESENTATION_TRANSITION_DURATION },
      // The reserve is a fraction of the PANE, not of the window.
      offsets: { ui: true, right: Math.round(1000 * PRESENTATION_CAMERA_RESERVE) },
    })
  })

  it('opens on the slide the panel had selected', async () => {
    const { canvas } = await mount(fakeCanvas(), 'c')
    expect(lastTarget(canvas.setViewport)).toBe('c')
  })

  it('puts the chrome-hiding class on the SURFACE, never on the body', async () => {
    const { el } = await mount()
    expect(el.classList.contains(PRESENTATION_ACTIVE_CLASS)).toBe(true)
    expect(document.body.className).toBe('')
  })

  it('the status line says which slide, and stops saying "Moving to" once the transition lands', async () => {
    const { el } = await mount()
    expect(status(el)).toBe('Moving to slide 1 of 3 — Slide 1')
    await act(async () => void vi.advanceTimersByTime(PRESENTATION_TRANSITION_DURATION + 32))
    expect(status(el)).toBe('Showing slide 1 of 3 — Slide 1')
  })
})

describe('the keyboard', () => {
  it('→ / PageDown / Space advance; ← / PageUp go back', async () => {
    const { canvas } = await mount()
    await key('ArrowRight')
    expect(lastTarget(canvas.setViewport)).toBe('b')
    await key('PageDown')
    expect(lastTarget(canvas.setViewport)).toBe('c')
    await key('ArrowLeft')
    expect(lastTarget(canvas.setViewport)).toBe('b')
    await key('PageUp')
    expect(lastTarget(canvas.setViewport)).toBe('a')
    await key(' ')
    expect(lastTarget(canvas.setViewport)).toBe('b')
  })

  it('clamps at both ends rather than wrapping', async () => {
    const { canvas, el } = await mount()
    await key('ArrowLeft')
    expect(status(el)).toContain('slide 1 of 3')
    await key('End')
    expect(lastTarget(canvas.setViewport)).toBe('c')
    await key('ArrowRight')
    expect(status(el)).toContain('slide 3 of 3')
    await key('Home')
    expect(lastTarget(canvas.setViewport)).toBe('a')
  })

  it('Esc zooms out to the WHOLE deck and never ends the presentation', async () => {
    const { canvas, el } = await mount()
    await key('ArrowRight')
    canvas.setViewport.mockClear()
    await key('Escape')
    expect(lastTarget(canvas.setViewport)).toEqual(['a', 'b', 'c'])
    expect(onExit).not.toHaveBeenCalled()
    // The slide does not change — the presenter is still on it, just zoomed out.
    expect(status(el)).toContain('slide 2 of 3')
  })

  it('⇧T shows the tools — chrome back, selection tool, re-fit — and Space then belongs to the chrome', async () => {
    const { canvas, el } = await mount()
    await key('T', { shiftKey: true })
    expect(el.classList.contains(PRESENTATION_TOOLS_CLASS)).toBe(true)
    expect(canvas.setActiveTool).toHaveBeenLastCalledWith({ type: 'selection' })
    expect(control(el, 'Hide tools (⇧T)')).not.toBe(null)
    canvas.setViewport.mockClear()
    await key(' ')
    expect(canvas.setViewport).not.toHaveBeenCalled()
    await key('T', { shiftKey: true })
    expect(el.classList.contains(PRESENTATION_TOOLS_CLASS)).toBe(false)
    expect(canvas.setActiveTool).toHaveBeenLastCalledWith({ type: 'hand' })
  })

  it('stands down inside a text field, so the engine’s own editing keeps the keys', async () => {
    const { canvas } = await mount()
    const input = document.createElement('input')
    document.body.appendChild(input)
    canvas.setViewport.mockClear()
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(canvas.setViewport).not.toHaveBeenCalled()
    input.remove()
  })

  it('stands down when its tab is NOT the one in front — several engines are mounted at once', async () => {
    const { canvas, el } = await mount()
    const layer = document.createElement('div')
    layer.className = 'tabstack__layer tabstack__layer--hidden'
    document.body.appendChild(layer)
    layer.appendChild(el)
    canvas.setViewport.mockClear()
    await key('ArrowRight')
    expect(canvas.setViewport).not.toHaveBeenCalled()
    layer.remove()
  })

  it('a key it owns is stopped dead; one it does not is left alone', async () => {
    await mount()
    const owned = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    await act(async () => void document.dispatchEvent(owned))
    expect(owned.defaultPrevented).toBe(true)
    const foreign = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true })
    await act(async () => void document.dispatchEvent(foreign))
    expect(foreign.defaultPrevented).toBe(false)
  })
})

describe('the control bar and the pointer', () => {
  it('the arrows step and disable at the ends', async () => {
    const { canvas, el } = await mount()
    expect(control(el, 'Previous slide (←)')?.disabled).toBe(true)
    await act(async () => void control(el, 'Next slide (→)')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(lastTarget(canvas.setViewport)).toBe('b')
    await act(async () => void control(el, 'Next slide (→)')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(control(el, 'Next slide (→)')?.disabled).toBe(true)
  })

  it('a double-click on the canvas presents the slide under the pointer', async () => {
    const { canvas } = await mount()
    canvas.setViewport.mockClear()
    vi.mocked(engine.viewportCoordsToSceneCoords).mockReturnValueOnce({ x: 50, y: 50 } as never)
    await act(async () => void document.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))
    // Every slide in this deck sits at the same bounds, so the first one under the point wins.
    expect(lastTarget(canvas.setViewport)).toBe('a')
  })

  it('a double-click that misses every slide changes nothing', async () => {
    const { canvas } = await mount()
    canvas.setViewport.mockClear()
    vi.mocked(engine.viewportCoordsToSceneCoords).mockReturnValueOnce({ x: 9999, y: 9999 } as never)
    await act(async () => void document.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))
    expect(canvas.setViewport).not.toHaveBeenCalled()
  })
})

describe('the deck changing under the presenter', () => {
  it('a reorder keeps the presenter on the SAME slide, by id', async () => {
    const { canvas, el } = await mount()
    await key('ArrowRight')
    expect(status(el)).toContain('slide 2 of 3')
    await canvas.change([frame('b', 1), frame('a', 2), frame('c', 3)])
    expect(status(el)).toContain('slide 1 of 3')
  })

  it('the slide being DELETED moves to its neighbour', async () => {
    const { canvas, el } = await mount()
    await key('ArrowRight')
    canvas.setViewport.mockClear()
    await canvas.change([frame('a', 1), frame('c', 2)])
    expect(lastTarget(canvas.setViewport)).toBe('c')
    expect(status(el)).toContain('of 2')
  })

  it('the LAST frame going leaves the presentation, putting everything back', async () => {
    const { canvas } = await mount()
    await canvas.change([{ id: 'r', type: 'rectangle' }])
    expect(onExit).toHaveBeenCalledOnce()
    expect(canvas.setViewport).toHaveBeenLastCalledWith(null)
    expect(onRestoreFrames).toHaveBeenCalled()
  })
})

describe('ending', () => {
  it('✕ releases the camera, restores the tool and the user’s own frames preference', async () => {
    const { canvas, el } = await mount()
    await act(async () => void control(el, 'Exit presentation')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(canvas.setViewport).toHaveBeenLastCalledWith(null)
    // The tool the presenter had BEFORE presenting, not a hardcoded one.
    expect(canvas.setActiveTool).toHaveBeenLastCalledWith({ type: 'rectangle' })
    expect(onRestoreFrames).toHaveBeenCalledOnce()
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('an UNMOUNT ends it too — the classes come off and nothing is left holding the camera', async () => {
    const { canvas, el } = await mount()
    await act(async () => root?.unmount())
    root = null
    expect(el.classList.contains(PRESENTATION_ACTIVE_CLASS)).toBe(false)
    expect(canvas.setViewport).toHaveBeenLastCalledWith(null)
    expect(onRestoreFrames).toHaveBeenCalledOnce()
    // An unmount is not the presenter asking to leave; the host already knows.
    expect(onExit).not.toHaveBeenCalled()
  })

  it('a key after the end does nothing', async () => {
    const { canvas, el } = await mount()
    await act(async () => void control(el, 'Exit presentation')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    canvas.setViewport.mockClear()
    await key('ArrowRight')
    expect(canvas.setViewport).not.toHaveBeenCalled()
  })
})
