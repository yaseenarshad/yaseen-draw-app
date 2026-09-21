/**
 * THE DRAWING MODAL (YAZ-879, fourth build unit of the Excalidraw embed YAZ-852): click a preview
 * → the scene opens full-size → edit → Save writes the sidecar back → every preview of that target
 * re-renders.
 *
 * 🔒 A MODAL over the window (YAZ-879), and the LAST survivor of the embed: 2B removed the
 * previews that used to open it, and 2D replaces it with the document canvas itself. It is kept
 * meanwhile because it already holds the chrome the canvas needs — dirty tracking, the save
 * dance, the Esc/click-away rules — and the engine seam below it is what 2D builds on.
 *
 * 🔒 CHROME ONLY. Everything about the ENGINE — the canvas, what "changed" means, how a scene
 * serializes — lives behind `ExcalidrawSurface`, and nothing in this file imports the package or
 * anything that does. YAZ-868 swaps in yaseendraw by rewriting that one file; this one should not
 * notice. `DrawingModal.test.tsx` pins the boundary.
 *
 * ⚡ KEYS ARE THE OVERLAY'S, NEVER `window`'s (the YAZ-888 lesson, learned by `ConfirmRename` and
 * paid for in e2e): React flushes a component's mount effects INSIDE the dispatch of the event
 * that opened it, so a `window` listener installed on mount hears that very keystroke or click.
 * Opened on a CLICK, a `window` mousedown listener would have closed it in the same tick. Bound to the overlay, it only ever hears what happens inside itself — and the overlay
 * takes focus on mount so Esc reaches it before the canvas exists.
 *
 * DIRTY: the surface reports a cheap version per change; the FIRST one is the baseline, so a
 * drawing opened and not touched is clean and Save is DISABLED. Esc / click-away / ✕ close a clean
 * modal outright; a dirty one raises the inline confirm strip below the title bar — deliberately
 * not a second sheet stacked over this one, which is a modal over a modal for a one-line question.
 *
 * FAILURES are inline and never a dialog: a sidecar that is missing, unreadable or not a scene
 * opens as the error state (message + close, nothing to save), and a failed write leaves the modal
 * open with its error line and the canvas untouched — a save that failed must not eat the drawing.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { MutableDrawingFeed } from './drawingFeed'
import { openDrawing, type LoadedDrawing } from './drawingScene'
import { ExcalidrawSurface, type DrawingSnapshot } from './ExcalidrawSurface'
import { saveDrawing, saveErrorMessage } from './saveDrawing'
import './drawingModal.css'

/** What a sidecar that will not open says — the modal's twin of the preview's broken chip. */
export const BROKEN_DRAWING_MESSAGE = "This drawing can't be opened: its file is missing or is not a scene."

/** The inline confirm's LOCKED copy (an in-modal strip, not a sheet). */
export const DISCARD_PROMPT = 'Discard drawing changes?'

interface DrawingModalProps {
  /** Vault root; with the target it is all `openDrawing` needs. */
  root: string
  /** The raw target, exactly as the caller spells it — the resolution rule is the pipe's. */
  target: string
  /** The app's resolved appearance, handed straight to the surface. */
  theme: 'light' | 'dark'
  /** Poked after a successful save so every preview of this target re-reads (YAZ-878's feed). */
  feed?: MutableDrawingFeed
  /** Close: the host drops the modal (it is unmounted, never hidden). */
  onClose: () => void
}

export function DrawingModal({ root, target, theme, feed, onClose }: DrawingModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<LoadedDrawing | null>(null)
  /**
   * The latest snapshot lives in a REF and only its VERSION is state: the engine reports a change
   * per pointer move, and re-rendering this component that often would re-render the canvas with
   * it. React bails out on an unchanged number, so a drag costs one render, not hundreds.
   */
  const snapshot = useRef<DrawingSnapshot | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  /** The version the drawing opened on; set once, by the surface's mount snapshot. */
  const baseline = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let live = true
    void openDrawing(root, target).then(
      (drawing) => {
        if (live) setLoaded(drawing)
      },
      // Missing, unreadable, not a scene: ONE state, exactly like the preview's chip.
      () => {
        if (live) setError(BROKEN_DRAWING_MESSAGE)
      },
    )
    return () => {
      live = false
    }
  }, [root, target])

  // Focus lands here on mount so Esc works before the canvas exists (and stays inside afterwards).
  useEffect(() => overlayRef.current?.focus(), [])

  const onSnapshot = useCallback((next: DrawingSnapshot) => {
    snapshot.current = next
    baseline.current ??= next.version
    setVersion(next.version)
  }, [])

  const dirty = version !== null && baseline.current !== null && version !== baseline.current

  /** Esc, click-away and ✕ are ONE gesture: leave, asking first only when there is something to lose. */
  const requestClose = (): void => {
    if (dirty) setConfirming(true)
    else onClose()
  }

  const save = async (): Promise<void> => {
    const current = snapshot.current
    if (loaded === null || current === null || !dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      await saveDrawing({ root, target, path: loaded.path, content: current.serialize(), expectedMtime: loaded.mtime })
      // The previews re-read from disk on this; the modal's own job is over.
      feed?.poke(target)
      onClose()
    } catch (err) {
      setError(saveErrorMessage(err))
      setSaving(false)
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    // While the strip is up, Esc answers IT — a second Esc must not skip the question.
    if (confirming) setConfirming(false)
    else requestClose()
  }

  return (
    <div ref={overlayRef} className="drawing-modal-overlay" tabIndex={-1} onMouseDown={requestClose} onKeyDown={onKeyDown}>
      <div className="drawing-modal" role="dialog" aria-modal="true" aria-label={`Drawing ${target}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="drawing-modal__bar">
          <span className="drawing-modal__title" title={target}>
            {target}
          </span>
          <button type="button" className="drawing-modal__btn" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="drawing-modal__btn drawing-modal__close" aria-label="Close drawing" onClick={requestClose}>
            ✕
          </button>
        </header>
        {confirming && (
          <div className="drawing-modal__confirm" role="alert">
            <span>{DISCARD_PROMPT}</span>
            <button type="button" className="drawing-modal__btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="drawing-modal__btn" onClick={onClose}>
              Discard
            </button>
          </div>
        )}
        {error !== null && (
          <p className="drawing-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="drawing-modal__canvas">
          {loaded !== null && <ExcalidrawSurface scene={loaded.scene} theme={theme} onSnapshot={onSnapshot} onFailed={setError} />}
        </div>
      </div>
    </div>
  )
}
