/**
 * The image node view (YAZ-1656 — YAZ-1659 render, YAZ-1664 resize): real editor (`createCrepe`),
 * the commonmark `image` node renders through our view. Pinned here: the resolved vault URL and
 * `|width` on the `<img>`, the markdown round trip staying BYTE-IDENTICAL (no schema or serializer
 * change), the broken chip on load error, `NodeSelection` → `is-selected`, the double-click
 * callback handing over EVERY image on the page in document order plus the clicked one's index,
 * resolved (and its absence on a broken image), the mount WITHOUT `image` options still rendering
 * a stock `<img>`; the resize gesture — eight width-only handles, the clamp, ONE commit per drag,
 * a plain click committing nothing, Escape cancelling, `blur` ending, read-only refusing; and
 * `update()` patching the live `<img>` for alt/title and rebuilding only for a new src.
 *
 * jsdom never loads images, so `load` / `error` are fired by hand where a state matters.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import type { ImageOptions } from './imageOptions'
import { HANDLE_DIRECTIONS, IMAGE_BROKEN_CLASS, IMAGE_FOLD_CLASS, IMAGE_HANDLE_CLASS, IMAGE_SELECTED_CLASS, IMAGE_VIEW_CLASS, MIN_WIDTH } from './imageView'

const ROOT = '/v'
const NOTE = '/v/notes/a.md'
const VAULT_URL = (ref: string) => `app://vault/${encodeURIComponent(ROOT)}/${ref}?from=notes`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** `image: null` mounts WITHOUT the option (a bare `undefined` would take the default). */
async function mount(markdown: string, image: ImageOptions | null = { root: ROOT, notePath: NOTE }) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...(image === null ? {} : { image }) })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { crepe, root, view }
}

const viewEl = (root: HTMLElement) => root.querySelector<HTMLElement>(`.${IMAGE_VIEW_CLASS}`)
const imgOf = (root: HTMLElement) => root.querySelector<HTMLImageElement>(`.${IMAGE_VIEW_CLASS} img`)

/** The document position of the first image node. */
function imagePos(view: EditorView): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'image') found = pos
    return found === -1
  })
  return found
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

describe('rendering', () => {
  it('mounts an <img> with the vault URL, the alt text and the |width as the `--image-width` property (never `style.width`, so a stylesheet state — the folded chip, YAZ-1709 — can win)', async () => {
    const { root } = await mount('![alt|300](images/a.png)\n')
    const wrapper = viewEl(root)
    expect(wrapper).not.toBeNull()
    expect(wrapper?.getAttribute('contenteditable')).toBe('false')
    expect(wrapper?.classList.contains(`${IMAGE_VIEW_CLASS}--loading`)).toBe(true)
    const img = imgOf(root)
    expect(img?.getAttribute('src')).toBe(VAULT_URL('images/a.png'))
    expect(img?.alt).toBe('alt')
    expect(img?.style.getPropertyValue('--image-width')).toBe('300px')
    expect(img?.style.width).toBe('')
    expect(root.querySelector(`.${IMAGE_HANDLE_CLASS}`)).not.toBeNull()
  })

  it('no width → no `--image-width` property at all (the stylesheet falls back to `auto`); a schemed src passes through', async () => {
    const { root } = await mount('![alt](https://x/y.png)\n')
    const img = imgOf(root)
    expect(img?.getAttribute('src')).toBe('https://x/y.png')
    expect(img?.style.getPropertyValue('--image-width')).toBe('')
  })

  it('the corner fold button is rendered dumb: labelled, out of the tab order', async () => {
    const { root } = await mount('![Shot|300](images/a.png)\n')
    const button = viewEl(root)?.querySelector<HTMLButtonElement>(`.${IMAGE_FOLD_CLASS}`)
    expect(button?.getAttribute('aria-label')).toBe('Collapse image')
    expect(button?.tabIndex).toBe(-1)
  })

  it('round trip is byte-identical: no schema, no serializer change', async () => {
    const { crepe } = await mount('![alt|300](images/a.png)\n')
    expect(getMarkdownForSave(crepe)).toBe('![alt|300](images/a.png)\n')
  })

  it('load → ready; error → the broken chip naming the src as written', async () => {
    const ready = await mount('![a](images/a.png)\n')
    imgOf(ready.root)?.dispatchEvent(new Event('load'))
    expect(viewEl(ready.root)?.classList.contains(`${IMAGE_VIEW_CLASS}--ready`)).toBe(true)

    const broken = await mount('![a](missing/x.png)\n')
    imgOf(broken.root)?.dispatchEvent(new Event('error'))
    const wrapper = viewEl(broken.root)
    expect(wrapper?.classList.contains(`${IMAGE_VIEW_CLASS}--broken`)).toBe(true)
    expect(wrapper?.querySelector(`.${IMAGE_BROKEN_CLASS}`)?.textContent).toBe('Broken image: missing/x.png')
    expect(imgOf(broken.root)).toBeNull()
    expect(broken.root.querySelector(`.${IMAGE_HANDLE_CLASS}`)).toBeNull()
    // Still those bytes on disk — the chip is the line the user fixes by hand.
    expect(getMarkdownForSave(broken.crepe)).toBe('![a](missing/x.png)\n')
  })

  it('without `image` options the stock <img> renders (no node view registered)', async () => {
    const { root } = await mount('![alt](images/a.png)\n', null)
    expect(viewEl(root)).toBeNull()
    expect(root.querySelector('img')?.getAttribute('src')).toBe('images/a.png')
  })
})

