/**
 * The D9 renderer's message contract (🔒 YAZ-1802 D9), with draw.io's viewer page replaced by the
 * one thing the renderer can see of it: postMessage. The iframe never loads in jsdom, so the test
 * plays `yaseen-render.html` — it answers as that iframe's window from `app://drawio` — and reads
 * the requests the renderer posts into it. Each test gets a fresh module: the frame is module state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAWIO_ORIGIN } from '@shared/drawio'

type Renderer = typeof import('./renderDiagram')

let renderer: Renderer
/** Everything the renderer posted into the page, parsed. */
let requests: Array<Record<string, unknown>> = []

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  requests = []
  renderer = await import('./renderDiagram')
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const frame = (): HTMLIFrameElement | null => document.querySelector('iframe')

/** Capture what the renderer posts into the page (jsdom never loads it). */
function tapFrame(): void {
  Object.defineProperty(frame()!.contentWindow, 'postMessage', { configurable: true, value: (data: string, origin: string) => requests.push({ ...(JSON.parse(data) as Record<string, unknown>), _origin: origin }) })
}

/** The page speaking: a JSON string, from the iframe's window, from the drawio origin (unless told otherwise). */
function page(msg: Record<string, unknown>, over: { origin?: string; source?: Window | null } = {}): void {
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg), origin: over.origin ?? DRAWIO_ORIGIN, source: over.source === undefined ? frame()!.contentWindow : over.source }))
}

/** Let the renderer's awaits run. */
const settle = () => vi.advanceTimersByTimeAsync(0)

/** A started page, and the first request it was sent. */
async function started(picture: Promise<string>): Promise<Record<string, unknown>> {
  tapFrame()
  page({ event: 'ready' })
  await settle()
  void picture.catch(() => undefined)
  return requests[0]
}

const XML = '<mxfile><diagram id="p"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>'
const BOUNDS = { maxWidth: 1200, maxHeight: 800, padding: 16 }

describe('renderDiagramPreview', () => {
  it('asks the page, once it is ready, for an SVG that fits the bounds in the app theme and colour setting — to the drawio origin only', async () => {
    const picture = renderer.renderDiagramPreview(XML, 'dark', 'keep', BOUNDS)
    await settle()
    expect(frame()?.getAttribute('src')).toBe(`${DRAWIO_ORIGIN}/yaseen-render.html`)
    const req = await started(picture)
    expect(req).toEqual({ id: expect.any(String), xml: XML, theme: 'dark', adaptive: 'none', format: 'svg', scale: 1, padding: 16, maxWidth: 1200, maxHeight: 800, _origin: DRAWIO_ORIGIN })
    page({ id: req.id, ok: true, dataUrl: 'data:image/svg+xml;base64,AA' })
    await expect(picture).resolves.toBe('data:image/svg+xml;base64,AA')
  })

  it('matches each answer to its request by id, and one page serves them all', async () => {
    const first = renderer.renderDiagramPreview(XML, 'light', 'adapt', BOUNDS)
    await settle()
    tapFrame()
    page({ event: 'ready' })
    const second = renderer.renderDiagramPreview(XML, 'light', 'adapt', BOUNDS)
    await settle()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    expect(requests.map((r) => r.adaptive)).toEqual(['auto', 'auto'])
    page({ id: requests[1].id, ok: true, dataUrl: 'two' })
    page({ id: requests[0].id, ok: true, dataUrl: '' })
    await expect(first).resolves.toBe('')
    await expect(second).resolves.toBe('two')
  })

  it('ignores an answer from another window or another origin, and rejects with the page’s reason', async () => {
    const picture = renderer.renderDiagramPreview(XML, 'light', 'adapt', BOUNDS)
    await settle()
    const req = await started(picture)
    page({ id: req.id, ok: true, dataUrl: 'forged' }, { source: window })
    page({ id: req.id, ok: true, dataUrl: 'forged' }, { origin: 'https://viewer.diagrams.net' })
    page({ id: req.id, ok: false, error: 'not a draw.io diagram' })
    await expect(picture).rejects.toThrow('not a draw.io diagram')
  })

  it('a page that never answers fails the picture instead of hanging it', async () => {
    const picture = renderer.renderDiagramPreview(XML, 'light', 'adapt', BOUNDS)
    await settle()
    await started(picture)
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(picture).rejects.toThrow('timed out')
  })

  it('a page that never starts fails its picture, and the NEXT picture starts a fresh page', async () => {
    const picture = renderer.renderDiagramPreview(XML, 'light', 'adapt', BOUNDS)
    void picture.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(picture).rejects.toThrow('did not start')
    expect(frame()).toBeNull()
    const retry = renderer.renderDiagramPreview(XML, 'light', 'adapt', BOUNDS)
    await settle()
    expect(frame()).not.toBeNull()
    const req = await started(retry)
    page({ id: req.id, ok: true, dataUrl: 'back' })
    await expect(retry).resolves.toBe('back')
  })
})

describe('renderDiagramImage (File › Export Image…)', () => {
  it('asks for the whole first page in light, in the file’s own colours: a PNG at twice the size, an SVG at full size', async () => {
    const png = renderer.renderDiagramImage(XML, 'png')
    await settle()
    const req = await started(png)
    expect(req).toMatchObject({ theme: 'light', adaptive: 'none', format: 'png', scale: 2, padding: 10 })
    expect(req).not.toHaveProperty('maxWidth')
    void renderer.renderDiagramImage(XML, 'svg').catch(() => undefined)
    await settle()
    expect(requests[1]).toMatchObject({ format: 'svg', scale: 1 })
  })
})
