/**
 * The drawing modal (YAZ-879): open → edit → Save writes the sidecar back and pokes the feed.
 *
 * The ENGINE is mocked and nothing else is: `ExcalidrawSurface` — the ONE seam that owns the
 * canvas — stands in as a component that hands its props back, so every rule pinned here is the
 * MODAL's own (dirty tracking, the discard strip, the key scope, the conflict retry) and none of
 * it depends on Excalidraw. The real package cannot load in jsdom anyway (it imports
 * `roughjs/bin/rough` extensionlessly), which is exactly why the seam is a component boundary.
 *
 * `api` is mocked one level down instead of `saveDrawing`, so the write the user's Save actually
 * makes — bytes, path, `expectedMtime`, and the CONFLICT retry — is the thing under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { api, BridgeRequestError } from '../api'
import { createDrawingFeed } from './drawingFeed'
import { BROKEN_DRAWING_MESSAGE, DISCARD_PROMPT, DrawingModal } from './DrawingModal'
import type { DrawingSurfaceProps } from './ExcalidrawSurface'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { readAsset: vi.fn(), writeAsset: vi.fn() },
}))

/** The stand-in engine: it renders nothing and reports the props the modal handed it. */
const seam = vi.hoisted(() => ({ props: null as DrawingSurfaceProps | null, mounts: 0 }))
vi.mock('./ExcalidrawSurface', () => ({
  ENGINE_LOAD_FAILED: "Can't open the drawing editor.",
  ExcalidrawSurface: (props: DrawingSurfaceProps) => {
    seam.props = props
    seam.mounts += 1
    return <div className="fake-surface" />
  },
}))

const readAsset = vi.mocked(api.readAsset)
const writeAsset = vi.mocked(api.writeAsset)

const ROOT = '/v'
const TARGET = 'Sketch.excalidraw'
const PATH = '/v/assets/drawings/Sketch.excalidraw'
/** What the mocked seam's `serialize()` returns — the exact bytes a save must carry. */
const BYTES = '{"type":"excalidraw","elements":[1]}\n'

const asset = (mtime: number) => ({
  path: PATH,
  mime: 'application/json',
  data: btoa('{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}'),
  size: 10,
  mtime,
})

let root: Root | null = null
let container: HTMLElement | null = null
/** A node OUTSIDE the React root — the YAZ-888 lesson's probe. */
let outside: HTMLElement | null = null

beforeEach(() => {
  seam.props = null
  seam.mounts = 0
  readAsset.mockReset()
  writeAsset.mockReset()
  writeAsset.mockResolvedValue({ path: PATH, mtime: 999, size: BYTES.length })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  outside?.remove()
  outside = null
})

interface Mounted {
  overlay: HTMLElement
  onClose: ReturnType<typeof vi.fn>
  feed: ReturnType<typeof createDrawingFeed>
  poked: string[]
}

/** Mounts the modal over a resolved (or rejected) read and flushes the load. */
async function open(read: 'ok' | 'broken' = 'ok', mtime = 100): Promise<Mounted> {
  if (read === 'ok') readAsset.mockResolvedValue(asset(mtime))
  else readAsset.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'no such asset'))
  const onClose = vi.fn()
  const feed = createDrawingFeed()
  const poked: string[] = []
  feed.subscribe((t) => poked.push(t))
  container = document.createElement('div')
  document.body.appendChild(container)
  outside = document.createElement('button')
  document.body.appendChild(outside)
  root = createRoot(container)
  await act(async () => {
    root?.render(<DrawingModal root={ROOT} target={TARGET} theme="light" feed={feed} onClose={onClose} />)
  })
  const overlay = container.querySelector<HTMLElement>('.drawing-modal-overlay')
  if (overlay === null) throw new Error('missing .drawing-modal-overlay')
  return { overlay, onClose, feed, poked }
}

const saveBtn = (): HTMLButtonElement => {
  const btn = container?.querySelector<HTMLButtonElement>('.drawing-modal__bar .drawing-modal__btn')
  if (btn === null || btn === undefined) throw new Error('missing Save')
  return btn
}
const byText = (text: string): HTMLButtonElement | undefined =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((b) => b.textContent === text)
const strip = () => container?.querySelector('.drawing-modal__confirm')?.textContent ?? null
const errorLine = () => container?.querySelector('.drawing-modal__error')?.textContent ?? null