describe('selection and interaction', () => {
  it('NodeSelection toggles is-selected', async () => {
    const { root, view } = await mount('![alt](images/a.png)\n')
    const pos = imagePos(view)
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
    expect(viewEl(root)?.classList.contains(IMAGE_SELECTED_CLASS)).toBe(true)
    // Move the caret off the node: deselect.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(viewEl(root)?.classList.contains(IMAGE_SELECTED_CLASS)).toBe(false)
  })

  it('double-click on the image calls onOpenImage with the resolved src and the alt TEXT', async () => {
    const onOpenImage = vi.fn()
    const { root } = await mount('![alt|300](images/a.png)\n', { root: ROOT, notePath: NOTE, onOpenImage })
    imgOf(root)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onOpenImage).toHaveBeenCalledWith({ images: [{ src: VAULT_URL('images/a.png'), alt: 'alt' }], index: 0 })
  })

  it('double-click hands over EVERY image on the page in document order, and the index of the one clicked', async () => {
    const onOpenImage = vi.fn()
    const { root } = await mount('![first|300](images/a.png)\n\nsome text\n\n![second](images/b.png)\n', { root: ROOT, notePath: NOTE, onOpenImage })
    const imgs = root.querySelectorAll<HTMLImageElement>(`.${IMAGE_VIEW_CLASS} img`)
    expect(imgs).toHaveLength(2)
    imgs[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onOpenImage).toHaveBeenCalledTimes(1)
    expect(onOpenImage).toHaveBeenCalledWith({
      images: [
        { src: VAULT_URL('images/a.png'), alt: 'first' },
        { src: VAULT_URL('images/b.png'), alt: 'second' },
      ],
      index: 1,
    })
  })

  it('dragging the handle writes alt|width on mouseup — ONE document change, markdown updated', async () => {
    const { crepe, root, view } = await mount('![alt](images/a.png)\n')
    const img = imgOf(root) as HTMLImageElement
    const handle = root.querySelector(`.${IMAGE_HANDLE_CLASS}[data-handle="se"]`) as HTMLElement
    // jsdom has no layout: give the image a measurable starting width and a wide column.
    img.getBoundingClientRect = () => ({ width: 200 } as DOMRect)
    Object.defineProperty(view.dom, 'clientWidth', { value: 800, configurable: true })
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100 }))
    expect(view.state.selection).toBeInstanceOf(NodeSelection) // the gesture selects the node
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }))
    expect(img.style.getPropertyValue('--image-width')).toBe('250px') // live while dragging, nothing dispatched yet
    expect(getMarkdownForSave(crepe)).toBe('![alt](images/a.png)\n')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 220 }))
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(getMarkdownForSave(crepe)).toBe('![alt|320](images/a.png)\n')
    expect(imgOf(root)?.style.getPropertyValue('--image-width')).toBe('320px')
  })

  it('the width clamps to [MIN_WIDTH, editor column]; an empty alt writes `|<w>`', async () => {
    const { crepe, root, view } = await mount('![](images/a.png)\n')
    const img = imgOf(root) as HTMLImageElement
    const handle = root.querySelector(`.${IMAGE_HANDLE_CLASS}[data-handle="se"]`) as HTMLElement
    img.getBoundingClientRect = () => ({ width: 200 } as DOMRect)
    Object.defineProperty(view.dom, 'clientWidth', { value: 300, configurable: true })
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -1000 }))
    expect(img.style.getPropertyValue('--image-width')).toBe(`${MIN_WIDTH}px`)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000 }))
    expect(img.style.getPropertyValue('--image-width')).toBe('300px')
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(getMarkdownForSave(crepe)).toBe('![|300](images/a.png)\n')
  })

  it('eight handles, and every one changes the WIDTH only: west grows leftward, south maps through the aspect ratio', async () => {
    const { crepe, root, view } = await mount('![alt](images/a.png)\n')
    expect([...root.querySelectorAll(`.${IMAGE_HANDLE_CLASS}`)].map((h) => (h as HTMLElement).dataset.handle)).toEqual([...HANDLE_DIRECTIONS])
    const img = imgOf(root) as HTMLImageElement
    img.getBoundingClientRect = () => ({ width: 200, height: 100 } as DOMRect) // aspect 2:1
    Object.defineProperty(view.dom, 'clientWidth', { value: 800, configurable: true })

    const west = root.querySelector(`.${IMAGE_HANDLE_CLASS}[data-handle="w"]`) as HTMLElement
    west.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 100 })) // pulled LEFT 50 → wider
    expect(img.style.getPropertyValue('--image-width')).toBe('250px')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 300 })) // vertical travel is nothing to an edge handle
    expect(img.style.getPropertyValue('--image-width')).toBe('250px')
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(getMarkdownForSave(crepe)).toBe('![alt|250](images/a.png)\n')

    const south = imgOf(root) as HTMLImageElement
    south.getBoundingClientRect = () => ({ width: 250, height: 125 } as DOMRect)
    const s = root.querySelector(`.${IMAGE_HANDLE_CLASS}[data-handle="s"]`) as HTMLElement
    s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 125 })) // down 25 × aspect 2 → +50
    expect(south.style.getPropertyValue('--image-width')).toBe('300px')
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(getMarkdownForSave(crepe)).toBe('![alt|300](images/a.png)\n')

    const nw = imgOf(root) as HTMLImageElement
    nw.getBoundingClientRect = () => ({ width: 300, height: 150 } as DOMRect)
    const corner = root.querySelector(`.${IMAGE_HANDLE_CLASS}[data-handle="nw"]`) as HTMLElement
    corner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 90, clientY: 40 })) // up 60 × 2 = 120 beats left 10
    expect(nw.style.getPropertyValue('--image-width')).toBe('420px')
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(getMarkdownForSave(crepe)).toBe('![alt|420](images/a.png)\n')
  })

  it('a mousedown + mouseup with no move is a click, not a resize: nothing is dispatched', async () => {
    const { crepe, root, view } = await mount('![alt](images/a.png)\n')
    const img = imgOf(root) as HTMLImageElement
    img.getBoundingClientRect = () => ({ width: 200 } as DOMRect)
    const before = view.state.doc
    root.querySelector(`.${IMAGE_HANDLE_CLASS}[data-handle="se"]`)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(view.state.doc).toBe(before)
    expect(getMarkdownForSave(crepe)).toBe('![alt](images/a.png)\n')
    expect(viewEl(root)?.classList.contains(`${IMAGE_VIEW_CLASS}--resizing`)).toBe(false)
  })

  it('Escape mid-drag cancels: the start width comes back and no document change is made', async () => {
    const { crepe, root, view } = await mount('![alt|200](images/a.png)\n')
    const img = imgOf(root) as HTMLImageElement
    img.getBoundingClientRect = () => ({ width: 200 } as DOMRect)
    Object.defineProperty(view.dom, 'clientWidth', { value: 800, configurable: true })
    root.querySelector(`.${IMAGE_HANDLE_CLASS}[data-handle="se"]`)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }))
    expect(img.style.getPropertyValue('--image-width')).toBe('250px')
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    view.dom.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true) // the drag took the key; the editor's own Escape never saw it
    expect(img.style.getPropertyValue('--image-width')).toBe('200px')
    expect(viewEl(root)?.classList.contains(`${IMAGE_VIEW_CLASS}--resizing`)).toBe(false)
    // The gesture is over: a later mouseup is nobody's.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(img.style.getPropertyValue('--image-width')).toBe('200px')
    expect(getMarkdownForSave(crepe)).toBe('![alt|200](images/a.png)\n')
  })

  it('the window losing focus mid-drag ends the gesture where it stands', async () => {
    const { crepe, root, view } = await mount('![alt](images/a.png)\n')
    const img = imgOf(root) as HTMLImageElement
    img.getBoundingClientRect = () => ({ width: 200 } as DOMRect)
    Object.defineProperty(view.dom, 'clientWidth', { value: 800, configurable: true })
    root.querySelector(`.${IMAGE_HANDLE_CLASS}[data-handle="e"]`)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 160 }))
    window.dispatchEvent(new Event('blur'))
    expect(getMarkdownForSave(crepe)).toBe('![alt|260](images/a.png)\n')
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    expect(imgOf(root)?.style.getPropertyValue('--image-width')).toBe('260px')
  })

  it('a read-only editor has no resize gesture', async () => {
    const { crepe, root, view } = await mount('![alt](images/a.png)\n')
    view.setProps({ editable: () => false })
    const img = imgOf(root) as HTMLImageElement
    img.getBoundingClientRect = () => ({ width: 200 } as DOMRect)
    root.querySelector(`.${IMAGE_HANDLE_CLASS}[data-handle="se"]`)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }))
    document.dispatchEvent(new MouseEvent('mouseup', {}))
    expect(img.style.getPropertyValue('--image-width')).toBe('')
    expect(getMarkdownForSave(crepe)).toBe('![alt](images/a.png)\n')
  })

  it('a broken image never opens the lightbox: there is no <img> to double-click', async () => {
    const onOpenImage = vi.fn()
    const { root } = await mount('![a](missing/x.png)\n', { root: ROOT, notePath: NOTE, onOpenImage })
    imgOf(root)?.dispatchEvent(new Event('error'))
    viewEl(root)?.querySelector(`.${IMAGE_BROKEN_CLASS}`)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    viewEl(root)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onOpenImage).not.toHaveBeenCalled()
  })
})

