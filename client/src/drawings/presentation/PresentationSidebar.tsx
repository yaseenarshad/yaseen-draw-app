/**
 * THE PRESENT TAB (⚡ D8 amended, YAZ-1820): the web app's
 * `excalidraw-app/presentation/PresentationSidebar.tsx`, ported into the canvas panel's third tab.
 * Frames are slides; the list is their order; dragging a row, or Alt+↑ / Alt+↓, writes that order
 * back into the FILE.
 *
 * 🔒 NOTHING ABOUT A DECK IS STORED IN THE SHELL. The order is `frame.customData.presentationOrder`
 * and the label is the frame's own `name`, both written with `updateScene` — so a board carries its
 * deck wherever it goes and `SettingsState` never learns a thing about it. That is the whole
 * reason this tab has no state of its own beyond what is being dragged or renamed.
 *
 * WHAT THE PORT CHANGED, AND WHY
 * - **`canEdit` is gone.** It was the cloud viewer role; a drawing in this app is always editable
 *   (the parity checklist drops `viewModeEnabled` for the same reason), so every row is.
 * - **The element package arrives lazily.** `newElementWith` lives in `@excalidraw/element`, the
 *   SECOND lazy package (YAZ-1818), so the list renders and the camera flies while it is still on
 *   its way; only a reorder or a rename waits for it.
 * - **Play is the surface's, not the panel's.** `onStartPresentation` goes up to
 *   `ExcalidrawSurface`, which mounts the player as a sibling of `<Excalidraw>` — because closing
 *   the panel must not end the presentation, and this tab is unmounted the moment it does.
 *
 * PORTED VERBATIM: the slot-claiming order rules (`slides.ts`), the pointer drag with its
 * edge auto-scroll and Escape abort, the insertion-line rule (before when moving up, after when
 * moving down), the uncontrolled rename field, `aria-live` announcements, and `setViewport` on a
 * row click.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { loadExcalidrawElement } from '../engine'
import type { ExcalidrawImperativeApi, ExcalidrawModule } from '../engine'
import { dragHandleIcon, moveSlideDownIcon, moveSlideUpIcon, renameIcon } from './presentationIcons'
import { getOrderedPresentationFrames, renamePresentationFrame, reorderPresentationFrames, type OrderedPresentationFrame, type SlideElementApi } from './slides'
import './presentation.css'

/** How close to a list edge a drag has to get before the list scrolls itself. */
const AUTO_SCROLL_MARGIN = 24
const AUTO_SCROLL_SPEED = 8

/** What the tab says on a board with no frames on it. */
export const NO_FRAMES_TITLE = 'Presentation'
export const NO_FRAMES_BODY = 'Frames become slides. Create a frame to start your sequence.'

/** The engine value a write needs: its own "this update is a history entry" marker. */
export type PresentationEngine = Pick<ExcalidrawModule, 'CaptureUpdateAction'>
/** The slice of the engine's imperative handle this tab uses. */
export type PresentationSidebarTarget = Pick<ExcalidrawImperativeApi, 'getAppState' | 'getSceneElements' | 'updateScene' | 'setViewport' | 'setActiveTool' | 'onChange'>

const slideName = (name: string | null, order: number) => name?.trim() || `Slide ${order}`

/** The live drag: which slide is held, where it started, where it would land. */
interface SlideDrag {
  frameId: string
  fromIndex: number
  toIndex: number
}

/**
 * Inline rename field. Uncontrolled on purpose: the scene is the source of truth for the name, and
 * this only owns the draft while it is open.
 */
function SlideNameInput({ label, initialName, onCommit, onCancel }: { label: string; initialName: string; onCommit: (name: string) => void; onCancel: () => void }) {
  return (
    // Autofocused because the rename button is the only way here: the field IS the gesture.
    <input
      className="presentation-sidebar__rename"
      aria-label={label}
      defaultValue={initialName}
      autoFocus
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(event.currentTarget.value)
        else if (event.key === 'Escape') onCancel()
        // Row-level shortcuts (Alt+↑/↓) must not fire while typing a name.
        event.stopPropagation()
      }}
      onBlur={(event) => onCommit(event.currentTarget.value)}
    />
  )
}

export interface PresentationSidebarProps {
  engine: PresentationEngine
  /** The engine's imperative handle, or null while it is still mounting. */
  excalidrawAPI: PresentationSidebarTarget | null
  /** Play: the SURFACE mounts the player, so it outlives this panel being closed. */
  onStartPresentation: (initialFrameId: string | null) => void
}

