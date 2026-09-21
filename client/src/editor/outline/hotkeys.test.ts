/**
 * Obsidian hotkeys (GRO-2027): real editor (`createCrepe`), keys dispatched through ProseMirror's
 * `handleKeyDown` (Crepe's keymaps + ours, in priority order), markdown asserted via
 * `getMarkdownForSave`. Shift-letter chords carry `keyCode` because ProseMirror resolves
 * `Shift-Mod-<letter>` from the key code when the character key is shifted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { OUTLINE_FOLDED_ATTR, OUTLINE_FOLDED_IMAGE_ATTR, OUTLINE_TOGGLE_CLASS } from './outlineFolding'

const OUTLINE = `* L1 a
  * L2 a
    * L3 a
  * L2 b
* L1 b
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown = OUTLINE, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...opts })
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

type Key = 'Mod-Enter' | 'Mod-Shift-u' | 'Mod-Shift-i' | 'Mod-Shift-x' | 'Mod-z' | 'Mod-ArrowUp' | 'Mod-ArrowDown'
const NAMED_KEY_CODES: Record<string, number> = { Enter: 13, ArrowUp: 38, ArrowDown: 40 }

function press(crepe: Crepe, key: Key): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const shift = key.includes('Shift')
    const letter = key.slice(key.lastIndexOf('-') + 1)
    // Named keys (Enter, ArrowUp, …) pass through as-is; letters become Key<X> + char code.
    const named = letter.length > 1
    const init: KeyboardEventInit & { keyCode?: number } = {
      key: named ? letter : letter.toUpperCase(),
      code: named ? letter : `Key${letter.toUpperCase()}`,
      keyCode: NAMED_KEY_CODES[letter] ?? letter.toUpperCase().charCodeAt(0),
      ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }),
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

function select(crepe: Crepe, from: number, to = from): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  })
}

const caretIn = (crepe: Crepe, text: string, offset = text.length) => select(crepe, posOf(crepe, text, offset))
const md = (crepe: Crepe) => getMarkdownForSave(crepe)
const folded = (root: HTMLElement) => root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`).length
const chips = (root: HTMLElement) => root.querySelectorAll(`[${OUTLINE_FOLDED_IMAGE_ATTR}="true"]`).length
const toggles = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)]

describe('Mod-Enter (task cycle)', () => {
  it('cycles bullet → [ ] → [x] → bullet with the caret anywhere in the item', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L2 a', 1)
    expect(press(crepe, 'Mod-Enter')).toBe(true)
    expect(md(crepe)).toBe('* L1 a\n  * [ ] L2 a\n    * L3 a\n  * L2 b\n* L1 b\n')
    press(crepe, 'Mod-Enter')
    expect(md(crepe)).toBe('* L1 a\n  * [x] L2 a\n    * L3 a\n  * L2 b\n* L1 b\n')
    press(crepe, 'Mod-Enter')
    expect(md(crepe)).toBe(OUTLINE)
  })

  it('starts from the item\'s own state for existing tasks, empty tasks stay `* [ ]`', async () => {
    const { crepe } = await mount('* [x] done\n* [ ] open\n* [ ]\n')
    caretIn(crepe, 'done')
    press(crepe, 'Mod-Enter')
    expect(md(crepe)).toBe('* done\n* [ ] open\n* [ ]\n')
    caretIn(crepe, 'open')
    press(crepe, 'Mod-Enter')
    expect(md(crepe)).toBe('* done\n* [x] open\n* [ ]\n')
    select(crepe, posOf(crepe, 'open') + 'open'.length + 3)
    press(crepe, 'Mod-Enter')
    expect(md(crepe)).toBe('* done\n* [x] open\n* [x]\n')
    press(crepe, 'Mod-Enter')
    expect(md(crepe)).toBe('* done\n* [x] open\n*\n')
    press(crepe, 'Mod-Enter')
    expect(md(crepe)).toBe('* done\n* [x] open\n* [ ]\n')
  })

  it('cycles each item of a multi-item selection independently; the parent above the selection is untouched', async () => {
    const { crepe } = await mount('* [ ] L1 a\n  * L2 a\n    * [x] L3 a\n  * L2 b\n* L1 b\n')
    select(crepe, posOf(crepe, 'L2 a', 1), posOf(crepe, 'L2 b', 2))
    expect(press(crepe, 'Mod-Enter')).toBe(true)
    expect(md(crepe)).toBe('* [ ] L1 a\n  * [ ] L2 a\n    * L3 a\n  * [ ] L2 b\n* L1 b\n')
  })

  it('falls through outside list items', async () => {
    const { crepe } = await mount('Just a paragraph\n')
    caretIn(crepe, 'Just')
    expect(press(crepe, 'Mod-Enter')).toBe(false)
    expect(md(crepe)).toBe('Just a paragraph\n')
  })
})

describe('Mod-Shift-u / Mod-Shift-i (fold all / unfold all)', () => {
  it('folds every parent (text leafs untouched), unfolds all, and reports keys through onCollapsedKeysChange', async () => {
    const onCollapsedKeysChange = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { folding: { onCollapsedKeysChange } })
    expect(toggles(root)).toHaveLength(2)
    caretIn(crepe, 'L1 b')
    expect(press(crepe, 'Mod-Shift-u')).toBe(true)
    expect(folded(root)).toBe(2)
    expect(toggles(root).every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(onCollapsedKeysChange).toHaveBeenLastCalledWith(expect.arrayContaining([expect.any(String)]))
    expect(onCollapsedKeysChange.mock.lastCall?.[0]).toHaveLength(2)
    expect(press(crepe, 'Mod-Shift-u')).toBe(false)
    expect(md(crepe)).toBe(OUTLINE)
    expect(press(crepe, 'Mod-Shift-i')).toBe(true)
    expect(folded(root)).toBe(0)
    expect(onCollapsedKeysChange).toHaveBeenLastCalledWith([])
    expect(press(crepe, 'Mod-Shift-i')).toBe(false)
  })

  it('an image-only leaf bullet is foldable too (YAZ-1709): chipped by Mod-Shift-u, restored by Mod-Shift-i', async () => {
    const { crepe, root } = await mount(`* L1 a\n  * L2 a\n* ![Shot](a.png)\n* L1 b\n`, { image: { root: '/v', notePath: '/v/n.md' } })
    expect(toggles(root)).toHaveLength(2)
    caretIn(crepe, 'L1 b')
    expect(press(crepe, 'Mod-Shift-u')).toBe(true)
    expect(folded(root)).toBe(1)
    expect(chips(root)).toBe(1)
    expect(press(crepe, 'Mod-Shift-i')).toBe(true)
    expect(folded(root)).toBe(0)
    expect(chips(root)).toBe(0)
  })

  it('does nothing in a document without parents', async () => {
    const { crepe } = await mount('* a\n* b\n')
    caretIn(crepe, 'a')
    expect(press(crepe, 'Mod-Shift-u')).toBe(false)
  })
})

describe('Mod-z (fold panic-undo, GRO-2075)', () => {
  it('reverts the latest fold and leaves the markdown alone; history keeps Mod-z otherwise', async () => {
    const { crepe, root } = await mount(OUTLINE)
    caretIn(crepe, 'L1 b')
    expect(press(crepe, 'Mod-Shift-u')).toBe(true)
    expect(folded(root)).toBe(2)
    // Our binding outranks history's: the fold reverts, the document does not.
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(folded(root)).toBe(0)
    expect(md(crepe)).toBe(OUTLINE)
    // Single step: the next Mod-z is history's again and cannot re-touch folds.
    press(crepe, 'Mod-z')
    expect(folded(root)).toBe(0)
  })
})

describe('Mod-Shift-x (strikethrough)', () => {
  it('toggles strikethrough on the selection', async () => {
    const { crepe } = await mount('* L1 a\n')
    select(crepe, posOf(crepe, 'L1 a'), posOf(crepe, 'L1 a', 4))
    expect(press(crepe, 'Mod-Shift-x')).toBe(true)
    expect(md(crepe)).toBe('* ~~L1 a~~\n')
    expect(press(crepe, 'Mod-Shift-x')).toBe(true)
    expect(md(crepe)).toBe('* L1 a\n')
  })
})

describe('Mod-ArrowUp / Mod-ArrowDown (fold / unfold the caret item, GRO-2092)', () => {
  it('folds and unfolds the caret item through the fold plugin; markdown and markdownUpdated untouched', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe, root } = await mount(OUTLINE, { onMarkdownUpdated })
    await new Promise((r) => setTimeout(r, 300)) // Crepe's mount-time normalisation fires once; not ours
    onMarkdownUpdated.mockClear()
    const before = md(crepe)
    caretIn(crepe, 'L2 a')
    expect(press(crepe, 'Mod-ArrowUp')).toBe(true)
    expect(folded(root)).toBe(1)
    expect(press(crepe, 'Mod-ArrowUp')).toBe(true) // already folded: consumed no-op, never a doc jump
    expect(folded(root)).toBe(1)
    expect(press(crepe, 'Mod-ArrowDown')).toBe(true)
    expect(folded(root)).toBe(0)
    expect(md(crepe)).toBe(before)
    await new Promise((r) => setTimeout(r, 300))
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
  })

  it('is a consumed no-op on a leaf and falls through outside lists (native doc jump keeps working)', async () => {
    const { crepe, root } = await mount(`Intro\n\n${OUTLINE}`)
    caretIn(crepe, 'L3 a')
    expect(press(crepe, 'Mod-ArrowUp')).toBe(true)
    expect(press(crepe, 'Mod-ArrowDown')).toBe(true)
    expect(folded(root)).toBe(0)
    caretIn(crepe, 'Intro')
    expect(press(crepe, 'Mod-ArrowUp')).toBe(false)
    expect(press(crepe, 'Mod-ArrowDown')).toBe(false)
  })

  it('folds an image bullet to its chip from the caret and unfolds it (YAZ-1709); a text-only leaf stays a no-op', async () => {
    const { crepe, root } = await mount(`* ![Shot](a.png)\n* L1 b\n`, { image: { root: '/v', notePath: '/v/n.md' } })
    const imagePos = crepe.editor.action((ctx) => {
      let found = -1
      ctx.get(editorViewCtx).state.doc.descendants((node, pos) => {
        if (found === -1 && node.type.name === 'image') found = pos
        return found === -1
      })
      return found
    })
    select(crepe, imagePos) // the caret just before the image, inside the bullet's only paragraph
    expect(press(crepe, 'Mod-ArrowUp')).toBe(true)
    expect(chips(root)).toBe(1)
    expect(folded(root)).toBe(0)
    expect(press(crepe, 'Mod-ArrowDown')).toBe(true)
    expect(chips(root)).toBe(0)
    caretIn(crepe, 'L1 b')
    expect(press(crepe, 'Mod-ArrowUp')).toBe(true) // consumed, nothing to fold
    expect(chips(root)).toBe(0)
    expect(folded(root)).toBe(0)
  })

  it('Mod-z right after Mod-ArrowUp reverts that fold (GRO-2075 path)', async () => {
    const { crepe, root } = await mount()
    caretIn(crepe, 'L1 a')
    press(crepe, 'Mod-ArrowUp')
    expect(folded(root)).toBe(1)
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(folded(root)).toBe(0)
  })
})
