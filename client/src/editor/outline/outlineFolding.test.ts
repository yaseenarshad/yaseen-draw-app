/**
 * Outline folding (GRO-2011). Ported from yaseen-excalidraw `milkdownAdapter.test.ts`
 * (fold-related cases) and extended with the save-path guard: a fold toggle must never
 * reach `markdownUpdated` / Autosave, and must leave `getMarkdownForSave()` unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { Autosave } from '../../lib/autosave'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { IMAGE_BROKEN_CLASS, IMAGE_VIEW_CLASS } from '../image/imageView'
import { foldAllOutline, OUTLINE_FOLDED_ATTR, OUTLINE_FOLDED_IMAGE_ATTR, OUTLINE_TOGGLE_CLASS, undoLastFold } from './outlineFolding'
import { getOutlineFoldKey } from './outlineFoldKeys'

const OUTLINE = `* Parent
  * Child
    * Grandchild
* Leaf

1. Ordered parent
   1. Ordered child

* [ ] Task parent
  * Task child
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(opts: Omit<CreateCrepeOptions, 'root'>): Promise<{ crepe: Crepe; root: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const toggles = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)]
const toggleFor = (root: HTMLElement, label: string): HTMLButtonElement => {
  const btn = toggles(root).find((b) => b.getAttribute('aria-label')?.endsWith(` ${label}`))
  if (!btn) throw new Error(`no toggle for "${label}"`)
  return btn
}
const folded = (root: HTMLElement) => root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('outline folding', () => {
  it('renders a toggle only on list items that own a nested list or hold an image', async () => {
    const { root } = await mount({ defaultValue: OUTLINE })
    const labels = toggles(root).map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Collapse Parent', 'Collapse Child', 'Collapse Ordered parent', 'Collapse Task parent'])
    for (const b of toggles(root)) {
      expect(b.getAttribute('aria-expanded')).toBe('true')
      expect(b.closest('li')?.querySelector('ul, ol')).not.toBeNull()
    }
    expect(labels.some((l) => l?.includes('Leaf'))).toBe(false)
  })

  it("folds only the parent's subtree, flips aria state, and leaves the markdown untouched", async () => {
    const { crepe, root } = await mount({ defaultValue: OUTLINE })
    const before = getMarkdownForSave(crepe)

    toggleFor(root, 'Parent').click()

    const btn = toggleFor(root, 'Parent')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-label')).toBe('Expand Parent')
    expect(folded(root)).toHaveLength(1)
    expect(folded(root)[0].textContent).toContain('Grandchild')
    expect(folded(root)[0].textContent).not.toContain('Leaf')
    expect(getMarkdownForSave(crepe)).toBe(before)

    toggleFor(root, 'Parent').click()
    expect(folded(root)).toHaveLength(0)
    expect(toggleFor(root, 'Parent').getAttribute('aria-expanded')).toBe('true')
  })

  it('folds every sibling nested list of a parent that owns several (GRO-2031)', async () => {
    // Mixed bullet markers unify on load since GRO-2112, so sibling lists inside one list_item
    // now only arise from a bullet list followed by an ordered list; folding must hide them all.
    const MIXED = `* Parent\n  * Star child\n  1. Ordered child one\n  2. Ordered child two\n* Leaf\n`
    const { crepe, root } = await mount({ defaultValue: MIXED })
    const before = getMarkdownForSave(crepe)

    toggleFor(root, 'Parent').click()

    const hidden = folded(root)
    expect(hidden).toHaveLength(2)
    const hiddenText = [...hidden].map((el) => el.textContent).join(' ')
    expect(hiddenText).toContain('Star child')
    expect(hiddenText).toContain('Ordered child one')
    expect(hiddenText).toContain('Ordered child two')
    expect(hiddenText).not.toContain('Leaf')
    expect(getMarkdownForSave(crepe)).toBe(before)

    toggleFor(root, 'Parent').click()
    expect(folded(root)).toHaveLength(0)
  })

  it('is keyboard-operable: Enter and Space toggle and keep focus on the toggle', async () => {
    const { crepe, root } = await mount({ defaultValue: OUTLINE })
    const before = getMarkdownForSave(crepe)
    toggleFor(root, 'Parent').focus()
    toggleFor(root, 'Parent').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(toggleFor(root, 'Parent').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggleFor(root, 'Parent'))
    toggleFor(root, 'Parent').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(toggleFor(root, 'Parent').getAttribute('aria-expanded')).toBe('true')
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('reports stable keys and restores folds from them in a fresh instance', async () => {
    const onCollapsedKeysChange = vi.fn<(keys: readonly string[]) => void>()
    const first = await mount({ defaultValue: OUTLINE, folding: { onCollapsedKeysChange } })
    // Mount reports the live (resolved) set once, so stale persisted keys get pruned.
    expect(onCollapsedKeysChange).toHaveBeenLastCalledWith([])
    const key = toggleFor(first.root, 'Parent').dataset.outlineFoldKey
    expect(key).toBe(getOutlineFoldKey('Parent', 0))

    toggleFor(first.root, 'Parent').click()
    expect(onCollapsedKeysChange).toHaveBeenLastCalledWith([key])
    const firstMarkdown = getMarkdownForSave(first.crepe)
    await first.crepe.destroy()
    first.root.remove()
    mounted.pop()

    const onSecond = vi.fn<(keys: readonly string[]) => void>()
    const second = await mount({
      defaultValue: OUTLINE,
      folding: { seedCollapsedKeys: () => new Set([key!, 'stale:9']), onCollapsedKeysChange: onSecond },
    })
    expect(toggleFor(second.root, 'Parent').getAttribute('aria-expanded')).toBe('false')
    expect(folded(second.root)).toHaveLength(1)
    expect(onSecond).toHaveBeenLastCalledWith([key])
    expect(getMarkdownForSave(second.crepe)).toBe(firstMarkdown)
  })

  it('fold toggles never reach markdownUpdated or Autosave; a real edit still saves', async () => {
    const updates: string[] = []
    const save = vi.fn(async () => ({ mtime: 2 }))
    let autosave: Autosave | null = null
    const { crepe, root } = await mount({ defaultValue: OUTLINE, onMarkdownUpdated: (md) => void (updates.push(md), autosave?.update(md)) })
    // Crepe's own start-up transaction fires one markdownUpdated (~200ms after create) with the
    // normalised document; in the app that equals the Autosave baseline and is ignored. Let it pass.
    await sleep(400)
    updates.length = 0
    autosave = new Autosave({ markdown: getMarkdownForSave(crepe), mtime: 1, delayMs: 20, save, onStatus: () => {}, onConflict: () => {} })

    toggleFor(root, 'Parent').click()
    toggleFor(root, 'Ordered parent').click()
    toggleFor(root, 'Parent').click()
    // Listener debounce is 200ms; autosave delay 20ms — well past both.
    await sleep(400)
    expect(updates).toEqual([])
    expect(autosave.dirty).toBe(false)
    expect(save).not.toHaveBeenCalled()

    // Control: a document change goes through the same wiring and does save.
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText(' edited', 1 + 1 + 1 + 'Parent'.length))
    })
    await sleep(400)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toContain('* Parent edited')
    expect(save).toHaveBeenCalledTimes(1)
    // The surviving fold is still in place after the edit (positions re-mapped).
    expect(toggleFor(root, 'Ordered parent').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('panic-undo (GRO-2075)', () => {
  const runUndoFold = (crepe: Crepe): boolean =>
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      return undoLastFold(view.state, view.dispatch)
    })

  it('reverts the most recent toggle, once', async () => {
    const { crepe, root } = await mount({ defaultValue: OUTLINE })
    toggleFor(root, 'Parent').click()
    expect(folded(root).length).toBeGreaterThan(0)
    expect(runUndoFold(crepe)).toBe(true)
    expect(folded(root).length).toBe(0)
    // Single-step: a second undo has nothing eligible and falls through to normal undo.
    expect(runUndoFold(crepe)).toBe(false)
  })

  it('returns false when no fold happened (normal undo runs)', async () => {
    const { crepe } = await mount({ defaultValue: OUTLINE })
    expect(runUndoFold(crepe)).toBe(false)
  })

  it('a document change after the fold clears eligibility and keeps the fold', async () => {
    const { crepe, root } = await mount({ defaultValue: OUTLINE })
    toggleFor(root, 'Parent').click()
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('!', 1 + 1 + 1 + 'Parent'.length))
    })
    expect(runUndoFold(crepe)).toBe(false)
    expect(folded(root).length).toBeGreaterThan(0)
  })

  it('reverts fold-all to the exact previous fold set', async () => {
    const { crepe, root } = await mount({ defaultValue: OUTLINE })
    toggleFor(root, 'Child').click()
    const before = folded(root).length
    expect(before).toBeGreaterThan(0)
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      foldAllOutline(view.state, view.dispatch)
    })
    expect(folded(root).length).toBeGreaterThan(before)
    expect(runUndoFold(crepe)).toBe(true)
    // Back to exactly the pre-fold-all state: Child folded, everything else open.
    expect(folded(root).length).toBe(before)
    expect(toggleFor(root, 'Child').getAttribute('aria-expanded')).toBe('false')
    expect(toggleFor(root, 'Parent').getAttribute('aria-expanded')).toBe('true')
  })

  it('reverting an unfold re-folds it', async () => {
    const { crepe, root } = await mount({ defaultValue: OUTLINE })
    toggleFor(root, 'Parent').click()
    toggleFor(root, 'Parent').click()
    expect(folded(root).length).toBe(0)
    expect(runUndoFold(crepe)).toBe(true)
    expect(folded(root).length).toBeGreaterThan(0)
  })
})

describe('chevron rendering (GRO-2093)', () => {
  it('renders an SVG chevron (no text glyph) in both states', async () => {
    const { root } = await mount({ defaultValue: OUTLINE })
    const expanded = toggleFor(root, 'Parent')
    expect(expanded.querySelector('svg')).not.toBeNull()
    expect(expanded.textContent).toBe('')

    expanded.click()
    const collapsed = toggleFor(root, 'Parent') // widget re-renders on toggle
    expect(collapsed.getAttribute('aria-expanded')).toBe('false')
    expect(collapsed.querySelector('svg')).not.toBeNull()
    expect(collapsed.textContent).toBe('')
  })
})

describe('image bullets fold to a chip (YAZ-1709)', () => {
  const IMAGE_OPTS = { image: { root: '/v', notePath: '/v/n.md' } }
  const IMAGES = `* ![Shot|400](a.png)
* Text leaf
* ![Pair](b.png)
  * Child
`
  const chips = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(`.${IMAGE_VIEW_CLASS}[${OUTLINE_FOLDED_IMAGE_ATTR}="true"]`)]

  it('an image-only leaf gets a chevron labelled by its alt text; a text-only leaf still gets none', async () => {
    const { root } = await mount({ defaultValue: IMAGES, ...IMAGE_OPTS })
    expect(toggles(root).map((b) => b.getAttribute('aria-label'))).toEqual(['Collapse Shot', 'Collapse Pair'])
    expect(toggleFor(root, 'Shot').dataset.outlineFoldKey).toBe(getOutlineFoldKey('Shot', 0))
  })

  it('folding an image-only bullet stamps its image (nothing else) as a meta-only transaction', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, root } = await mount({ defaultValue: IMAGES, ...IMAGE_OPTS, onMarkdownUpdated })
    await sleep(300) // Crepe's mount-time normalisation fires once; not ours
    onMarkdownUpdated.mockClear()
    const before = getMarkdownForSave(crepe)

    toggleFor(root, 'Shot').click()

    expect(chips(root)).toHaveLength(1)
    expect(folded(root)).toHaveLength(0) // no nested list, so nothing gets data-outline-folded
    expect(toggleFor(root, 'Shot').getAttribute('aria-expanded')).toBe('false')
    expect(getMarkdownForSave(crepe)).toBe(before)
    await sleep(300)
    expect(onMarkdownUpdated).not.toHaveBeenCalled()

    toggleFor(root, 'Shot').click()
    expect(chips(root)).toHaveLength(0)
  })

  it('a bullet with an image AND children folds both: the chip and the hidden list', async () => {
    const { root } = await mount({ defaultValue: IMAGES, ...IMAGE_OPTS })
    toggleFor(root, 'Pair').click()
    expect(chips(root)).toHaveLength(1)
    expect(folded(root)).toHaveLength(1)
    expect(folded(root)[0].textContent).toContain('Child')
  })

  it('a click on the folded chip unfolds its bullet; a click on an unfolded image is left to ProseMirror', async () => {
    const { crepe, root } = await mount({ defaultValue: IMAGES, ...IMAGE_OPTS })
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    // jsdom has no layout for `posAtCoords`, so the click reaches the plugin the way ProseMirror
    // delivers it: through the `handleClickOn` prop with the image node and its position.
    // Only the thumbnail expands; a click on the wrapper around it is not the thumbnail.
    const clickFirstImage = (on: 'img' | 'wrapper'): boolean => {
      let pos = -1
      let node: ProseNode | null = null
      view.state.doc.descendants((n, p) => {
        if (pos === -1 && n.type.name === 'image') (pos = p), (node = n)
        return pos === -1
      })
      const wrapper = root.querySelector<HTMLElement>('.image-view')!
      const target = on === 'img' ? wrapper.querySelector('img')! : wrapper
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'target', { value: target })
      return view.someProp('handleClickOn', (f) => f(view, pos, node!, pos, event, true)) ?? false
    }
    expect(clickFirstImage('img')).toBe(false)
    toggleFor(root, 'Shot').click()
    expect(chips(root)).toHaveLength(1)
    expect(clickFirstImage('wrapper')).toBe(false)
    expect(chips(root)).toHaveLength(1)
    expect(clickFirstImage('img')).toBe(true)
    expect(chips(root)).toHaveLength(0)
    expect(toggleFor(root, 'Shot').getAttribute('aria-expanded')).toBe('true')
  })

  it('an expanded image in a list item carries the foldable mark and its corner button folds the bullet', async () => {
    const { crepe, root } = await mount({ defaultValue: IMAGES, ...IMAGE_OPTS })
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    const wrapper = root.querySelector<HTMLElement>('.image-view')!
    expect(wrapper.getAttribute('data-outline-foldable-image')).toBe('true')
    expect(wrapper.getAttribute('data-outline-folded-image')).toBeNull()
    const button = wrapper.querySelector<HTMLButtonElement>('.image-view__fold')!
    expect(button.getAttribute('aria-label')).toBe('Collapse image')
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: button })
    expect(view.someProp('handleDOMEvents', (h) => h.mousedown?.(view, event)) ?? false).toBe(true)
    expect(chips(root)).toHaveLength(1)
    expect(wrapper.getAttribute('data-outline-foldable-image')).toBe('true')
    expect(toggleFor(root, 'Shot').getAttribute('aria-expanded')).toBe('false')
  })

  it('an image inside a NESTED list is the child item\'s own: folding the parent hides the list and never chips the inner image', async () => {
    const { root } = await mount({ defaultValue: '* Parent\n  * ![Inner](i.png)\n', ...IMAGE_OPTS })
    toggleFor(root, 'Parent').click()
    expect(folded(root)).toHaveLength(1)
    expect(folded(root)[0].querySelector(`.${IMAGE_VIEW_CLASS}`)).not.toBeNull()
    expect(chips(root)).toHaveLength(0)
  })

  it('a BROKEN image folds and unfolds like any other: the chip attribute lands on the inert broken chip, no <img> comes back', async () => {
    const { root } = await mount({ defaultValue: IMAGES, ...IMAGE_OPTS })
    const wrapper = root.querySelector<HTMLElement>(`.${IMAGE_VIEW_CLASS}`)!
    wrapper.querySelector('img')!.dispatchEvent(new Event('error'))
    expect(wrapper.classList.contains(`${IMAGE_VIEW_CLASS}--broken`)).toBe(true)

    toggleFor(root, 'Shot').click()
    expect(wrapper.getAttribute(OUTLINE_FOLDED_IMAGE_ATTR)).toBe('true')
    expect(wrapper.querySelector('img')).toBeNull()
    expect(wrapper.classList.contains(`${IMAGE_VIEW_CLASS}--broken`)).toBe(true)
    expect(wrapper.querySelector(`.${IMAGE_BROKEN_CLASS}`)?.textContent).toBe('Broken image: a.png')

    toggleFor(root, 'Shot').click()
    expect(wrapper.getAttribute(OUTLINE_FOLDED_IMAGE_ATTR)).toBeNull()
    expect(wrapper.classList.contains(`${IMAGE_VIEW_CLASS}--broken`)).toBe(true)
  })

  it('two images in one bullet are both chipped by the one fold', async () => {
    const { root } = await mount({ defaultValue: '* ![A](a.png) ![B](b.png)\n', ...IMAGE_OPTS })
    expect(toggles(root)).toHaveLength(1)
    toggles(root)[0].click()
    expect(chips(root)).toHaveLength(2)
  })

  it("an image in the item's SECOND paragraph is one of its own blocks: chipped on fold", async () => {
    const { root } = await mount({ defaultValue: '* first\n\n  ![Two|300](b.png)\n', ...IMAGE_OPTS })
    toggleFor(root, 'first').click()
    expect(chips(root)).toHaveLength(1)
    expect(folded(root)).toHaveLength(0)
  })

  it('the fold key is the alt text: persisted through onCollapsedKeysChange, a fresh mount seeded with it is still folded', async () => {
    const onCollapsedKeysChange = vi.fn<(keys: readonly string[]) => void>()
    const first = await mount({ defaultValue: IMAGES, ...IMAGE_OPTS, folding: { onCollapsedKeysChange } })
    toggleFor(first.root, 'Shot').click()
    const key = getOutlineFoldKey('Shot', 0)
    expect(onCollapsedKeysChange).toHaveBeenLastCalledWith([key])
    await first.crepe.destroy()
    first.root.remove()
    mounted.pop()

    const second = await mount({ defaultValue: IMAGES, ...IMAGE_OPTS, folding: { seedCollapsedKeys: () => new Set([key]) } })
    expect(toggleFor(second.root, 'Shot').getAttribute('aria-expanded')).toBe('false')
    expect(chips(second.root)).toHaveLength(1)
  })
})
