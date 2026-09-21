/**
 * Zoom into a bullet (GRO-2029): real editor (`createCrepe`), zoom triggered via glyph click /
 * `Mod-.` / `Mod-Shift-.` / breadcrumb clicks, decorations inspected in the DOM. The save-path
 * guard matters most: zoom must never reach `markdownUpdated` and must leave the markdown unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS } from './outlineFolding'
import { getZoomedItemPos, itemPosForZoomKey, ZOOM_ANCESTOR_CLASS, ZOOM_CRUMB_CLASS, ZOOM_CRUMBS_CLASS, ZOOM_HIDDEN_CLASS, ZOOM_HISTORY_KEY, zoomKeyAt } from './zoom'

const OUTLINE = `Intro paragraph

* L1 a
  * L2 a
    * L3 a
    * L3 b
  * L2 b
* L1 b
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown = OUTLINE, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, zoom: { fileName: 'notes.md' }, ...opts })
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

/** ProseMirror resolves `Mod` from `navigator.platform` (jsdom: not mac → Ctrl). */
const IS_MAC = /Mac/.test(navigator.platform)

type Key = 'Mod-.' | 'Mod-Shift-.' | 'Shift-Tab' | 'Enter' | 'Mod-z'

function press(crepe: Crepe, key: Key): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const mod = key.startsWith('Mod')
    const shift = key.includes('Shift')
    // Real keyboards shift `.` into `>`: `Mod-Shift-.` arrives as key '>' + keyCode 190 and
    // prosemirror-keymap resolves it from the keyCode. key '.' would take pm-keymap's
    // "without Shift" fallback and hit `Mod-.` instead, which browsers never do.
    const name = key.endsWith('.') ? (shift ? '>' : '.') : key.endsWith('Tab') ? 'Tab' : key === 'Mod-z' ? 'z' : 'Enter'
    const init: KeyboardEventInit & { keyCode?: number } = {
      key: name,
      code: key.endsWith('.') ? 'Period' : name === 'z' ? 'KeyZ' : name,
      keyCode: key.endsWith('.') ? 190 : name === 'Tab' ? 9 : name === 'z' ? 90 : 13,
      ...(mod ? (IS_MAC ? { metaKey: true } : { ctrlKey: true }) : {}),
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }
    const event = new KeyboardEvent('keydown', init)
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
}

function posOf(crepe: Crepe, text: string, offset = 0): number {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    let pos = -1
    doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index + offset
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    return pos
  })
}

const caretIn = (crepe: Crepe, text: string, offset = text.length) =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const pos = posOf(crepe, text, offset)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  })

const caretPos = (crepe: Crepe) => crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection.from)
const zoomedPos = (crepe: Crepe) => crepe.editor.action((ctx) => getZoomedItemPos(ctx.get(editorViewCtx).state))
const typeText = (crepe: Crepe, text: string) =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText(text))
  })

/** The `li.list-item` whose first block contains `text`. */
const itemEl = (root: HTMLElement, text: string): HTMLElement => {
  const li = [...root.querySelectorAll<HTMLElement>('li.list-item')].find(
    (el) => el.querySelector(':scope > .children > .content-dom > p')?.textContent === text,
  )
  if (!li) throw new Error(`no item "${text}"`)
  return li
}
const clickGlyph = (root: HTMLElement, text: string) => {
  const wrapper = itemEl(root, text).querySelector<HTMLElement>(':scope > .label-wrapper')
  if (!wrapper) throw new Error(`no glyph for "${text}"`)
  wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}
