/**
 * The image lightbox (YAZ-1656 / YAZ-1665), DrawingModal.test's shape: React in jsdom, nothing
 * mocked — a viewer has no engine and no write. Pinned here: the resolved src and the caption,
 * Esc / backdrop / ✕ as ONE close gesture, a click inside the figure NOT closing, the key scope
 * (⚡ YAZ-888: an Escape outside the overlay is nobody's), and focus coming BACK to the editor on
 * unmount. The GALLERY: with several images the bottom bar shows "n / m", ← / → and the arrows
 * move the cursor and swap the src, the ends CLAMP (no wrap, the edge button disabled), the bar
 * never closes the overlay, and a single image has no bar at all. The double-click that opens it,
 * and the list it hands over, belong to the node view (`imageView.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ImageModal } from './ImageModal'
import type { GalleryImage } from './imageOptions'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const SRC = 'app://vault/%2Fv/images/a.png?from=notes'
const SRC_B = 'app://vault/%2Fv/images/b.png?from=notes'
const SRC_C = 'app://vault/%2Fv/images/c.png?from=notes'
/** Three images, as the node view hands them over: resolved srcs and alt TEXT halves. */
const THREE = [
  { src: SRC, alt: 'first' },
  { src: SRC_B, alt: 'second' },
  { src: SRC_C, alt: 'third' },
]

let root: Root | null = null
let container: HTMLElement | null = null
/** Stands in for the ProseMirror element: focused when the double-click opens the modal. */
let editor: HTMLElement | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  editor = document.createElement('div')
  editor.tabIndex = 0
  document.body.appendChild(editor)
  editor.focus()
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  editor?.remove()
  editor = null
})

/** Mounts the lightbox; by default ONE image (the pre-gallery shape), or a gallery starting at `index`. */
function open(alt = 'alt', images: GalleryImage[] = [{ src: SRC, alt }], index = 0): { overlay: HTMLElement; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  act(() => root?.render(<ImageModal images={images} index={index} onClose={onClose} />))
  const overlay = container?.querySelector<HTMLElement>('.image-modal-overlay')
  if (overlay === null || overlay === undefined) throw new Error('missing .image-modal-overlay')
  return { overlay, onClose }
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
const keyOn = (el: Node, key: string): void => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}
const shownSrc = (): string | null | undefined => container?.querySelector<HTMLImageElement>('.image-modal__img')?.getAttribute('src')
const countText = (): string | null | undefined => container?.querySelector('.image-modal__count')?.textContent
const arrow = (label: 'Previous image' | 'Next image'): HTMLButtonElement | null | undefined => container?.querySelector<HTMLButtonElement>(`.image-modal__nav button[aria-label="${label}"]`)

describe('what it shows', () => {
  it('the RESOLVED src, the alt as caption and label, and focus on the overlay so Esc lands', () => {
    const { overlay } = open('A caption')
    expect(container?.querySelector<HTMLImageElement>('.image-modal__img')?.getAttribute('src')).toBe(SRC)
    expect(container?.querySelector('.image-modal__caption')?.textContent).toBe('A caption')
    expect(container?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('A caption')
    expect(document.activeElement).toBe(overlay)
  })

  it('an empty alt has no caption and a generic label', () => {
    open('')
    expect(container?.querySelector('.image-modal__caption')).toBeNull()
    expect(container?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Image')
  })
})

describe('closing', () => {
  it('Esc on the overlay closes', () => {
    const { overlay, onClose } = open()
    escOn(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a mousedown on the backdrop closes; one inside the figure does not', () => {
    const { overlay, onClose } = open()
    mousedownOn(overlay.querySelector('.image-modal__img') as Node)
    expect(onClose).not.toHaveBeenCalled()
    mousedownOn(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('✕ is the same gesture', () => {
    const { onClose } = open()
    act(() => container?.querySelector<HTMLButtonElement>('.image-modal__close')?.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an Escape dispatched OUTSIDE the overlay does nothing (⚡ the YAZ-888 lesson)', () => {
    const { onClose } = open()
    escOn(editor as Node)
    escOn(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('focus', () => {
  it('returns to the element that had it — the editor — when the modal unmounts', () => {
    const { overlay, onClose } = open()
    expect(document.activeElement).toBe(overlay)
    escOn(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
    // The host drops the modal on close; the caret's element gets its focus back.
    act(() => root?.render(null))
    expect(document.activeElement).toBe(editor)
  })
})

describe('gallery', () => {
  it('three images: the bar shows "1 / 3", the first image, and only the previous arrow is disabled', () => {
    open('first', THREE)
    expect(countText()).toBe('1 / 3')
    expect(shownSrc()).toBe(SRC)
    expect(arrow('Previous image')?.disabled).toBe(true)
    expect(arrow('Next image')?.disabled).toBe(false)
  })

  it('opens at the clicked index, not the first', () => {
    open('second', THREE, 1)
    expect(countText()).toBe('2 / 3')
    expect(shownSrc()).toBe(SRC_B)
    expect(container?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('second')
  })

  it('→ moves to "2 / 3" and swaps the src, caption and label', () => {
    const { overlay } = open('first', THREE)
    keyOn(overlay, 'ArrowRight')
    expect(countText()).toBe('2 / 3')
    expect(shownSrc()).toBe(SRC_B)
    expect(container?.querySelector('.image-modal__caption')?.textContent).toBe('second')
    expect(container?.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('second')
  })

  it('← at the first image is a no-op (no wrap to the end)', () => {
    const { overlay, onClose } = open('first', THREE)
    keyOn(overlay, 'ArrowLeft')
    expect(countText()).toBe('1 / 3')
    expect(shownSrc()).toBe(SRC)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('→ at the last image is a no-op and the next arrow is disabled (no wrap to the start)', () => {
    const { overlay } = open('third', THREE, 2)
    expect(arrow('Next image')?.disabled).toBe(true)
    keyOn(overlay, 'ArrowRight')
    expect(countText()).toBe('3 / 3')
    expect(shownSrc()).toBe(SRC_C)
  })

  it('the arrow buttons page, and clicking them never closes the overlay', () => {
    const { onClose } = open('first', THREE)
    const nextBtn = arrow('Next image') as HTMLButtonElement
    mousedownOn(nextBtn)
    act(() => nextBtn.click())
    expect(countText()).toBe('2 / 3')
    expect(shownSrc()).toBe(SRC_B)
    const prevBtn = arrow('Previous image') as HTMLButtonElement
    mousedownOn(prevBtn)
    act(() => prevBtn.click())
    expect(countText()).toBe('1 / 3')
    expect(shownSrc()).toBe(SRC)
    // The bar itself, between the buttons, is not the backdrop either.
    mousedownOn(container?.querySelector('.image-modal__nav') as Node)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a single image shows no bar and no counter', () => {
    open('alone')
    expect(container?.querySelector('.image-modal__nav')).toBeNull()
    expect(container?.querySelector('.image-modal__count')).toBeNull()
  })

  it('Escape still closes mid-gallery and focus returns to the editor', () => {
    const { overlay, onClose } = open('first', THREE)
    keyOn(overlay, 'ArrowRight')
    expect(countText()).toBe('2 / 3')
    escOn(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => root?.render(null))
    expect(document.activeElement).toBe(editor)
  })
})