/** One snapshot from the stand-in engine; the FIRST is the modal's clean baseline. */
function emit(version: number): void {
  act(() => seam.props?.onSnapshot({ version, serialize: () => BYTES }))
}

const escOn = (el: Node): void => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}
const mousedownOn = (el: Node): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
}

describe('opening', () => {
  it('loads the scene through the asset pipe and hands it to the ONE seam, with the app theme', async () => {
    await open()
    expect(readAsset).toHaveBeenCalledWith(ROOT, TARGET)
    expect(seam.mounts).toBe(1)
    expect(seam.props?.scene).toEqual({ elements: [], appState: {}, files: {} })
    expect(seam.props?.theme).toBe('light')
    expect(container?.querySelector('.fake-surface')).not.toBeNull()
  })

  it('a drawing opened and not touched is CLEAN: Save is disabled', async () => {
    await open()
    emit(7) // the surface's mount snapshot — the baseline, not an edit
    expect(saveBtn().disabled).toBe(true)
  })

  it('the first change enables Save', async () => {
    await open()
    emit(7)
    emit(8)
    expect(saveBtn().disabled).toBe(false)
  })

  it('a scene back at its opening version is clean again — the baseline is a value, not a flag', async () => {
    await open()
    emit(7)
    emit(8)
    emit(7)
    expect(saveBtn().disabled).toBe(true)
  })
})

