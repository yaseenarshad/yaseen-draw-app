/**
 * THE IMAGE LIGHTBOX (YAZ-1656 / YAZ-1665): double-click a rendered image → it opens full-window →
 * Esc, backdrop click or ✕ closes. Nothing to save: this is a viewer, never an editor.
 *
 * A MODAL BESIDE THE EDITOR, the `DrawingModal` precedent (YAZ-879): `Editor`'s `CrepeHost` holds
 * `openImage`, the node view's double-click sets it (`image.onOpenImage`), and this renders over
 * the window. It is given the RESOLVED src — the same URL the inline `<img>` loaded — so what the
 * lightbox shows is exactly what the note showed, cache and all.
 *
 * GALLERY (YAZ-1709 follow-on): the caller hands over EVERY image on the page in document order
 * plus the index of the one double-clicked; this owns only the cursor. The list is the node
 * view's to build (it reads the document at open time, so it is always current) and this never
 * asks for more — no registry, no subscription, a plain array. ← / → and the bottom arrows move
 * the cursor; the counter between them says "n / m". NO wrap-around: at the first image ← does
 * nothing and at the last → does nothing, so the ends are predictable and a held arrow key stops
 * instead of cycling. A single image is the old lightbox exactly — no bar, no counter.
 *
 * ⚡ KEYS ARE THE OVERLAY'S, NEVER `window`'s (the YAZ-888 lesson, as DrawingModal states it):
 * React flushes mount effects inside the dispatch of the event that opened this, so a `window`
 * listener would hear the very double-click that opened it. Bound to the overlay, it only hears
 * what happens inside itself — and the overlay takes focus on mount so Esc lands at once.
 *
 * FOCUS COMES BACK. The double-click that opens this happens with the editor focused; the overlay
 * takes that focus, and on unmount hands it back to whatever had it — so Esc returns the user to
 * their caret instead of dropping focus on `<body>`, where the next keystroke goes nowhere.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { GalleryImage } from './imageOptions'
import './imageModal.css'

interface ImageModalProps {
  /** Every image on the page in document order — RESOLVED srcs (what the inline `<img>` loaded) and alt TEXT halves. */
  images: GalleryImage[]
  /** Which of `images` was double-clicked: the starting cursor. */
  index: number
  /** Close: the host drops the modal (it is unmounted, never hidden). */
  onClose: () => void
}

/** Inside the figure, the nav and its buttons: a mousedown there is never a backdrop click. */
const stopMouseDown = (e: ReactMouseEvent): void => e.stopPropagation()

export function ImageModal({ images, index, onClose }: ImageModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(index)
  const count = images.length
  const image = images[current]
  const alt = image.alt
  const atFirst = current <= 0
  const atLast = current >= count - 1

  // Focus lands here on mount so Esc works without a click first; it goes back where it came from on unmount.
  useEffect(() => {
    const opener = document.activeElement
    overlayRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  // Clamped, never wrapped: the ends are where the cursor stops.
  const prev = (): void => setCurrent((i) => Math.max(0, i - 1))
  const next = (): void => setCurrent((i) => Math.min(count - 1, i + 1))

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'ArrowRight') next()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div ref={overlayRef} className="image-modal-overlay" tabIndex={-1} onMouseDown={onClose} onKeyDown={onKeyDown}>
      <figure className="image-modal" role="dialog" aria-modal="true" aria-label={alt || 'Image'} onMouseDown={stopMouseDown}>
        <img className="image-modal__img" src={image.src} alt={alt} />
        {alt !== '' && <figcaption className="image-modal__caption">{alt}</figcaption>}
      </figure>
      <button type="button" className="image-modal__close" aria-label="Close image" onClick={onClose} onMouseDown={stopMouseDown}>
        ✕
      </button>
      {count > 1 && (
        <div className="image-modal__nav" onMouseDown={stopMouseDown}>
          <button type="button" className="image-modal__arrow" aria-label="Previous image" disabled={atFirst} onClick={prev}>
            ‹
          </button>
          <span className="image-modal__count">
            {current + 1} / {count}
          </span>
          <button type="button" className="image-modal__arrow" aria-label="Next image" disabled={atLast} onClick={next}>
            ›
          </button>
        </div>
      )}
    </div>
  )
}