/** Whether the block (or an ancestor block) carrying `text` is hidden by a zoom decoration. */
const isHidden = (root: HTMLElement, text: string): boolean => itemEl(root, text).closest(`.${ZOOM_HIDDEN_CLASS}`) !== null
const hiddenCount = (root: HTMLElement) => root.querySelectorAll(`.${ZOOM_HIDDEN_CLASS}`).length
const crumbLabels = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLButtonElement>(`.${ZOOM_CRUMBS_CLASS} .${ZOOM_CRUMB_CLASS}`)].map((b) => b.textContent ?? '')
const clickCrumb = (root: HTMLElement, label: string) => {
  const button = [...root.querySelectorAll<HTMLButtonElement>(`.${ZOOM_CRUMB_CLASS}`)].find((b) => b.textContent === label)
  if (!button) throw new Error(`no crumb "${label}"`)
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('zoom into a bullet', () => {
  it('is not zoomed on mount: no hidden blocks, no breadcrumbs', async () => {
    const { crepe, root } = await mount()
    expect(zoomedPos(crepe)).toBeNull()
    expect(hiddenCount(root)).toBe(0)
    expect(root.querySelector(`.${ZOOM_CRUMBS_CLASS}`)).toBeNull()
  })

  it('glyph click hides siblings, ancestors and other top-level blocks, shows breadcrumbs', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    // Hidden: intro paragraph, L1 b (sibling of the ancestor), L1 a's own paragraph, L2 b
    // (sibling), and Crepe's trailing empty paragraph at the end of the doc.
    expect(hiddenCount(root)).toBe(5)
    expect(isHidden(root, 'L1 b')).toBe(true)
    expect(isHidden(root, 'L2 b')).toBe(true)
    expect(isHidden(root, 'L2 a')).toBe(false)
    expect(isHidden(root, 'L3 a')).toBe(false)
    expect(isHidden(root, 'L3 b')).toBe(false)
    expect(root.querySelector('p:not(li p)')?.classList.contains(ZOOM_HIDDEN_CLASS)).toBe(true)
    expect(itemEl(root, 'L1 a').parentElement?.classList.contains(ZOOM_ANCESTOR_CLASS)).toBe(true)
    expect(itemEl(root, 'L2 a').parentElement?.classList.contains(ZOOM_ANCESTOR_CLASS)).toBe(false)
    expect(crumbLabels(root)).toEqual(['notes.md', 'L1 a', 'L2 a'])
    // Breadcrumbs sit before the first block.
    expect(root.querySelector('.ProseMirror')?.firstElementChild?.classList.contains(ZOOM_CRUMBS_CLASS)).toBe(true)
  })

  it('truncates long breadcrumb labels at 40 chars', async () => {
    const long = 'A'.repeat(60)
    const { root } = await mount(`* ${long}\n  * child\n`)
    clickGlyph(root, 'child')
    expect(crumbLabels(root)).toEqual(['notes.md', `${'A'.repeat(39)}…`, 'child'])
  })

  it('moves the caret into the zoomed item when the selection was outside', async () => {
    const { crepe, root } = await mount()
    caretIn(crepe, 'L1 b')
    clickGlyph(root, 'L3 a')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L3 a'))
    // …and keeps it when it already is inside.
    clickCrumb(root, 'L1 a')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L3 a'))
  })

  it('Mod-. zooms into the item at the caret, Mod-Shift-. zooms out one level then fully', async () => {
    const { crepe, root } = await mount()
    caretIn(crepe, 'L3 b')
    expect(press(crepe, 'Mod-.')).toBe(true)
    expect(crumbLabels(root)).toEqual(['notes.md', 'L1 a', 'L2 a', 'L3 b'])
    expect(isHidden(root, 'L3 a')).toBe(true)
    expect(press(crepe, 'Mod-Shift-.')).toBe(true)
    expect(crumbLabels(root)).toEqual(['notes.md', 'L1 a', 'L2 a'])
    expect(isHidden(root, 'L3 a')).toBe(false)
    expect(isHidden(root, 'L2 b')).toBe(true)
    expect(press(crepe, 'Mod-Shift-.')).toBe(true)
    expect(crumbLabels(root)).toEqual(['notes.md', 'L1 a'])
    expect(press(crepe, 'Mod-Shift-.')).toBe(true)
    expect(zoomedPos(crepe)).toBeNull()
    expect(hiddenCount(root)).toBe(0)
    expect(root.querySelector(`.${ZOOM_CRUMBS_CLASS}`)).toBeNull()
    // Not zoomed: the key falls through.
    expect(press(crepe, 'Mod-Shift-.')).toBe(false)
  })

  it('Mod-. outside a list falls through', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'Intro')
    expect(press(crepe, 'Mod-.')).toBe(false)
    expect(zoomedPos(crepe)).toBeNull()
  })

  it('breadcrumb clicks zoom to that ancestor; the file crumb zooms out fully', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L3 a')
    clickCrumb(root, 'L1 a')
    expect(crumbLabels(root)).toEqual(['notes.md', 'L1 a'])
    expect(isHidden(root, 'L2 b')).toBe(false)
    expect(isHidden(root, 'L1 b')).toBe(true)
    clickCrumb(root, 'notes.md')
    expect(zoomedPos(crepe)).toBeNull()
    expect(hiddenCount(root)).toBe(0)
  })

  it('editing inside the zoomed subtree keeps the zoom (position mapped through the edit)', async () => {
    const { crepe, root } = await mount()
    caretIn(crepe, 'L2 a')
    press(crepe, 'Mod-.')
    const before = zoomedPos(crepe)
    // Edit ABOVE the zoomed item so its position shifts.
    caretIn(crepe, 'L1 a')
    typeText(crepe, ' more text')
    expect(zoomedPos(crepe)).toBe((before ?? 0) + ' more text'.length)
    expect(crumbLabels(root)).toEqual(['notes.md', 'L1 a more text', 'L2 a'])
    // Edit INSIDE: type and add a child with Enter.
    caretIn(crepe, 'L3 b')
    typeText(crepe, '!')
    press(crepe, 'Enter')
    typeText(crepe, 'L3 c')
    expect(crumbLabels(root)).toEqual(['notes.md', 'L1 a more text', 'L2 a'])
    expect(isHidden(root, 'L3 c')).toBe(false)
    expect(isHidden(root, 'L2 b')).toBe(true)
    expect(getMarkdownForSave(crepe)).toContain('    * L3 b!\n    * L3 c\n')
  })

  it('Shift-Tab on the zoomed item or one of its direct children is a no-op while zoomed', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    const md = getMarkdownForSave(crepe)
    caretIn(crepe, 'L2 a')
    expect(press(crepe, 'Shift-Tab')).toBe(true)
    caretIn(crepe, 'L3 a')
    expect(press(crepe, 'Shift-Tab')).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(md)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    // Zoomed out: Shift-Tab lifts again.
    clickCrumb(root, 'notes.md')
    caretIn(crepe, 'L3 a')
    expect(press(crepe, 'Shift-Tab')).toBe(true)
    expect(getMarkdownForSave(crepe)).not.toBe(md)
  })

  it('clears the zoom when the zoomed item is deleted', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L3 b')
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const pos = zoomedPos(crepe) ?? 0
      const item = view.state.doc.nodeAt(pos)
      view.dispatch(view.state.tr.delete(pos, pos + (item?.nodeSize ?? 0)))
    })
    expect(zoomedPos(crepe)).toBeNull()
    expect(hiddenCount(root)).toBe(0)
  })

  it('leaves fold state alone and shows a folded ancestor expanded while zoomed inside it', async () => {
    const onCollapsedKeysChange = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { folding: { onCollapsedKeysChange } })
    const toggle = [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)].find((b) =>
      b.getAttribute('aria-label')?.endsWith(' L1 a'),
    )
    toggle?.click()
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(1)
    const keysAfterFold = onCollapsedKeysChange.mock.calls.length
    caretIn(crepe, 'L2 a')
    press(crepe, 'Mod-.')
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(1)
    // The toggle re-renders on every fold; re-query and confirm it still reports collapsed.
    const toggleNow = [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)].find((b) =>
      b.getAttribute('aria-label')?.endsWith(' L1 a'),
    )
    expect(toggleNow?.getAttribute('aria-expanded')).toBe('false')
    expect(onCollapsedKeysChange.mock.calls.length).toBe(keysAfterFold)
    press(crepe, 'Mod-Shift-.')
    press(crepe, 'Mod-Shift-.')
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(1)
  })

  it('task checkboxes still toggle on click instead of zooming', async () => {
    const { crepe, root } = await mount(`* [ ] Task\n  * child\n`)
    const wrapper = itemEl(root, 'Task').querySelector<HTMLElement>(':scope > .label-wrapper')
    wrapper?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(zoomedPos(crepe)).toBeNull()
  })

  it('never fires markdownUpdated and leaves the markdown unchanged', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { onMarkdownUpdated })
    // Crepe's start-up transaction fires one markdownUpdated (~200ms after create); let it pass.
    await sleep(400)
    onMarkdownUpdated.mockClear()
    const md = getMarkdownForSave(crepe)
    clickGlyph(root, 'L3 a')
    clickCrumb(root, 'L1 a')
    press(crepe, 'Mod-Shift-.')
    caretIn(crepe, 'L2 b')
    press(crepe, 'Mod-.')
    await sleep(400)
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
    expect(getMarkdownForSave(crepe)).toBe(md)
  })
})