export function PresentationSidebar({ engine, excalidrawAPI, onStartPresentation }: PresentationSidebarProps) {
  const [elements, setElements] = useState<readonly unknown[]>(() => excalidrawAPI?.getSceneElements() ?? [])
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null)
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null)
  const [drag, setDrag] = useState<SlideDrag | null>(null)
  const [liveMessage, setLiveMessage] = useState('')
  const [element, setElement] = useState<SlideElementApi | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const pointerYRef = useRef(0)
  const slides = useMemo(() => getOrderedPresentationFrames(elements), [elements])

  // The element package, lazily (the Components tab's precedent): only a WRITE needs it.
  useEffect(() => {
    let live = true
    void loadExcalidrawElement().then(
      (mod) => live && setElement(mod as SlideElementApi),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  // The scene is the truth: every change re-derives the deck, and a selected frame is the row the
  // panel highlights — the web app's own two-way link between the canvas and this list.
  useEffect(() => {
    if (excalidrawAPI === null) return
    setElements(excalidrawAPI.getSceneElements())
    return excalidrawAPI.onChange((nextElements, appState) => {
      setElements(nextElements)
      const selectedFrame = (nextElements as readonly unknown[]).find((el) => {
        const record = el as { type?: string; isDeleted?: boolean; id?: string }
        return record.type === 'frame' && record.isDeleted !== true && typeof record.id === 'string' && appState.selectedElementIds[record.id] === true
      }) as { id?: string } | undefined
      if (selectedFrame?.id !== undefined) {
        setActiveFrameId(selectedFrame.id)
        return
      }
      setActiveFrameId((current) => (current !== null && (nextElements as readonly unknown[]).some((el) => (el as { id?: string; isDeleted?: boolean }).id === current && (el as { isDeleted?: boolean }).isDeleted !== true) ? current : null))
    })
  }, [excalidrawAPI])

  const persistOrder = useCallback(
    (orderedFrameIds: readonly string[], announcement: string) => {
      if (excalidrawAPI === null || element === null) return
      const nextElements = reorderPresentationFrames(element, excalidrawAPI.getSceneElements(), orderedFrameIds)
      excalidrawAPI.updateScene({ elements: nextElements as never, captureUpdate: engine.CaptureUpdateAction.IMMEDIATELY })
      setLiveMessage(announcement)
    },
    [element, engine, excalidrawAPI],
  )

  const moveSlide = useCallback(
    (frameId: string, direction: -1 | 1) => {
      const ids = slides.map(({ frame }) => frame.id)
      const index = ids.indexOf(frameId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return
      ;[ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]]
      persistOrder(ids, `Slide moved to position ${nextIndex + 1}`)
    },
    [persistOrder, slides],
  )

  const commitRename = useCallback(
    (frameId: string, order: number, nextName: string) => {
      setRenamingFrameId(null)
      const name = nextName.trim()
      if (name === '' || excalidrawAPI === null || element === null) return
      excalidrawAPI.updateScene({
        elements: renamePresentationFrame(element, excalidrawAPI.getSceneElements(), frameId, name) as never,
        captureUpdate: engine.CaptureUpdateAction.IMMEDIATELY,
      })
      setLiveMessage(`Slide ${order} renamed to ${name}`)
    },
    [element, engine, excalidrawAPI],
  )

  /** Where the held slide would land if the pointer were released at `clientY`. */
  const updateDropIndex = useCallback(
    (clientY: number) => {
      const landing = slides.findIndex(({ frame }) => {
        const rect = rowRefs.current.get(frame.id)?.getBoundingClientRect()
        return rect ? clientY < rect.top + rect.height / 2 : false
      })
      const toIndex = landing < 0 ? slides.length - 1 : landing
      setDrag((current) => (!current || current.toIndex === toIndex ? current : { ...current, toIndex }))
    },
    [slides],
  )

  const draggedFrameId = drag?.frameId ?? null

  // Everything that has to keep running for as long as a slide is held: the edge auto-scroll, the
  // Escape abort, and dropping the drag if the slide disappears from the scene under it.
  useEffect(() => {
    if (draggedFrameId === null) return
    if (!slides.some(({ frame }) => frame.id === draggedFrameId)) {
      setDrag(null)
      return
    }
    const abortOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrag(null)
    }
    window.addEventListener('keydown', abortOnEscape)

    let frameRequest = requestAnimationFrame(function scrollNearEdges() {
      const list = listRef.current
      if (list !== null) {
        const { top, bottom } = list.getBoundingClientRect()
        const y = pointerYRef.current
        const speed = y < top + AUTO_SCROLL_MARGIN ? -AUTO_SCROLL_SPEED : y > bottom - AUTO_SCROLL_MARGIN ? AUTO_SCROLL_SPEED : 0
        if (speed !== 0) {
          list.scrollTop += speed
          updateDropIndex(y)
        }
      }
      frameRequest = requestAnimationFrame(scrollNearEdges)
    })

    return () => {
      window.removeEventListener('keydown', abortOnEscape)
      cancelAnimationFrame(frameRequest)
    }
  }, [draggedFrameId, slides, updateDropIndex])

  const startDrag = (event: ReactPointerEvent<HTMLElement>, frameId: string, index: number) => {
    // Right/middle click is not a drag.
    if (event.pointerType === 'mouse' && event.button > 0) return
    // Keep the browser from starting a text selection or a scroll gesture on top of the drag.
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointerYRef.current = event.clientY
    setDrag({ frameId, fromIndex: index, toIndex: index })
  }

  const trackDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag === null) return
    pointerYRef.current = event.clientY
    updateDropIndex(event.clientY)
  }

  const dropSlide = () => {
    if (drag !== null && drag.toIndex !== drag.fromIndex) {
      const ids = slides.map(({ frame }) => frame.id)
      const [movedId] = ids.splice(drag.fromIndex, 1)
      ids.splice(drag.toIndex, 0, movedId)
      persistOrder(ids, `Slide moved to position ${drag.toIndex + 1}`)
    }
    setDrag(null)
  }

  const focusFrame = (frameId: string) => {
    setActiveFrameId(frameId)
    excalidrawAPI?.setViewport({ target: frameId, fit: 'contain', animation: true, offsets: { ui: true } })
  }

  if (excalidrawAPI === null) return <div className="presentation-sidebar presentation-sidebar--empty">The canvas is still loading.</div>

  if (slides.length === 0) {
    return (
      <section className="presentation-sidebar presentation-sidebar--empty">
        <div>
          <h2>{NO_FRAMES_TITLE}</h2>
          <p>{NO_FRAMES_BODY}</p>
        </div>
        <button type="button" onClick={() => excalidrawAPI.setActiveTool({ type: 'frame' })}>
          Create a frame
        </button>
      </section>
    )
  }

  return (
    <section className="presentation-sidebar" aria-labelledby="presentation-title">
      <header className="presentation-sidebar__header">
        <h2 id="presentation-title">Presentation</h2>
        <p>
          {slides.length} {slides.length === 1 ? 'slide' : 'slides'}
        </p>
      </header>
      <ol className="presentation-sidebar__slides" ref={listRef}>
        {slides.map(({ frame, order }: OrderedPresentationFrame, index) => {
          const name = slideName(frame.name, order)
          // The insertion line sits on the edge of the row the held slide would take over — above
          // it when moving up, below it when moving down.
          const dropEdge = drag !== null && drag.toIndex === index && drag.toIndex !== drag.fromIndex ? (drag.toIndex < drag.fromIndex ? 'before' : 'after') : null
          const className = [
            'presentation-sidebar__slide',
            activeFrameId === frame.id ? 'presentation-sidebar__slide--active' : '',
            drag?.frameId === frame.id ? 'presentation-sidebar__slide--dragging' : '',
            dropEdge === 'before' ? 'presentation-sidebar__slide--drop-before' : '',
            dropEdge === 'after' ? 'presentation-sidebar__slide--drop-after' : '',
          ]
            .filter((c) => c !== '')
            .join(' ')
          return (
            <li
              key={frame.id}
              data-testid={`presentation-slide-${frame.id}`}
              ref={(row) => {
                if (row) rowRefs.current.set(frame.id, row)
                else rowRefs.current.delete(frame.id)
              }}
              className={className}
              onKeyDown={(event) => {
                if (!event.altKey) return
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  moveSlide(frame.id, event.key === 'ArrowUp' ? -1 : 1)
                }
              }}
            >
              {renamingFrameId === frame.id ? (
                <SlideNameInput label={`Slide ${order} name`} initialName={name} onCommit={(nextName) => commitRename(frame.id, order, nextName)} onCancel={() => setRenamingFrameId(null)} />
              ) : (
                <>
                  <button
                    type="button"
                    className="presentation-sidebar__handle"
                    aria-label={`Reorder slide ${order}`}
                    title="Drag to reorder, or Alt+↑ / Alt+↓"
                    onPointerDown={(event) => startDrag(event, frame.id, index)}
                    onPointerMove={trackDrag}
                    onPointerUp={dropSlide}
                    onPointerCancel={() => setDrag(null)}
                  >
                    {dragHandleIcon}
                  </button>
                  <button type="button" className="presentation-sidebar__open" aria-label={`Go to slide ${order}`} aria-current={activeFrameId === frame.id ? 'true' : undefined} onClick={() => focusFrame(frame.id)}>
                    <span className="presentation-sidebar__number">{order}</span>
                    <span className="presentation-sidebar__name" title={name}>
                      {name}
                    </span>
                  </button>
                  <div className="presentation-sidebar__actions">
                    <button type="button" aria-label={`Rename slide ${order}`} onClick={() => setRenamingFrameId(frame.id)}>
                      {renameIcon}
                    </button>
                    <button type="button" aria-label={`Move slide ${order} up`} disabled={index === 0} onClick={() => moveSlide(frame.id, -1)}>
                      {moveSlideUpIcon}
                    </button>
                    <button type="button" aria-label={`Move slide ${order} down`} disabled={index === slides.length - 1} onClick={() => moveSlide(frame.id, 1)}>
                      {moveSlideDownIcon}
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ol>
      <footer className="presentation-sidebar__footer">
        <button type="button" onClick={() => onStartPresentation(activeFrameId)}>
          <span aria-hidden="true">▶</span> Start presentation
        </button>
      </footer>
      <p className="presentation-sidebar__live" aria-live="polite">
        {liveMessage}
      </p>
    </section>
  )
}
