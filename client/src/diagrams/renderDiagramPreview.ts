/**
 * A DIAGRAM'S PICTURE (🔒 YAZ-1802 D9), drawn by draw.io's own read-only viewer — the sidebar's
 * hover preview for a `.drawio`, `createScenePreviewPng`'s twin.
 *
 * The viewer runs where the editor runs: on the drawio ORIGIN, under its no-network CSP, in our
 * own small page (`app://drawio/yaseen-render.html`, written into the webapp by packDrawio — no
 * draw.io file is touched). ONE hidden iframe serves every request for the renderer's life;
 * each request is `{ id, xml, theme, maxWidth, maxHeight, padding }`, each answer an SVG data URL
 * of the first page (`''` when the page is empty) or a failure, and both travel as JSON strings
 * checked against that iframe's window and origin, exactly like the editor's protocol.
 *
 * The frame is laid out off-screen rather than `display: none`: draw.io measures its labels in
 * its own document, and a document with no layout would measure every label as zero.
 */
import type { PreviewBounds } from '../lib/scenePreview'
import { DRAWIO_ORIGIN } from './drawioProtocol'

const RENDER_URL = `${DRAWIO_ORIGIN}/yaseen-render.html`
/** A picture that has not come back by then is a failure ("Preview unavailable"), not a hang. */
const RENDER_TIMEOUT_MS = 15_000

interface Pending {
  resolve: (dataUrl: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let frame: HTMLIFrameElement | null = null
let ready: Promise<void> | null = null
const pending = new Map<string, Pending>()
let serial = 0

/** The shared frame, created on first use; resolves once its page says `ready`. */
function renderFrame(): Promise<HTMLIFrameElement> {
  if (frame !== null && ready !== null) {
    const f = frame
    return ready.then(() => f)
  }
  const f = document.createElement('iframe')
  f.src = RENDER_URL
  f.title = 'Diagram preview renderer'
  f.tabIndex = -1
  f.setAttribute('aria-hidden', 'true')
  f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:800px;border:0;visibility:hidden;pointer-events:none;'
  frame = f
  ready = new Promise<void>((resolve) => {
    const onReady = (ev: MessageEvent): void => {
      if (ev.source !== f.contentWindow || ev.origin !== DRAWIO_ORIGIN || typeof ev.data !== 'string') return
      try {
        if ((JSON.parse(ev.data) as { event?: unknown }).event !== 'ready') return
      } catch {
        return
      }
      window.removeEventListener('message', onReady)
      resolve()
    }
    window.addEventListener('message', onReady)
  })
  window.addEventListener('message', onAnswer)
  document.body.appendChild(f)
  return ready.then(() => f)
}

/** Every answer from the frame, matched to its request by id. */
function onAnswer(ev: MessageEvent): void {
  if (frame === null || ev.source !== frame.contentWindow || ev.origin !== DRAWIO_ORIGIN || typeof ev.data !== 'string') return
  let msg: { id?: unknown; ok?: unknown; dataUrl?: unknown; error?: unknown }
  try {
    msg = JSON.parse(ev.data) as typeof msg
  } catch {
    return
  }
  if (typeof msg.id !== 'string') return
  const job = pending.get(msg.id)
  if (job === undefined) return
  pending.delete(msg.id)
  clearTimeout(job.timer)
  if (msg.ok === true && typeof msg.dataUrl === 'string') job.resolve(msg.dataUrl)
  else job.reject(new Error(typeof msg.error === 'string' ? msg.error : 'diagram preview failed'))
}

/**
 * The first page of `xml` as an SVG data URL fit inside `bounds`, in the app's `theme`; `''` for
 * a page with nothing on it. Rejects when the XML is not a diagram, or nothing answers in time.
 */
export async function renderDiagramPreview(xml: string, theme: 'light' | 'dark', bounds: PreviewBounds): Promise<string> {
  // A frame that never says `ready` (no webapp unpacked, say) must fail the picture, not hang it.
  let giveUp: ReturnType<typeof setTimeout> | undefined
  const f = await Promise.race([
    renderFrame(),
    new Promise<never>((_, reject) => {
      giveUp = setTimeout(() => reject(new Error('diagram preview renderer did not start')), RENDER_TIMEOUT_MS)
    }),
  ]).finally(() => clearTimeout(giveUp))
  const id = `r${++serial}`
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('diagram preview timed out'))
    }, RENDER_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    f.contentWindow?.postMessage(JSON.stringify({ id, xml, theme, maxWidth: bounds.maxWidth, maxHeight: bounds.maxHeight, padding: bounds.padding }), DRAWIO_ORIGIN)
  })
}
