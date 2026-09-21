/**
 * CMD+F find engine (YAZ-968): matches, highlight decorations, active-match cycling, and
 * fold-reveal — driven through the FindChannel exactly as the FindBar will drive it, against
 * the REAL `createCrepe()` editor (the outlineFolding.test.ts idiom).
 *
 * The contract under test (locked in YAZ-967's confirmed-contract comment):
 *  - case-insensitive literal matching, per-textblock, so marks never split a match;
 *  - all matches carry FIND_MATCH_CLASS, exactly one carries FIND_ACTIVE_CLASS too;
 *  - next/prev wrap; the first active match is the first at/after the selection;
 *  - collapsed folds hiding a match expand SILENTLY (⌘Z panic-undo untouched) and re-collapse
 *    when the query stops matching inside them;
 *  - close restores search-revealed folds EXCEPT those hiding the active match (the landing),
 *    clears every decoration, and puts the selection on the active match;
 *  - while zoomed, only matches inside the zoomed subtree count;
 *  - a whole search session never reaches `markdownUpdated` (the save path).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { getHeadingFoldKey, HEADING_FOLDED_ATTR, isHeadingCollapsed, undoLastHeadingFold } from '../outline/headingFolding'
import { OUTLINE_FOLDED_ATTR, undoLastFold } from '../outline/outlineFolding'
import { getOutlineFoldKey } from '../outline/outlineFoldKeys'
import { getZoomedItemPos } from '../outline/zoom'
import { createFindChannel, type FindChannel } from './findChannel'
import { FIND_ACTIVE_CLASS, FIND_MATCH_CLASS } from './findInPage'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(opts: Omit<CreateCrepeOptions, 'root'>): Promise<{ crepe: Crepe; root: HTMLElement; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  let view: EditorView | null = null
  crepe.editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  if (view === null) throw new Error('no editor view')
  return { crepe, root, view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** A mounted editor plus its channel, the way both hosts will wire it. */
async function mountFind(markdown: string, opts: Omit<CreateCrepeOptions, 'root' | 'find'> = {}) {
  const channel = createFindChannel()
  const { crepe, root, view } = await mount({ defaultValue: markdown, find: channel, ...opts })
  return { crepe, root, view, channel }
}

/** Absolute doc position of the first occurrence of `needle` (within one text node). */
const posOfText = (doc: ProseNode, needle: string): number => {
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.isText && node.text !== undefined) {
      const i = node.text.indexOf(needle)
      if (i !== -1) found = pos + i
    }
    return found === -1
  })
  if (found === -1) throw new Error(`"${needle}" not in doc`)
  return found
}

const matchEls = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(`.${FIND_MATCH_CLASS}`)]
const activeEls = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(`.${FIND_ACTIVE_CLASS}`)]
const foldedEls = (root: HTMLElement) => [...root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)]
const headingFoldedEls = (root: HTMLElement) => [...root.querySelectorAll(`[${HEADING_FOLDED_ATTR}="true"]`)]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The zoom test's keydown idiom: prosemirror-keymap reads key + keyCode off a real event. */
const press = (view: EditorView, key: string, keyCode: number, mod = false) => {
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, metaKey: mod, bubbles: true, cancelable: true }))
}

describe('matching and decorations', () => {
  it('finds case-insensitive literal matches and paints all of them, one active', async () => {
    const { root, channel } = await mountFind('apple Apple APPLE banana')
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState()).toMatchObject({ total: 3, activeIndex: 0 })
    expect(matchEls(root)).toHaveLength(3)
    expect(activeEls(root)).toHaveLength(1)
    expect(activeEls(root)[0].textContent).toBe('apple')
  })

  it('clears matches when the query empties', async () => {
    const { root, channel } = await mountFind('apple apple')
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState().total).toBe(2)
    channel.setQuery('')
    expect(channel.getState()).toMatchObject({ total: 0, activeIndex: -1 })
    expect(matchEls(root)).toHaveLength(0)
  })

  it('matches across mark boundaries within a block', async () => {
    const { root, channel } = await mountFind('say wo**rld** now')
    channel.open()
    channel.setQuery('world')
    expect(channel.getState().total).toBe(1)
    expect(matchEls(root).map((el) => el.textContent).join('')).toBe('world')
  })

  it('recomputes matches when the document changes mid-search', async () => {
    const { view, channel } = await mountFind('apple banana')
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState().total).toBe(1)
    view.dispatch(view.state.tr.insertText('apple ', posOfText(view.state.doc, 'banana')))
    expect(channel.getState().total).toBe(2)
  })
})

describe('cycling', () => {
  it('starts at the first match after the selection and wraps both ways', async () => {
    const { view, channel } = await mountFind('apple one apple two apple three')
    const afterFirst = posOfText(view.state.doc, 'one')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, afterFirst)))
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState().activeIndex).toBe(1)
    channel.next()
    expect(channel.getState().activeIndex).toBe(2)
    channel.next()
    expect(channel.getState().activeIndex).toBe(0)
    channel.prev()
    expect(channel.getState().activeIndex).toBe(2)
  })
})