describe('saving', () => {
  it('writes the serialized scene to the RESOLVED path with the loaded mtime, pokes the feed and closes', async () => {
    const { onClose, poked } = await open('ok', 4242)
    emit(1)
    emit(2)
    await act(async () => saveBtn().click())
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(writeAsset).toHaveBeenCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 4242 })
    // Every preview of this target re-reads on the poke (YAZ-878's feed).
    expect(poked).toEqual([TARGET])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a CONFLICT retries ONCE over a refreshed mtime — the canvas wins, the disk bytes are dropped', async () => {
    const { onClose, poked } = await open('ok', 100)
    emit(1)
    emit(2)
    writeAsset.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 555))
    // The re-read exists only to refresh the guard; its scene is never merged in.
    readAsset.mockResolvedValue(asset(555))
    await act(async () => saveBtn().click())
    expect(writeAsset).toHaveBeenCalledTimes(2)
    expect(writeAsset).toHaveBeenLastCalledWith({ root: ROOT, path: PATH, content: BYTES, expectedMtime: 555 })
    expect(poked).toEqual([TARGET])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a failed write is an INLINE error and never a dialog: the modal stays open with the canvas intact', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    writeAsset.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk is full'))
    await act(async () => saveBtn().click())
    expect(errorLine()).toContain('disk is full')
    expect(onClose).not.toHaveBeenCalled()
    expect(container?.querySelector('.fake-surface')).not.toBeNull()
    // Still dirty, so the user can try again.
    expect(saveBtn().disabled).toBe(false)
  })

  it('a second CONFLICT is not retried again — a racing writer is not a retry problem', async () => {
    const { onClose } = await open()
    emit(1)
    emit(2)
    writeAsset.mockRejectedValue(new BridgeRequestError('CONFLICT', 'drawing changed on disk', 7))
    readAsset.mockResolvedValue(asset(7))
    await act(async () => saveBtn().click())
    expect(writeAsset).toHaveBeenCalledTimes(2)
    expect(errorLine()).toContain('drawing changed on disk')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('leaving', () => {
  it('Esc on a CLEAN modal closes it outright', async () => {
    const { overlay, onClose } = await open()
    emit(1)
    escOn(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(strip()).toBeNull()
  })

  it('Esc on a DIRTY modal asks inline first; Discard closes and writes nothing', async () => {
    const { overlay, onClose } = await open()
    emit(1)
    emit(2)
    escOn(overlay)
    expect(onClose).not.toHaveBeenCalled()
    expect(strip()).toContain(DISCARD_PROMPT)
    act(() => byText('Discard')?.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(writeAsset).not.toHaveBeenCalled()
  })

  it('Cancel on the strip stays put — nothing closes and nothing is written', async () => {
    const { overlay, onClose } = await open()
    emit(1)
    emit(2)
    escOn(overlay)
    act(() => byText('Cancel')?.click())
    expect(strip()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(writeAsset).not.toHaveBeenCalled()
    expect(container?.querySelector('.fake-surface')).not.toBeNull()
  })

  it('Esc while the strip is up answers the STRIP, not the modal', async () => {
    const { overlay, onClose } = await open()
    emit(1)
    emit(2)
    escOn(overlay)
    escOn(overlay)
    expect(strip()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('click-away mirrors Esc: clean closes, dirty asks — and a click INSIDE the sheet does neither', async () => {
    const clean = await open()
    emit(1)
    mousedownOn(clean.overlay.querySelector('.drawing-modal') as Node)
    expect(clean.onClose).not.toHaveBeenCalled()
    mousedownOn(clean.overlay)
    expect(clean.onClose).toHaveBeenCalledTimes(1)

    act(() => root?.unmount())
    container?.remove()
    outside?.remove()
    const dirty = await open()
    emit(1)
    emit(2)
    mousedownOn(dirty.overlay)
    expect(dirty.onClose).not.toHaveBeenCalled()
    expect(strip()).toContain(DISCARD_PROMPT)
  })

  it('✕ is the same gesture', async () => {
    const { onClose } = await open()
    emit(1)
    act(() => container?.querySelector<HTMLButtonElement>('.drawing-modal__close')?.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/**
 * ⚡ THE YAZ-888 LESSON, pinned. React flushes mount effects inside the dispatch of the event that
 * opened the component, so a listener on `window` hears the very keystroke or click that opened
 * this modal. Bound to the overlay, a key from outside it is simply not ours.
 */
describe('key scope (⚡ the YAZ-888 lesson)', () => {
  it('an Escape dispatched OUTSIDE the overlay does nothing at all', async () => {
    const { onClose } = await open()
    emit(1)
    escOn(outside as Node)
    escOn(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a mousedown OUTSIDE the overlay does nothing either', async () => {
    const { onClose } = await open()
    emit(1)
    mousedownOn(outside as Node)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('a sidecar that will not open', () => {
  it('is the error state: a message, no canvas, and no way to write', async () => {
    const { onClose } = await open('broken')
    expect(errorLine()).toBe(BROKEN_DRAWING_MESSAGE)
    expect(seam.mounts).toBe(0)
    expect(container?.querySelector('.fake-surface')).toBeNull()
    expect(saveBtn().disabled).toBe(true)
    expect(writeAsset).not.toHaveBeenCalled()
    // Closing is all it offers, and it needs no confirm — there is nothing to discard.
    act(() => container?.querySelector<HTMLButtonElement>('.drawing-modal__close')?.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

/**
 * 🔒 THE ENGINE SEAM. `ExcalidrawSurface` is the one file YAZ-868 rewrites to swap in yaseendraw;
 * the modal must reach the canvas only through it. Read as SOURCE on purpose: a runtime assertion
 * would pass just as well with a second, hidden import of the package.
 */
describe('the engine seam (🔒 one file, YAZ-868 swaps it)', () => {
  const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

  it('DrawingModal names neither the engine nor its loader — only the seam', () => {
    const src = source('./DrawingModal.tsx')
    const imports = src.match(/^import .*$/gm) ?? []
    expect(imports.some((line) => line.includes("'./ExcalidrawSurface'"))).toBe(true)
    expect(imports.some((line) => line.includes('@excalidraw'))).toBe(false)
    expect(imports.some((line) => line.includes('renderScene'))).toBe(false)
  })

  it('the canvas element itself is mounted in the surface and nowhere else', () => {
    // `<ExcalidrawSurface …>` in the modal is the SEAM; `<Excalidraw …>` is the engine.
    const engineElement = /<Excalidraw(?!Surface)[\s/>]/
    expect(source('./ExcalidrawSurface.tsx')).toMatch(engineElement)
    expect(source('./DrawingModal.tsx')).not.toMatch(engineElement)
  })
})