describe('browser history: Back / Forward walk zoom levels (GRO-2091 A)', () => {
  const popTo = (state: unknown) => window.dispatchEvent(new PopStateEvent('popstate', { state }))
  const entry = () => (history.state as Record<string, unknown> | null)?.[ZOOM_HISTORY_KEY] as { file: string; key: string | null } | undefined

  it('pushes one in-memory entry per zoom change (file + key) and leaves the URL hash alone', async () => {
    history.replaceState(null, '', '#/vault/notes.md')
    const { crepe, root } = await mount()
    const length0 = history.length
    clickGlyph(root, 'L2 a')
    expect(history.length).toBe(length0 + 1)
    expect(entry()).toEqual({ file: 'notes.md', key: expect.any(String) })
    expect(location.hash).toBe('#/vault/notes.md')
    const l2Entry = history.state
    clickGlyph(root, 'L3 a')
    expect(history.length).toBe(length0 + 2)
    expect(entry()?.key).not.toBe(l2Entry[ZOOM_HISTORY_KEY].key)
    // Zooming out (file crumb) is a zoom change too, so Back can return to the zoomed view.
    clickCrumb(root, 'notes.md')
    expect(zoomedPos(crepe)).toBeNull()
    expect(history.length).toBe(length0 + 3)
    expect(entry()).toEqual({ file: 'notes.md', key: null })
    expect(location.hash).toBe('#/vault/notes.md')
  })

  it('popstate restores the entry\'s level without pushing; entries without zoom state zoom out', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    const l2Entry = history.state
    clickGlyph(root, 'L3 a')
    const length = history.length
    popTo(l2Entry) // Back
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    expect(history.length).toBe(length)
    popTo(null) // Back to the original page entry
    expect(zoomedPos(crepe)).toBeNull()
    popTo(l2Entry) // Forward
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    expect(history.length).toBe(length)
  })

  it('ignores entries of another file and zooms out on a key that no longer resolves', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    popTo({ [ZOOM_HISTORY_KEY]: { file: 'other.md', key: 'deadbeef:0' } })
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    popTo({ [ZOOM_HISTORY_KEY]: { file: 'notes.md', key: 'deadbeef:0' } })
    expect(zoomedPos(crepe)).toBeNull()
  })

  it('zoom keys are label + occurrence over ALL items, so same-labelled items stay distinct', async () => {
    const { crepe } = await mount('* Same\n  * Child\n* Same\n')
    crepe.editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc
      const first = posOf(crepe, 'Same') - 2
      const positions: number[] = []
      doc.descendants((node, pos) => {
        if (node.type.name === 'list_item' && node.firstChild?.textContent === 'Same') positions.push(pos)
        return true
      })
      expect(positions).toHaveLength(2)
      expect(positions[0]).toBe(first)
      const keys = positions.map((pos) => zoomKeyAt(doc, pos))
      expect(keys[0]).not.toBe(keys[1])
      expect(keys.map((key) => itemPosForZoomKey(doc, key as string))).toEqual(positions)
      expect(zoomKeyAt(doc, 0)).toBeNull() // not a list_item
    })
  })

  it('removes its popstate listener on destroy (one editor per file; the next file registers its own)', async () => {
    const { crepe, root } = await mount()
    const removed = vi.spyOn(window, 'removeEventListener')
    await crepe.destroy()
    mounted.splice(0)
    root.remove()
    expect(removed).toHaveBeenCalledWith('popstate', expect.any(Function))
    removed.mockRestore()
  })
})

