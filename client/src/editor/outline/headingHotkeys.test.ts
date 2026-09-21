/**
 * Heading fold hotkeys (YAZ-1140, 3B). Contract tests written FIRST (Fable) — headingHotkeys.ts
 * must pass these unchanged. Keys go through ProseMirror's `handleKeyDown` like hotkeys.test.ts, so
 * the WHOLE chain runs in registration order: the ⌘Z cases below pin the cross-plugin protocol
 * (heading handler registered before the bullet one, each declining when it has no pending undo).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { HEADING_FOLDED_ATTR, HEADING_TOGGLE_CLASS } from './headingFolding'
import { OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS } from './outlineFolding'

const DOC = `# Part 1

Intro paragraph.

## Section A

Alpha body.

## Section B

Beta body.
`

const MIXED = `# Top

Intro.

* Parent
  * Child

Tail.
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
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

type Key = 'Mod-z' | 'Mod-Shift-u' | 'Mod-Shift-i' | 'Mod-ArrowUp' | 'Mod-ArrowDown'
const NAMED_KEY_CODES: Record<string, number> = { ArrowUp: 38, ArrowDown: 40 }

function press(crepe: Crepe, key: Key): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const letter = key.slice(key.lastIndexOf('-') + 1)
    const named = letter.length > 1
    const init: KeyboardEventInit & { keyCode?: number } = {
      key: named ? letter : letter.toUpperCase(),
      code: named ? letter : `Key${letter.toUpperCase()}`,
      keyCode: NAMED_KEY_CODES[letter] ?? letter.toUpperCase().charCodeAt(0),
      ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }),
      shiftKey: key.includes('Shift'),
      bubbles: true,
      cancelable: true,
    }
    const event = new KeyboardEvent('keydown', init)
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
}

function caretIn(crepe: Crepe, text: string): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let pos = -1
    view.state.doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index + text.length
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  })
}

const headingToggle = (root: HTMLElement, label: string): HTMLButtonElement => {
  const btn = [...root.querySelectorAll<HTMLButtonElement>(`.${HEADING_TOGGLE_CLASS}`)].find((b) =>
    b.getAttribute('aria-label')?.endsWith(` ${label}`),
  )
  if (!btn) throw new Error(`no heading toggle for "${label}"`)
  return btn
}
const headingFolded = (root: HTMLElement) => root.querySelectorAll(`[${HEADING_FOLDED_ATTR}="true"]`).length
const bulletFolded = (root: HTMLElement) => root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`).length

describe('Mod-ArrowUp / Mod-ArrowDown on headings', () => {
  it('folds and unfolds the section at the caret, leaving the markdown untouched', async () => {
    const { crepe, root } = await mount(DOC)
    const before = getMarkdownForSave(crepe)
    caretIn(crepe, 'Alpha body')

    expect(press(crepe, 'Mod-ArrowUp')).toBe(true)
    expect(headingToggle(root, 'Section A').getAttribute('aria-expanded')).toBe('false')
    expect(headingFolded(root)).toBeGreaterThan(0)

    expect(press(crepe, 'Mod-ArrowDown')).toBe(true)
    expect(headingToggle(root, 'Section A').getAttribute('aria-expanded')).toBe('true')
    expect(headingFolded(root)).toBe(0)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('inside a list the bullet handler keeps the key: the bullet folds, no heading folds', async () => {
    const { crepe, root } = await mount(MIXED)
    // On a LEAF item the bullet handler consumes ⌘↑ as a no-op (hotkeys.test.ts pins this) — the
    // heading handler must not grab the key even though the caret sits inside Top's section.
    caretIn(crepe, 'Child')
    expect(press(crepe, 'Mod-ArrowUp')).toBe(true)
    expect(bulletFolded(root)).toBe(0)
    expect(headingFolded(root)).toBe(0)
    // On a parent item the bullet fold applies as always.
    caretIn(crepe, 'Parent')
    expect(press(crepe, 'Mod-ArrowUp')).toBe(true)
    expect(bulletFolded(root)).toBe(1)
    expect(headingFolded(root)).toBe(0)
    expect(headingToggle(root, 'Top').getAttribute('aria-expanded')).toBe('true')
  })
})

describe('Mod-Shift-u / Mod-Shift-i across bullets and headings', () => {
  it('folds both kinds in one action and Mod-z restores both exact prior sets', async () => {
    const { crepe, root } = await mount(MIXED)
    const before = getMarkdownForSave(crepe)

    expect(press(crepe, 'Mod-Shift-u')).toBe(true)
    expect(headingFolded(root)).toBeGreaterThan(0)
    expect(bulletFolded(root)).toBe(1)

    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(headingFolded(root)).toBe(0)
    expect(bulletFolded(root)).toBe(0)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('unfolds both kinds in one action and Mod-z restores both exact prior sets', async () => {
    const { crepe, root } = await mount(MIXED)
    headingToggle(root, 'Top').click()
    root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)!.click()
    expect(headingFolded(root)).toBeGreaterThan(0)
    expect(bulletFolded(root)).toBe(1)

    expect(press(crepe, 'Mod-Shift-i')).toBe(true)
    expect(headingFolded(root)).toBe(0)
    expect(bulletFolded(root)).toBe(0)

    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(headingFolded(root)).toBeGreaterThan(0)
    expect(bulletFolded(root)).toBe(1)
  })
})

describe('Mod-z across fold kinds (the single-latest-view-action rule)', () => {
  it('reverts a heading fold made by the chevron', async () => {
    const { crepe, root } = await mount(DOC)
    headingToggle(root, 'Section A').click()
    expect(headingFolded(root)).toBeGreaterThan(0)
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(headingFolded(root)).toBe(0)
  })

  it('bullet fold then heading fold: Mod-z reverts only the heading fold', async () => {
    const { crepe, root } = await mount(MIXED)
    root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)!.click()
    headingToggle(root, 'Top').click()
    // The heading fold hid the bullet section too; reverting it brings the view back, with the
    // bullet fold still applied underneath.
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(headingFolded(root)).toBe(0)
    expect(bulletFolded(root)).toBe(1)
  })

  it('after Mod-z reverts the heading fold, a second Mod-z leaves the older bullet fold alone (D4 symmetry)', async () => {
    const { crepe, root } = await mount(MIXED)
    root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)!.click() // older view action
    headingToggle(root, 'Top').click() // newer view action — clears the bullet plugin's pending undo
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(headingFolded(root)).toBe(0)
    expect(bulletFolded(root)).toBe(1)
    // The bullet fold is no longer ⌘Z-reachable: a second ⌘Z must NOT resurrect/toggle it.
    press(crepe, 'Mod-z')
    expect(bulletFolded(root)).toBe(1)
  })

  it('heading fold then bullet fold: Mod-z reverts only the bullet fold', async () => {
    const { crepe, root } = await mount(MIXED)
    headingToggle(root, 'Top').click()
    headingToggle(root, 'Top').click()
    // Heading pending exists (an unfold is revertible too); the bullet fold is newer and takes ⌘Z.
    root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)!.click()
    expect(press(crepe, 'Mod-z')).toBe(true)
    expect(bulletFolded(root)).toBe(0)
    expect(headingFolded(root)).toBe(0)
  })
})
