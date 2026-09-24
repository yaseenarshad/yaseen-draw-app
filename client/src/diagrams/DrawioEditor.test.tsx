/**
 * The diagram document's host (YAZ-1802), with draw.io replaced by the one thing the host can see
 * of it: postMessage. The iframe never loads in jsdom, so the test plays draw.io — it posts the
 * protocol's events as that iframe's window from `app://drawio` and reads what the host posts
 * back — and every rule (the handshake order, the baseline, the debounce, echo / reload /
 * conflict, retire) runs through the real `Autosave` and the real host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { WatchEvent } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { diagram: { load: vi.fn(), save: vi.fn() } },
}))

import { api, BridgeRequestError } from '../api'
import { _resetRenameContinuity, retirePath } from '../lib/renameContinuity'
import { BROKEN_DIAGRAM_DOCUMENT, DrawioEditor } from './DrawioEditor'
import { DRAWIO_ORIGIN } from './drawioProtocol'

const load = vi.mocked(api.diagram.load)
const save = vi.mocked(api.diagram.save)

const ROOT = '/vault'
const PATH = '/vault/Flow.drawio'
const XML = '<mxfile><diagram id="p" name="Page-1"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>'
const EDITED = XML.replace('Page-1', 'Edited')

const listeners = new Set<(ev: WatchEvent) => void>()
const watch = {
  subscribe: (listener: (ev: WatchEvent) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
function watcherSaw(ev: WatchEvent): void {
  act(() => listeners.forEach((l) => l(ev)))
}

let root: Root | null = null
let container: HTMLElement
/** Everything the host posted into the iframe, parsed. */
let posted: Array<Record<string, unknown>> = []
let flushListener: (() => Promise<void> | void) | null = null

function render(): void {
  act(() => root?.render(<DrawioEditor root={ROOT} path={PATH} watch={watch} />))
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const frame = (): HTMLIFrameElement | null => container.querySelector('iframe')

/** Capture what the host posts into the iframe (jsdom never loads it). */
function tapFrame(): void {
  const win = frame()?.contentWindow
  if (!win) throw new Error('no iframe')
  Object.defineProperty(win, 'postMessage', { configurable: true, value: (data: string, origin: string) => posted.push({ ...(JSON.parse(data) as Record<string, unknown>), _origin: origin }) })
}

/** draw.io speaking: a JSON string, from the iframe's window, from the drawio origin (unless told otherwise). */
function drawio(msg: Record<string, unknown>, over: { origin?: string; source?: Window | null } = {}): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg), origin: over.origin ?? DRAWIO_ORIGIN, source: over.source === undefined ? frame()!.contentWindow : over.source }))
  })
}

/** Mount, and walk draw.io through the handshake to a loaded, clean document. */
async function opened(): Promise<void> {
  render()
  await settle()
  tapFrame()
  drawio({ event: 'yaseenReady' })
  drawio({ event: 'configure' })
  drawio({ event: 'init' })
  drawio({ event: 'load', xml: XML })
}

const text = (): string => container.textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  listeners.clear()
  posted = []
  flushListener = null
  Object.defineProperty(window, 'yaseenDraw', {
    configurable: true,
    writable: true,
    value: {
      window: {
        onFlush: (listener: () => Promise<void> | void) => {
          flushListener = listener
          return () => {
            flushListener = null
          }
        },
      },
    },
  })
  load.mockResolvedValue({ path: PATH, xml: XML, mtime: 100, size: XML.length })
  save.mockResolvedValue({ path: PATH, mtime: 200, size: 50 })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  _resetRenameContinuity()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('opening', () => {
  it('a file main refuses is the error pane with its reason — and draw.io is never mounted on it', async () => {
    load.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'the file is empty'))
    render()
    await settle()
    expect(text()).toContain(`${BROKEN_DIAGRAM_DOCUMENT}: the file is empty.`)
    expect(frame()).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('mounts draw.io on its own origin with the app theme and the offline flags', async () => {
    render()
    await settle()
    const src = new URL(frame()!.src)
    expect(`${src.protocol}//${src.host}`).toBe(DRAWIO_ORIGIN)
    expect(src.searchParams.get('offline')).toBe('1')
    expect(src.searchParams.get('configure')).toBe('1')
  })
})