describe('Mod-z reverts the latest zoom; folds and zooms share one latest-view-action rule (GRO-2091 B)', () => {
  const foldToggle = (root: HTMLElement, label: string) => {
    const button = root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}[aria-label="Collapse ${label}"]`)
    if (!button) throw new Error(`no toggle for "${label}"`)
    button.click()
  }
  const foldedCount = (root: HTMLElement) => root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`).length

  it('reverts the latest zoom change once (single step) and pushes a history entry for it', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    clickGlyph(root, 'L3 a')
    const length = history.length
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    expect(history.length).toBe(length + 1) // Back returns to the zoomed view
    press(crepe, 'Mod-z') // eligibility consumed: history's undo (nothing to undo), zoom stays
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
  })

  it('a document edit after the zoom hands Mod-z back to history: text undone, zoom kept', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    caretIn(crepe, 'L2 a')
    typeText(crepe, 'XYZ')
    expect(getMarkdownForSave(crepe)).toContain('L2 aXYZ')
    press(crepe, 'Mod-z')
    expect(getMarkdownForSave(crepe)).not.toContain('XYZ')
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
  })

  it('fold then zoom: Mod-z reverts the zoom and keeps the fold', async () => {
    const { crepe, root } = await mount()
    foldToggle(root, 'L2 a')
    expect(foldedCount(root)).toBe(1)
    clickGlyph(root, 'L1 a')
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(zoomedPos(crepe)).toBeNull()
    expect(foldedCount(root)).toBe(1)
  })

  it('zoom then fold: Mod-z reverts the fold and keeps the zoom; the next Mod-z is history\'s', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L1 a')
    foldToggle(root, 'L2 a')
    expect(foldedCount(root)).toBe(1)
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(foldedCount(root)).toBe(0)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L1 a') - 2)
    press(crepe, 'Mod-z')
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L1 a') - 2) // the zoom was no longer the latest view action
  })

  it('a Back-restored level counts as the latest view action too', async () => {
    const { crepe, root } = await mount()
    clickGlyph(root, 'L2 a')
    const l2Entry = history.state
    clickGlyph(root, 'L3 a')
    window.dispatchEvent(new PopStateEvent('popstate', { state: l2Entry }))
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L2 a') - 2)
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(zoomedPos(crepe)).toBe(posOf(crepe, 'L3 a') - 2)
  })
})
