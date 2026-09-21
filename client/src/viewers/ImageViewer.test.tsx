import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import type { ImageResponse, WatchEvent } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import type { WatchListener, WatchSource } from '../hooks/useWatch'
import { ImageViewer } from './ImageViewer'
import viewerCss from './viewers.css?inline'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readImage: vi.fn(), readFile: vi.fn(), readPdf: vi.fn(), writeFile: vi.fn() },
}))

const readImage = vi.mocked(api.readImage)
const readFile = vi.mocked(api.readFile)
const readPdf = vi.mocked(api.readPdf)
const writeFile = vi.mocked(api.writeFile)
const drawImage = vi.fn()
const clearRect = vi.fn()
const getContext = vi.fn(() => ({ drawImage, clearRect }))
const createImageBitmapMock = vi.fn<(blob: Blob) => Promise<ImageBitmap>>()
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/animated.GIF'
let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []

const watch: WatchSource = {
  subscribe: (listener) => {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((candidate) => candidate !== listener)
    }
  },
}

const response = (data: Uint8Array, path = PATH, mime: ImageResponse['mime'] = 'image/gif'): ImageResponse => ({
  path,
  data,
  mime,
  mtime: 1,
  size: data.byteLength,
})

function bitmap(width = 320, height = 180): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap
}

function mount(path = PATH): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ImageViewer path={path} watch={watch} />))
  return container
}