describe('fold reveal', () => {
  const FOLDED_DOC = `* Parent
  * hidden apple
* visible banana
`

  it('expands a collapsed fold that hides a match, silently (⌘Z stays free)', async () => {
    const { root, view, channel } = await mountFind(FOLDED_DOC, {
      folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0)]) },
    })
    expect(foldedEls(root).length).toBeGreaterThan(0)
    channel.open()
    channel.setQuery('apple')
    expect(foldedEls(root)).toHaveLength(0)
    // Silent: the reveal is not a revertible fold action — panic-undo has nothing to grab.
    expect(undoLastFold(view.state)).toBe(false)
  })

  it('re-collapses a revealed fold when the query stops matching inside it', async () => {
    const { root, channel } = await mountFind(FOLDED_DOC, {
      folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0)]) },
    })
    channel.open()
    channel.setQuery('apple')
    expect(foldedEls(root)).toHaveLength(0)
    channel.setQuery('banana')
    expect(foldedEls(root).length).toBeGreaterThan(0)
  })

  it('close restores revealed folds except the one hiding the active match, and lands the selection there', async () => {
    const doc = `* Parent
  * apple one
* Fruit
  * apple two
`
    const { root, view, channel } = await mountFind(doc, {
      folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0), getOutlineFoldKey('Fruit', 0)]) },
    })
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState()).toMatchObject({ total: 2, activeIndex: 0 })
    expect(foldedEls(root)).toHaveLength(0)
    channel.close()
    // The landing (Parent, hiding the active match) stays open; Fruit folds back.
    const folded = foldedEls(root)
    expect(folded).toHaveLength(1)
    expect(folded[0].textContent).toContain('apple two')
    expect(matchEls(root)).toHaveLength(0)
    expect(channel.getState().open).toBe(false)
    expect(view.state.selection.from).toBe(posOfText(view.state.doc, 'apple one'))
  })
})

/** The heading twin (YAZ-1140): a collapsed SECTION hides matches the same way a collapsed bullet does. */
describe('heading fold reveal', () => {
  const FOLDED_HEADINGS = `# Alpha

hidden apple

# Beta

visible banana
`
  /** `Alpha` is the doc's first node, so its section folds from position 0. */
  const ALPHA = 0

  it('expands a collapsed heading section that hides a match, silently (⌘Z stays free)', async () => {
    const { root, view, channel } = await mountFind(FOLDED_HEADINGS, {
      headingFolding: { seedCollapsedKeys: () => new Set([getHeadingFoldKey('Alpha', 0)]) },
    })
    expect(headingFoldedEls(root).length).toBeGreaterThan(0)
    channel.open()
    channel.setQuery('apple')
    expect(headingFoldedEls(root)).toHaveLength(0)
    // Silent: the reveal is not a revertible fold action — panic-undo has nothing to grab.
    expect(undoLastHeadingFold(view.state)).toBe(false)
  })

  it('re-collapses a revealed heading section when the query stops matching inside it', async () => {
    const { root, view, channel } = await mountFind(FOLDED_HEADINGS, {
      headingFolding: { seedCollapsedKeys: () => new Set([getHeadingFoldKey('Alpha', 0)]) },
    })
    channel.open()
    channel.setQuery('apple')
    expect(isHeadingCollapsed(view.state, ALPHA)).toBe(false)
    channel.setQuery('banana')
    expect(isHeadingCollapsed(view.state, ALPHA)).toBe(true)
    expect(headingFoldedEls(root).length).toBeGreaterThan(0)
  })
})

describe('zoom', () => {
  it('only matches inside the zoomed subtree while zoomed', async () => {
    const doc = `* Alpha here
  * apple in zoom
* Beta
  * apple outside
`
    const { view, channel } = await mountFind(doc, { zoom: { fileName: 'notes.md' } })
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState().total).toBe(2)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posOfText(view.state.doc, 'Alpha'))))
    press(view, '.', 190, true) // Mod-. zooms into the caret's item
    expect(getZoomedItemPos(view.state)).not.toBeNull()
    channel.setQuery('apple')
    expect(channel.getState().total).toBe(1)
  })
})

describe('escape and the save path', () => {
  it('Escape in the editor closes an open find', async () => {
    const { view, channel } = await mountFind('apple')
    channel.open()
    channel.setQuery('apple')
    press(view, 'Escape', 27)
    expect(channel.getState().open).toBe(false)
  })

  it('a whole search session never reaches markdownUpdated and leaves the markdown unchanged', async () => {
    const onMarkdownUpdated = vi.fn()
    const doc = `* Parent
  * hidden apple
* apple two
`
    const { crepe, channel } = await mountFind(doc, {
      onMarkdownUpdated,
      folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0)]) },
    })
    const before = getMarkdownForSave(crepe)
    channel.open()
    channel.setQuery('apple')
    channel.next()
    channel.prev()
    channel.close()
    await sleep(400) // outlast the listener's ~200ms debounce
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
    expect(getMarkdownForSave(crepe)).toBe(before)
  })
})
