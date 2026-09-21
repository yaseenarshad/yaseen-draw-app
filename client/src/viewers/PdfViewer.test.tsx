import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PdfResponse, WatchEvent } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import type { WatchListener, WatchSource } from '../hooks/useWatch'
import { PdfViewer } from './PdfViewer'
import viewerCss from './viewers.css?inline'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readPdf: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() },
}))

const readPdf = vi.mocked(api.readPdf)
const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
const createObjectURL = vi.fn<(_: Blob) => string>()
const revokeObjectURL = vi.fn()
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/report.PDF'
let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []
let nextUrl = 1

const watch: WatchSource = {
  subscribe: (listener) => {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((candidate) => candidate !== listener)
    }
  },
}

const response = (data: Uint8Array, mtime = 1, path = PATH): PdfResponse => ({
  path,
  data,
  mtime,
  size: data.byteLength,
})

function mount(path = PATH): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<PdfViewer path={path} watch={watch} />))
  return container
}

function rerender(path: string): void {
  act(() => root?.render(<PdfViewer path={path} watch={watch} />))
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function emit(event: WatchEvent): void {
  act(() => listeners.forEach((listener) => listener(event)))
}

async function bytesOf(blob: Blob): Promise<number[]> {
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.readAsArrayBuffer(blob)
  })
  return [...bytes]
}

beforeEach(() => {
  nextUrl = 1
  createObjectURL.mockImplementation(() => `blob:pdf-${nextUrl++}`)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  delete (URL as unknown as Record<string, unknown>).createObjectURL
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  vi.resetAllMocks()
})