describe('update', () => {
  it('a width-only change (undo of a resize) patches --image-width on the SAME <img> — no rebuild, no reload', async () => {
    const { root, view } = await mount('![alt|300](images/a.png)\n')
    const img = imgOf(root)
    img?.dispatchEvent(new Event('load'))
    const pos = imagePos(view)
    const node = view.state.doc.nodeAt(pos)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node?.attrs, alt: 'alt|120' }))
    expect(imgOf(root)).toBe(img)
    expect(img?.style.getPropertyValue('--image-width')).toBe('120px')
    expect(img?.alt).toBe('alt')
    expect(viewEl(root)?.classList.contains(`${IMAGE_VIEW_CLASS}--ready`)).toBe(true)
    // Dropping the width altogether removes the property rather than leaving a stale width.
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node?.attrs, alt: 'plain' }))
    expect(imgOf(root)).toBe(img)
    expect(img?.style.getPropertyValue('--image-width')).toBe('')
    expect(img?.alt).toBe('plain')
  })

  it('a title change patches the attribute in place, and an emptied title removes it', async () => {
    const { root, view } = await mount('![alt](images/a.png "t")\n')
    const img = imgOf(root)
    expect(img?.title).toBe('t')
    const pos = imagePos(view)
    const node = view.state.doc.nodeAt(pos)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node?.attrs, title: 'u' }))
    expect(imgOf(root)).toBe(img)
    expect(img?.title).toBe('u')
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node?.attrs, title: '' }))
    expect(img?.hasAttribute('title')).toBe(false)
  })

  it('a src change is a new load: a fresh <img> with the new URL, back in the loading state', async () => {
    const { root, view } = await mount('![alt|300](images/a.png)\n')
    const img = imgOf(root)
    img?.dispatchEvent(new Event('load'))
    const pos = imagePos(view)
    const node = view.state.doc.nodeAt(pos)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node?.attrs, src: 'images/b.png' }))
    const next = imgOf(root)
    expect(next).not.toBe(img)
    expect(next?.getAttribute('src')).toBe(VAULT_URL('images/b.png'))
    expect(next?.style.getPropertyValue('--image-width')).toBe('300px')
    expect(viewEl(root)?.classList.contains(`${IMAGE_VIEW_CLASS}--loading`)).toBe(true)
  })

  it('a src change on a BROKEN image tries again: the chip gives way to a fresh <img>', async () => {
    const { root, view } = await mount('![a](missing/x.png)\n')
    imgOf(root)?.dispatchEvent(new Event('error'))
    expect(imgOf(root)).toBeNull()
    const pos = imagePos(view)
    const node = view.state.doc.nodeAt(pos)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node?.attrs, src: 'images/a.png' }))
    expect(imgOf(root)?.getAttribute('src')).toBe(VAULT_URL('images/a.png'))
    expect(root.querySelector(`.${IMAGE_BROKEN_CLASS}`)).toBeNull()
  })
})

describe('ignoreMutation', () => {
  it('ignores DOM mutations inside the wrapper but never a selection change (ProseMirror must still read a click)', async () => {
    const { root } = await mount('![alt](images/a.png)\n')
    const wrapper = viewEl(root) as HTMLElement
    const desc = (wrapper as unknown as { pmViewDesc: { ignoreMutation: (m: unknown) => boolean } }).pmViewDesc
    expect(desc.ignoreMutation({ type: 'childList', target: wrapper })).toBe(true)
    expect(desc.ignoreMutation({ type: 'attributes', target: wrapper.querySelector('img') })).toBe(true)
    expect(desc.ignoreMutation({ type: 'selection', target: wrapper })).toBe(false)
  })
})