function rerender(path: string): void {
  act(() => root?.render(<ImageViewer path={path} watch={watch} />))
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function emit(event: WatchEvent): void {
  act(() => listeners.forEach((listener) => listener(event)))
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: createImageBitmapMock })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext as never)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  delete (globalThis as unknown as Record<string, unknown>).createImageBitmap
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('ImageViewer (YAZ-1322)', () => {
  it('decodes once, paints the default frame, closes the bitmap once, and exposes no editor controls', async () => {
    const bytes = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    const decoded = bitmap()
    readImage.mockResolvedValueOnce(response(bytes))
    createImageBitmapMock.mockResolvedValueOnce(decoded)
    const el = mount()
    await flush()

    expect(readImage).toHaveBeenCalledExactlyOnceWith(PATH)
    expect(createImageBitmapMock).toHaveBeenCalledOnce()
    const blob = createImageBitmapMock.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/gif')
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(decoded, 0, 0)
    expect(decoded.close).toHaveBeenCalledOnce()
    const canvas = el.querySelector<HTMLCanvasElement>('canvas.image-viewer__canvas')
    expect(canvas?.width).toBe(320)
    expect(canvas?.height).toBe(180)
    expect(canvas?.hidden).toBe(false)
    expect(el.querySelector('.image-viewer__name')?.textContent).toBe('animated.GIF')
    expect(el.querySelector('.image-viewer__badge')?.textContent).toBe('Read only')
    expect(el.querySelector('button, input, textarea')).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
    expect(readPdf).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(viewerCss).toMatch(/\.image-viewer__stage\s*\{[^}]*place-items:\s*center[^}]*overflow:\s*auto/s)
    expect(viewerCss).toMatch(/\.image-viewer__canvas\s*\{[^}]*max-width:\s*100%[^}]*max-height:\s*100%/s)
  })

  it('reloads only on a matching change and keeps the prior canvas visible until replacement paints', async () => {
    const first = bitmap(10, 20)
    const second = bitmap(30, 40)
    let resolveReload!: (file: ImageResponse) => void
    readImage
      .mockResolvedValueOnce(response(new Uint8Array([1])))
      .mockReturnValueOnce(new Promise<ImageResponse>((resolve) => (resolveReload = resolve)))
    createImageBitmapMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const el = mount()
    await flush()

    emit({ type: 'change', path: '/vault/other.gif', mtime: 2 })
    emit({ type: 'add', path: PATH, mtime: 2 })
    expect(readImage).toHaveBeenCalledTimes(1)
    emit({ type: 'change', path: PATH, mtime: 2 })
    expect(readImage).toHaveBeenCalledTimes(2)
    expect(el.querySelector('canvas')?.hidden).toBe(false)
    expect(el.querySelector('.image-viewer')?.getAttribute('aria-busy')).toBe('true')

    resolveReload(response(new Uint8Array([2])))
    await flush()
    expect(drawImage.mock.calls).toEqual([[first, 0, 0], [second, 0, 0]])
    expect(first.close).toHaveBeenCalledOnce()
    expect(second.close).toHaveBeenCalledOnce()
    expect(el.querySelector<HTMLCanvasElement>('canvas')?.width).toBe(30)
  })

  it('closes a stale decoded bitmap without painting it after the path changes', async () => {
    const nextPath = '/vault/next.png'
    const oldBitmap = bitmap(1, 1)
    const nextBitmap = bitmap(2, 2)
    let resolveOld!: (value: ImageBitmap) => void
    let resolveNext!: (value: ImageBitmap) => void
    readImage
      .mockResolvedValueOnce(response(new Uint8Array([1])))
      .mockResolvedValueOnce(response(new Uint8Array([2]), nextPath, 'image/png'))
    createImageBitmapMock
      .mockReturnValueOnce(new Promise<ImageBitmap>((resolve) => (resolveOld = resolve)))
      .mockReturnValueOnce(new Promise<ImageBitmap>((resolve) => (resolveNext = resolve)))
    const el = mount()
    await flush()
    rerender(nextPath)
    await flush()
    expect(el.querySelector('canvas')?.hidden).toBe(true)

    resolveNext(nextBitmap)
    await flush()
    resolveOld(oldBitmap)
    await flush()

    expect(drawImage).toHaveBeenCalledExactlyOnceWith(nextBitmap, 0, 0)
    expect(nextBitmap.close).toHaveBeenCalledOnce()
    expect(oldBitmap.close).toHaveBeenCalledOnce()
    expect(el.querySelector('.image-viewer__name')?.textContent).toBe('next.png')
  })

  it('hides old pixels immediately when the path changes, before the next read resolves', async () => {
    const first = bitmap()
    let resolveNext!: (file: ImageResponse) => void
    readImage
      .mockResolvedValueOnce(response(new Uint8Array([1])))
      .mockReturnValueOnce(new Promise<ImageResponse>((resolve) => (resolveNext = resolve)))
    createImageBitmapMock.mockResolvedValueOnce(first)
    const el = mount()
    await flush()
    expect(el.querySelector('canvas')?.hidden).toBe(false)

    rerender('/vault/new.bmp')
    expect(el.querySelector('canvas')?.hidden).toBe(true)
    expect(el.querySelector('.image-viewer__name')?.textContent).toBe('new.bmp')
    expect(resolveNext).toBeTypeOf('function')
  })

  it('shows bridge and decode failures passively, closing a bitmap when painting cannot start', async () => {
    readImage.mockRejectedValueOnce(new BridgeRequestError('TOO_LARGE', 'image exceeds 52428800 bytes'))
    const bridgeEl = mount()
    await flush()
    expect(bridgeEl.querySelector('[role="status"]')?.textContent).toBe('TOO_LARGE: image exceeds 52428800 bytes')
    expect(bridgeEl.querySelector('canvas')?.hidden).toBe(true)

    act(() => root?.unmount())
    root = null
    const decoded = bitmap()
    readImage.mockResolvedValueOnce(response(new Uint8Array([3])))
    createImageBitmapMock.mockResolvedValueOnce(decoded)
    getContext.mockReturnValueOnce(null as never)
    const decodeEl = mount()
    await flush()
    expect(decodeEl.querySelector('[role="status"]')?.textContent).toBe('Failed to decode image')
    expect(decoded.close).toHaveBeenCalledOnce()
  })
})