describe('the handshake (drawioProtocol.ts)', () => {
  it('configures only once our PostConfig said it is ready, then loads the XML with autosave on', async () => {
    render()
    await settle()
    tapFrame()
    drawio({ event: 'configure' })
    expect(posted).toEqual([])
    drawio({ event: 'yaseenReady' })
    expect(posted[0]).toMatchObject({ action: 'configure', _origin: DRAWIO_ORIGIN })
    expect((posted[0].config as Record<string, unknown>).compressXml).toBe(false)
    drawio({ event: 'init' })
    expect(posted[1]).toMatchObject({ action: 'load', xml: XML, autosave: 1, title: 'Flow' })
  })

  it('configures anyway after a while when the overlay never answers — the document must still open', async () => {
    render()
    await settle()
    tapFrame()
    drawio({ event: 'configure' })
    await act(async () => {
      vi.advanceTimersByTime(3100)
    })
    expect(posted[0]).toMatchObject({ action: 'configure' })
  })

  it('ignores the same events from another window or another origin', async () => {
    render()
    await settle()
    tapFrame()
    drawio({ event: 'yaseenReady' }, { origin: 'https://app.diagrams.net' })
    drawio({ event: 'configure' }, { source: window })
    drawio({ event: 'yaseenReady' })
    expect(posted).toEqual([])
  })
})

describe('saving', () => {
  it('opening and not touching writes nothing; an edit saves the latest XML 500 ms later under the loaded mtime', async () => {
    await opened()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(save).not.toHaveBeenCalled()
    drawio({ event: 'autosave', xml: EDITED })
    expect(text()).toContain('Unsaved')
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await settle()
    expect(save).toHaveBeenCalledExactlyOnceWith({ root: ROOT, path: PATH, xml: EDITED, expectedMtime: 100 })
    expect(text()).toContain('Saved')
  })

  it('⌘S (draw.io`s own save event) writes at once', async () => {
    await opened()
    drawio({ event: 'save', xml: EDITED })
    await settle()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ xml: EDITED }))
  })

  it('the quit handshake flushes a pending edit', async () => {
    await opened()
    drawio({ event: 'autosave', xml: EDITED })
    await act(async () => {
      await flushListener?.()
    })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ xml: EDITED }))
  })

  it('a retired host (deleted, renamed away) never writes again, not even on unmount', async () => {
    await opened()
    drawio({ event: 'autosave', xml: EDITED })
    retirePath(PATH)
    act(() => root?.unmount())
    root = null
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(save).not.toHaveBeenCalled()
  })
})

describe('changes on disk', () => {
  it('our own save’s echo is ignored', async () => {
    await opened()
    drawio({ event: 'save', xml: EDITED })
    await settle()
    load.mockClear()
    watcherSaw({ type: 'change', path: PATH, mtime: 200 })
    await settle()
    expect(load).not.toHaveBeenCalled()
  })

  it('a CLEAN tab reloads the disk into draw.io; its answer is the new baseline, not an edit', async () => {
    await opened()
    load.mockResolvedValue({ path: PATH, xml: EDITED, mtime: 300, size: 1 })
    watcherSaw({ type: 'change', path: PATH, mtime: 300 })
    await settle()
    expect(posted.at(-1)).toMatchObject({ action: 'load', xml: EDITED })
    drawio({ event: 'load', xml: EDITED })
    drawio({ event: 'autosave', xml: `${EDITED} ` })
    await act(async () => {
      vi.advanceTimersByTime(600)
    })
    await settle()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedMtime: 300 }))
  })

  it('a DIRTY tab gets Reload / Keep mine; Keep mine overwrites under the disk’s mtime', async () => {
    await opened()
    drawio({ event: 'autosave', xml: EDITED })
    watcherSaw({ type: 'change', path: PATH, mtime: 400 })
    await settle()
    expect(text()).toContain('File changed on disk.')
    const keep = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Keep mine')!
    await act(async () => keep.click())
    await settle()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ xml: EDITED, expectedMtime: 400 }))
  })

  it('a CONFLICT from the save door raises the same bar', async () => {
    save.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'changed', 500))
    await opened()
    drawio({ event: 'save', xml: EDITED })
    await settle()
    expect(text()).toContain('File changed on disk.')
  })
})