describe('PdfViewer (YAZ-1300)', () => {
  it('loads exact bytes into a titled full-height native PDF frame without text or write bridges', async () => {
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])
    let resolve!: (file: PdfResponse) => void
    readPdf.mockReturnValueOnce(new Promise<PdfResponse>((done) => (resolve = done)))
    const el = mount()

    expect(el.querySelector('.editor-msg')?.textContent).toBe('Loading…')
    expect(el.querySelector('iframe')).toBeNull()

    resolve(response(data))
    await flush()

    expect(readPdf).toHaveBeenCalledExactlyOnceWith(PATH)
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/pdf')
    expect(await bytesOf(blob)).toEqual([...data])
    const frame = el.querySelector<HTMLIFrameElement>('iframe.pdf-viewer__frame')
    expect(frame?.getAttribute('src')).toBe('blob:pdf-1')
    expect(frame?.getAttribute('title')).toBe('report.PDF')
    expect(el.querySelector('button, input, textarea')).toBeNull()
    expect(viewerCss).toMatch(/\.pdf-viewer\s*\{[^}]*display:\s*flex[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s)
    expect(viewerCss).toMatch(/\.pdf-viewer__frame\s*\{[^}]*flex:\s*1[^}]*width:\s*100%[^}]*min-height:\s*0[^}]*border:\s*0/s)
  })

  it('shows bridge failures passively without mounting a native frame', async () => {
    readPdf.mockRejectedValueOnce(new BridgeRequestError('TOO_LARGE', 'PDF exceeds 52428800 bytes'))
    const el = mount()
    await flush()

    const error = el.querySelector('.pdf-viewer__error')
    expect(error?.getAttribute('role')).toBe('status')
    expect(error?.textContent).toBe('TOO_LARGE: PDF exceeds 52428800 bytes')
    expect(el.querySelector('iframe')).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('refreshes only on a matching change, retains the prior frame while loading, and revokes it once on replacement', async () => {
    const first = response(new Uint8Array([1]), 1)
    let resolveReload!: (file: PdfResponse) => void
    readPdf.mockResolvedValueOnce(first).mockReturnValueOnce(new Promise<PdfResponse>((done) => (resolveReload = done)))
    const el = mount()
    await flush()
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-1')

    emit({ type: 'change', path: '/vault/other.pdf', mtime: 2 })
    emit({ type: 'add', path: PATH, mtime: 2 })
    expect(readPdf).toHaveBeenCalledTimes(1)

    emit({ type: 'change', path: PATH, mtime: 2 })
    expect(readPdf).toHaveBeenCalledTimes(2)
    expect(el.querySelector('.pdf-viewer')?.getAttribute('aria-busy')).toBe('true')
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-1')

    resolveReload(response(new Uint8Array([2]), 2))
    await flush()
    expect(el.querySelector('.pdf-viewer')?.getAttribute('aria-busy')).toBe('false')
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-2')
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:pdf-1')
  })

  it('ignores a stale load after the path changes without creating or leaking a URL for it', async () => {
    const nextPath = '/vault/next.pdf'
    let resolveOld!: (file: PdfResponse) => void
    let resolveNext!: (file: PdfResponse) => void
    readPdf
      .mockReturnValueOnce(new Promise<PdfResponse>((done) => (resolveOld = done)))
      .mockReturnValueOnce(new Promise<PdfResponse>((done) => (resolveNext = done)))
    const el = mount()

    rerender(nextPath)
    expect(readPdf.mock.calls).toEqual([[PATH], [nextPath]])
    resolveNext(response(new Uint8Array([2]), 2, nextPath))
    await flush()
    expect(el.querySelector('iframe')?.getAttribute('title')).toBe('next.pdf')
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-1')

    resolveOld(response(new Uint8Array([1]), 1))
    await flush()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-1')
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('transfers URL ownership exactly once when an existing viewer changes paths', async () => {
    const nextPath = '/vault/next.pdf'
    let resolveNext!: (file: PdfResponse) => void
    readPdf
      .mockResolvedValueOnce(response(new Uint8Array([1]), 1))
      .mockReturnValueOnce(new Promise<PdfResponse>((done) => (resolveNext = done)))
    const el = mount()
    await flush()
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-1')

    rerender(nextPath)
    expect(revokeObjectURL.mock.calls).toEqual([['blob:pdf-1']])
    expect(el.querySelector('iframe')).toBeNull()
    resolveNext(response(new Uint8Array([2]), 2, nextPath))
    await flush()
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-2')
    expect(revokeObjectURL.mock.calls).toEqual([['blob:pdf-1']])

    act(() => root?.unmount())
    root = null
    expect(revokeObjectURL.mock.calls).toEqual([['blob:pdf-1'], ['blob:pdf-2']])
  })

  it('revokes the current URL exactly once on unmount after a replacement', async () => {
    readPdf.mockResolvedValueOnce(response(new Uint8Array([1]), 1))
    const el = mount()
    await flush()
    readPdf.mockResolvedValueOnce(response(new Uint8Array([2]), 2))
    emit({ type: 'change', path: PATH, mtime: 2 })
    await flush()
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-2')
    expect(revokeObjectURL.mock.calls).toEqual([['blob:pdf-1']])

    act(() => root?.unmount())
    root = null
    expect(revokeObjectURL.mock.calls).toEqual([['blob:pdf-1'], ['blob:pdf-2']])
  })

  it('keeps the prior native frame below a passive refresh-error banner', async () => {
    readPdf
      .mockResolvedValueOnce(response(new Uint8Array([1]), 1))
      .mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'file changed while being read; try again'))
    const el = mount()
    await flush()

    emit({ type: 'change', path: PATH, mtime: 2 })
    await flush()
    expect(el.querySelector('iframe')?.getAttribute('src')).toBe('blob:pdf-1')
    expect(el.querySelector('.pdf-viewer__error')?.textContent).toBe('IO_ERROR: file changed while being read; try again')
    expect([...el.querySelectorAll('.pdf-viewer > *')].map((node) => node.className)).toEqual(['pdf-viewer__error', 'pdf-viewer__frame'])
    expect(viewerCss).toMatch(/\.pdf-viewer\s*\{[^}]*flex-direction:\s*column/s)
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })
})
