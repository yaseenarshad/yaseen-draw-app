/**
 * YAZ-1751 (3A): the approved whole-line-selection scenario matrix, one `it` per S-number.
 *
 * This is the file a future agent reads to know what "correct" meant for YAZ-1734. It drives the
 * REAL editor (`createCrepe`) with KeyboardEvents through ProseMirror's `handleKeyDown` (so
 * Crepe's keymaps and `lineKeymap` take part in priority order) and asserts selection positions
 * plus, after a plain ⌫, the bytes `getMarkdownForSave` would write. The behaviour rules
 * themselves are the CONTRACTS Keyboard row for `Shift-ArrowUp` / `Shift-ArrowDown`
 * (`docs/CONTRACTS.md`); the unit-level tests are in `lineSelection.test.ts`. This file is
 * deliberately flat — a matrix, not a suite.
 *
 * Docs are shorter equivalents of the demo vault's texts with the SAME structure (indents,
 * headings, folds). Markdown normalises on the way out (`* ` markers, 2-space nesting).
 *
 * Tests named `(pinned observation)` record what the editor does today without judging it; the
 * one-line comment inside each states the observation verbatim for the contract row.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe } from './createCrepe'
import { caretIn, emptyTextblockPos, endOf, md, mount, nodePos, posOf, pressKey, runCommand, select, selection, typeText, unmountAll } from './marks/markTestKit'
import { isBulletsOnly, lockToBullets, outlineFeatures } from './outline/bulletsOnly'
import { setHeadingFoldAtSelection } from './outline/headingFolding'
import { toggleOutlineFold } from './outline/outlineFolding'
import { getZoomedItemPos } from './outline/zoom'

// ---- harness (lifted from lineSelection.test.ts; kept minimal) ----------------------------------

const outlineMounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

afterEach(async () => {
  await unmountAll()
  for (const m of outlineMounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** The folder page's editor, mounted the way `views/view/OutlineEditor.tsx` does (S23). */
async function mountOutline(markdown: string): Promise<Crepe> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, features: outlineFeatures })
  lockToBullets(crepe)
  await crepe.create()
  outlineMounted.push({ crepe, root })
  return crepe
}

const shiftDown = (crepe: Crepe) => pressKey(crepe, 'ArrowDown', { shift: true })
const shiftUp = (crepe: Crepe) => pressKey(crepe, 'ArrowUp', { shift: true })
const backspace = (crepe: Crepe) => pressKey(crepe, 'Backspace')
const enter = (crepe: Crepe) => pressKey(crepe, 'Enter')

/** Name of the textblock the selection head sits in (for the pinned observations). */
const headNode = (crepe: Crepe) =>
  crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection.$head.parent.type.name)

/** Fold the bullet whose own text is `text` (item pos = text pos - paragraph open - item open). */
const fold = (crepe: Crepe, text: string) => expect(runCommand(crepe, toggleOutlineFold(posOf(crepe, text) - 2))).toBe(true)

/** Fold the heading section whose heading text is `text`. */
const foldHeading = (crepe: Crepe, text: string) => {
  caretIn(crepe, text)
  expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
}

/** Zoom into the bullet whose own text is `text` (⌘. is the zoom hotkey). */
const zoom = (crepe: Crepe, text: string) => {
  caretIn(crepe, text)
  expect(pressKey(crepe, '.', { mod: true })).toBe(true)
  expect(crepe.editor.action((ctx) => getZoomedItemPos(ctx.get(editorViewCtx).state))).toBe(posOf(crepe, text) - 2)
}

// ---- 01 Paragraphs ------------------------------------------------------------------------------

const PARAS = 'L1\n\nL2\n\nL3-head tail\n\nL4\n\nL5\n'
const L3 = 'L3-head tail'

describe('01 Paragraphs', () => {
  it('S1 start L1, ⇧↓ → [start L1, start L2]; ⌫ → L1 gone, L2 intact', async () => {
    const { crepe } = await mount(PARAS)
    select(crepe, posOf(crepe, 'L1'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'L1'), head: posOf(crepe, 'L2') })
    expect(backspace(crepe)).toBe(true)
    expect(md(crepe)).toBe('L2\n\nL3-head tail\n\nL4\n\nL5\n')
  })

  it('S2 start L1, ⇧↓×3 → head = start L4 (exactly L1–L3)', async () => {
    const { crepe } = await mount(PARAS)
    select(crepe, posOf(crepe, 'L1'))
    shiftDown(crepe)
    shiftDown(crepe)
    shiftDown(crepe)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'L1'), head: posOf(crepe, 'L4') })
    backspace(crepe)
    expect(md(crepe)).toBe('L4\n\nL5\n')
  })

  it('S3 end L5, ⇧↑ → head = end L4; ⌫ → L5 gone, L4 intact', async () => {
    const { crepe } = await mount(PARAS)
    select(crepe, endOf(crepe, 'L5'))
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'L5'), head: endOf(crepe, 'L4') })
    backspace(crepe)
    expect(md(crepe)).toBe('L1\n\nL2\n\nL3-head tail\n\nL4\n')
  })

  it('S4 end L5, ⇧↑×3 → head = end L2', async () => {
    const { crepe } = await mount(PARAS)
    select(crepe, endOf(crepe, 'L5'))
    shiftUp(crepe)
    shiftUp(crepe)
    shiftUp(crepe)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'L5'), head: endOf(crepe, 'L2') })
  })

  it('S5 start of a ~300-char paragraph, ⇧↓ → head = start of the NEXT paragraph (the whole block, not a visual row)', async () => {
    const long = 'lorem ipsum '.repeat(25).trim() // 299 chars
    const { crepe } = await mount(`L1\n\n${long}\n\nL3\n`)
    select(crepe, posOf(crepe, long))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, long), head: posOf(crepe, 'L3') })
    backspace(crepe)
    expect(md(crepe)).toBe('L1\n\nL3\n')
  })

  it('S6 an empty paragraph between two lines: ⇧↓ = [its start, start next]; ⇧↑ = [its end, end prev]; ⌫ after ⇧↓ → neighbours adjacent', async () => {
    const { crepe } = await mount('above\n\n<br />\n\nbelow\n')
    const empty = emptyTextblockPos(crepe)
    select(crepe, empty)
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: empty, head: endOf(crepe, 'above') })
    select(crepe, empty)
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: empty, head: posOf(crepe, 'below') })
    backspace(crepe)
    expect(md(crepe)).toBe('above\n\nbelow\n')
  })

  it('S6b caret mid L3, ⇧↓ → head = end L3; ⇧↓ → end L4; ⌫ → "L3-head" + nothing of L4; L5 intact', async () => {
    const { crepe } = await mount(PARAS)
    const cut = endOf(crepe, 'L3-head')
    select(crepe, cut)
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: cut, head: endOf(crepe, L3) })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: cut, head: endOf(crepe, 'L4') })
    backspace(crepe)
    expect(md(crepe)).toBe('L1\n\nL2\n\nL3-head\n\nL5\n')
  })

  it('S6c caret mid L3, ⇧↑ → head = start L3; ⇧↑ → start L2', async () => {
    const { crepe } = await mount(PARAS)
    const cut = endOf(crepe, 'L3-head')
    select(crepe, cut)
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: cut, head: posOf(crepe, L3) })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: cut, head: posOf(crepe, 'L2') })
  })
})

// ---- 02 Bullets ---------------------------------------------------------------------------------

const BULLETS = [
  '* Parent A',
  '  * Child A1',
  '  * Child A2',
  '    * Grandchild A2a',
  '    * Grandchild A2b',
  '  * Child A3',
  '* Parent B',
  '  * Child B1 long text that goes on',
  '* Parent C',
  '*',
  '* Parent E',
  '* [ ] A task item',
  '* [x] A done task item',
  '* Parent F',
  '',
  'A paragraph after the list',
  '',
].join('\n')
const B1 = 'Child B1 long text that goes on'

describe('02 Bullets', () => {
  it('S7 start "Child A3", ⇧↓ → head = start "Parent B" (only A3 selected)', async () => {
    const { crepe } = await mount(BULLETS)
    select(crepe, posOf(crepe, 'Child A3'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Child A3'), head: posOf(crepe, 'Parent B') })
  })

  it('S8 start "Parent A", ⇧↓ → head = start "Child A1"; ⌫ → A1, A2 (A2a/A2b still under it), A3 top-level; Parent A gone', async () => {
    const { crepe } = await mount(BULLETS)
    select(crepe, posOf(crepe, 'Parent A'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Parent A'), head: posOf(crepe, 'Child A1') })
    backspace(crepe)
    expect(md(crepe)).toBe(
      [
        '* Child A1',
        '* Child A2',
        '  * Grandchild A2a',
        '  * Grandchild A2b',
        '* Child A3',
        '* Parent B',
        '  * Child B1 long text that goes on',
        '* Parent C',
        '*',
        '* Parent E',
        '* [ ] A task item',
        '* [x] A done task item',
        '* Parent F',
        '',
        'A paragraph after the list',
        '',
      ].join('\n'),
    )
  })

  it('S9 end "Child B1", ⇧↑ → head = end "Parent B"; ⌫ → Child B1 gone, Parent B intact', async () => {
    const { crepe } = await mount(BULLETS)
    select(crepe, endOf(crepe, B1))
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, B1), head: endOf(crepe, 'Parent B') })
    backspace(crepe)
    expect(md(crepe)).toContain('* Parent B\n* Parent C\n')
    expect(md(crepe)).not.toContain('Child B1')
    expect(md(crepe)).toContain('* Parent A\n  * Child A1\n')
  })

  it('S9b mid "Child B1", ⇧↓ → head = end "Child B1"', async () => {
    const { crepe } = await mount(BULLETS)
    const cut = endOf(crepe, 'Child B1')
    select(crepe, cut)
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: cut, head: endOf(crepe, B1) })
  })

  it('S10 the empty bullet: ⇧↓ → [its start, start "Parent E"]; ⇧↑ → [its end, end "Parent C"]', async () => {
    const { crepe } = await mount(BULLETS)
    const empty = emptyTextblockPos(crepe)
    select(crepe, empty)
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: empty, head: posOf(crepe, 'Parent E') })
    select(crepe, empty)
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: empty, head: endOf(crepe, 'Parent C') })
  })

  it('S11 start "[ ] A task item" text, ⇧↓ → only that item (head = start of the done item\'s text)', async () => {
    const { crepe } = await mount(BULLETS)
    select(crepe, posOf(crepe, 'A task item'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'A task item'), head: posOf(crepe, 'A done task item') })
  })

  it('S12 start "Parent F", ⇧↓ → head = start of the paragraph after the list; ⌫ → Parent F gone, paragraph still a paragraph', async () => {
    const { crepe } = await mount(BULLETS)
    select(crepe, posOf(crepe, 'Parent F'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Parent F'), head: posOf(crepe, 'A paragraph after the list') })
    backspace(crepe)
    expect(md(crepe)).not.toContain('Parent F')
    expect(md(crepe)).toMatch(/\* \[x\] A done task item\n\nA paragraph after the list\n$/)
  })
})

// ---- 03 Mixed -----------------------------------------------------------------------------------

describe('03 Mixed', () => {
  it('S13 start of `## A heading`, ⇧↓ → start of the paragraph under it; ⌫ → that paragraph is still a paragraph', async () => {
    const { crepe } = await mount('## A heading\n\nunder it\n\nlast\n')
    select(crepe, posOf(crepe, 'A heading'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'A heading'), head: posOf(crepe, 'under it') })
    backspace(crepe)
    expect(md(crepe)).toBe('under it\n\nlast\n')
  })

  it('S14 paragraph → `> quote` → paragraph: ⇧↓ → start of the quote\'s text, ⇧↓ → start of the next paragraph', async () => {
    const { crepe } = await mount('first\n\n> quoted\n\nthird\n')
    select(crepe, posOf(crepe, 'first'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'first'), head: posOf(crepe, 'quoted') })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'first'), head: posOf(crepe, 'third') })
  })

  it('S15 paragraph, `---`, paragraph: ⇧↓ from above returns false and leaves the selection; ⇧↑ from below likewise', async () => {
    const { crepe } = await mount('above\n\n---\n\nbelow\n')
    select(crepe, posOf(crepe, 'above'))
    expect(shiftDown(crepe)).toBe(false)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'above'), head: posOf(crepe, 'above') })
    select(crepe, endOf(crepe, 'below'))
    expect(shiftUp(crepe)).toBe(false)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'below'), head: endOf(crepe, 'below') })
  })

  it('S15b `---` two blocks away: from the first paragraph the second is the neighbour (true); from the second the rule is next (false); ⇧↑ from the second is unaffected', async () => {
    const { crepe } = await mount('first\n\nsecond\n\n---\n\nbelow\n')
    select(crepe, posOf(crepe, 'first'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'first'), head: posOf(crepe, 'second') })
    select(crepe, posOf(crepe, 'second'))
    expect(shiftDown(crepe)).toBe(false)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'second'), head: posOf(crepe, 'second') })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'second'), head: posOf(crepe, 'first') })
    select(crepe, endOf(crepe, 'below'))
    expect(shiftUp(crepe)).toBe(false)
  })

  it('S16 `![tiny](x.png)` between two paragraphs: ⇧↓ → start of the image paragraph (it is a line); ⇧↓ → start of the paragraph below', async () => {
    const { crepe } = await mount('above\n\n![tiny](x.png)\n\nbelow\n')
    // The inline image is the paragraph's first child, so its position is the paragraph's start.
    const imageParaStart = nodePos(crepe, 'image')
    select(crepe, posOf(crepe, 'above'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'above'), head: imageParaStart })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'above'), head: posOf(crepe, 'below') })
  })

  it('S17 (pinned observation) paragraph above a fenced code block, ⇧↓ from its start', async () => {
    const { crepe } = await mount('above\n\n```\nsome code\n```\n\nbelow\n')
    select(crepe, posOf(crepe, 'above'))
    // OBSERVED: returns true; head lands at the START of the code block's text (node = `code_block`) — a fenced code block is a textblock, so it counts as a line.
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'above'), head: posOf(crepe, 'some code') })
    expect(headNode(crepe)).toBe('code_block')
  })

  it('S18 (pinned observation) paragraph above a table, ⇧↓ from its start', async () => {
    const { crepe } = await mount('above\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |\n\nbelow\n')
    select(crepe, posOf(crepe, 'above'))
    // OBSERVED: returns true, but the head never enters the table — `lineKeymap` sets [start above, start of the first header cell's text], then prosemirror-tables' `tableEditing` `normalizeSelection` (`isTextSelectionAcrossCells`, dist/index.js:742) rewrites it in the same dispatch to `[$from.start(), $from.end()]`: the selection is exactly the paragraph above (anchor = its start, head = its END, node = `paragraph`).
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'above'), head: endOf(crepe, 'above') })
    expect(headNode(crepe)).toBe('paragraph')
  })
})

// ---- 04 Edges -----------------------------------------------------------------------------------

describe('04 Edges', () => {
  it('S19 `# Title` then one body paragraph: start of body, ⇧↑ → head = start of the heading', async () => {
    const { crepe } = await mount('# Title\n\nbody\n')
    select(crepe, posOf(crepe, 'body'))
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'body'), head: posOf(crepe, 'Title') })
  })

  it('S20 end of the last paragraph, ⇧↓ → true, selection unchanged', async () => {
    const { crepe } = await mount('one\n\ntwo\n\nthree\n')
    select(crepe, endOf(crepe, 'three'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'three'), head: endOf(crepe, 'three') })
  })

  it('S21 only `# Title` and one line: ⇧↓ from the line → true, unchanged; ⇧↑ → the title', async () => {
    const { crepe } = await mount('# Title\n\nline\n')
    select(crepe, posOf(crepe, 'line'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'line'), head: posOf(crepe, 'line') })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'line'), head: posOf(crepe, 'Title') })
  })

  it('S22 empty doc: ⇧↓ and ⇧↑ do not throw', async () => {
    const { crepe } = await mount('')
    expect(() => shiftDown(crepe)).not.toThrow()
    expect(() => shiftUp(crepe)).not.toThrow()
  })
})

// ---- 05 Folder page -----------------------------------------------------------------------------

describe('05 Folder page (bullets-only editor)', () => {
  it('S23 three top-level bullets: start of the first, ⇧↓ → start of the second; ⌫ → first gone, doc still bullets-only', async () => {
    const crepe = await mountOutline('* one\n* two\n* three\n')
    select(crepe, posOf(crepe, 'one'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'one'), head: posOf(crepe, 'two') })
    backspace(crepe)
    expect(md(crepe)).toBe('* two\n* three\n')
    expect(crepe.editor.action((ctx) => isBulletsOnly(ctx.get(editorViewCtx).state.doc))).toBe(true)
  })

  it('S23-parent (pinned observation) a parent with a child: start of the parent, ⇧↓ (→ child start), ⌫', async () => {
    const crepe = await mountOutline('* parent\n  * child\n* after\n')
    select(crepe, posOf(crepe, 'parent'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'parent'), head: posOf(crepe, 'child') })
    backspace(crepe)
    // OBSERVED: the parent becomes an EMPTY bullet that keeps its kid (`*` / `  * child`), the doc stays bullets-only, caret at the start of "child" — NOT the note editor's D3 lift (S8). Matches the scope's expectation for the folder page.
    expect(md(crepe)).toBe('*\n  * child\n* after\n')
    expect(crepe.editor.action((ctx) => isBulletsOnly(ctx.get(editorViewCtx).state.doc))).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'child'), head: posOf(crepe, 'child') })
  })
})

// ---- 06 Reverse (D5: a press never crosses the anchor) -----------------------------------------

const FIVE = 'L1\n\nL2\n\nL3\n\nL4\n\nL5\n'

describe('06 Reverse (D5)', () => {
  it('06-chain-mid mid L2: ⇧↓×2 → end L3; ⇧↑ → end L2; ⇧↑ → anchor; ⇧↑ → start L2; ⇧↑ → start L1; ⇧↓×4 unwinds back to end L3', async () => {
    const { crepe } = await mount(FIVE)
    caretIn(crepe, 'L2')
    const { anchor } = selection(crepe)
    expect(shiftDown(crepe)).toBe(true)
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: endOf(crepe, 'L3') })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: endOf(crepe, 'L2') })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: anchor })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'L2') })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'L1') })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'L2') })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: anchor })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: endOf(crepe, 'L2') })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: endOf(crepe, 'L3') })
  })

  it('06-chain-whole start of A (line above, then A, B, C): ⇧↓×2 → start C; ⇧↑×2 → collapsed; ⇧↑ → start of the line above', async () => {
    const { crepe } = await mount('above\n\nA\n\nB\n\nC\n')
    const anchor = posOf(crepe, 'A')
    select(crepe, anchor)
    expect(shiftDown(crepe)).toBe(true)
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'C') })
    expect(shiftUp(crepe)).toBe(true)
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: anchor })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'above') })
  })

  it('06-first-line mid L1: ⇧↓ → end L1; ⇧↑ → collapsed on the anchor; ⇧↑ → start L1; ⇧↑ → true, unchanged', async () => {
    const { crepe } = await mount(FIVE)
    caretIn(crepe, 'L1')
    const { anchor } = selection(crepe)
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: endOf(crepe, 'L1') })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: anchor })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'L1') })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'L1') })
  })

  it('06-last-line mid L5: ⇧↑ → start L5; ⇧↓ → collapsed on the anchor; ⇧↓ → end L5; ⇧↓ → true, unchanged', async () => {
    const { crepe } = await mount(FIVE)
    caretIn(crepe, 'L5')
    const { anchor } = selection(crepe)
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'L5') })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: anchor })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: endOf(crepe, 'L5') })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: endOf(crepe, 'L5') })
  })
})

// ---- 07 Folded ----------------------------------------------------------------------------------

const FOLDED = '* Parent A\n  * Child A1\n  * Child A2\n    * Grandchild A2a\n* Sibling B\n* Sibling C\n\nafter\n'
const A_KIDS = '  * Child A1\n  * Child A2\n    * Grandchild A2a\n'
/** "Parent A"-head: the caret after `Parent`, before ` A`. */
const midParentA = (crepe: Crepe) => endOf(crepe, 'Parent')

describe('07 Folded (Parent A folded)', () => {
  it('S-F1 mid "Parent A", ⇧↓ → end "Parent A" (own edge); ⇧↓ → end "Sibling B" (hidden kids skipped); ⌫ → head kept, kids still under it, B gone, C intact', async () => {
    const { crepe } = await mount(FOLDED)
    fold(crepe, 'Parent A')
    const cut = midParentA(crepe)
    select(crepe, cut)
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: cut, head: endOf(crepe, 'Parent A') })
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: cut, head: endOf(crepe, 'Sibling B') })
    expect(backspace(crepe)).toBe(true)
    expect(md(crepe)).toBe(`* Parent\n${A_KIDS}* Sibling C\n\nafter\n`)
  })

  it('S-F2 end "Parent A", ⇧↓ → end "Sibling B"; ⌫ → Sibling B gone; A + kids intact', async () => {
    const { crepe } = await mount(FOLDED)
    fold(crepe, 'Parent A')
    select(crepe, endOf(crepe, 'Parent A'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'Parent A'), head: endOf(crepe, 'Sibling B') })
    backspace(crepe)
    expect(md(crepe)).toBe(`* Parent A\n${A_KIDS}* Sibling C\n\nafter\n`)
  })

  it('S-F3 start "Parent A", ⇧↓ → start "Sibling B"; ⌫ → Parent A\'s line gone, A1 and A2 (with A2a) top-level, B, C intact', async () => {
    const { crepe } = await mount(FOLDED)
    fold(crepe, 'Parent A')
    select(crepe, posOf(crepe, 'Parent A'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Parent A'), head: posOf(crepe, 'Sibling B') })
    backspace(crepe)
    expect(md(crepe)).toBe('* Child A1\n* Child A2\n  * Grandchild A2a\n* Sibling B\n* Sibling C\n\nafter\n')
  })

  it('S-F4 end "Sibling B", ⇧↑ → end "Parent A"; ⌫ → B gone; A + kids intact', async () => {
    const { crepe } = await mount(FOLDED)
    fold(crepe, 'Parent A')
    select(crepe, endOf(crepe, 'Sibling B'))
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'Sibling B'), head: endOf(crepe, 'Parent A') })
    backspace(crepe)
    expect(md(crepe)).toBe(`* Parent A\n${A_KIDS}* Sibling C\n\nafter\n`)
  })

  it('S-F5 mid "Parent A", ⇧↓×3 (→ end "Sibling C"), type `x` → "Parent"+x, kids still under A, B and C gone', async () => {
    const { crepe } = await mount(FOLDED)
    fold(crepe, 'Parent A')
    select(crepe, midParentA(crepe))
    shiftDown(crepe)
    shiftDown(crepe)
    shiftDown(crepe)
    expect(selection(crepe).head).toBe(endOf(crepe, 'Sibling C'))
    expect(typeText(crepe, 'x')).toBe(true)
    expect(md(crepe)).toBe(`* Parentx\n${A_KIDS}\nafter\n`)
  })

  it('S-F6 UNFOLDED control: start "Parent A", ⇧↓ → start "Child A1"; ⌫ → the same markdown as S-F3', async () => {
    const { crepe } = await mount(FOLDED)
    select(crepe, posOf(crepe, 'Parent A'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Parent A'), head: posOf(crepe, 'Child A1') })
    backspace(crepe)
    expect(md(crepe)).toBe('* Child A1\n* Child A2\n  * Grandchild A2a\n* Sibling B\n* Sibling C\n\nafter\n')
  })

  it('S-F7 `## Section one` (folded, two paragraphs) then `## Section two`: start of one, ⇧↓ → start of two; ⌫ → heading gone, its paragraphs present, two intact', async () => {
    const { crepe } = await mount('## Section one\n\npara one a\n\npara one b\n\n## Section two\n\npara two\n')
    foldHeading(crepe, 'Section one')
    select(crepe, posOf(crepe, 'Section one'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Section one'), head: posOf(crepe, 'Section two') })
    backspace(crepe)
    expect(md(crepe)).toBe('para one a\n\npara one b\n\n## Section two\n\npara two\n')
  })

  it('S-F8 start "Parent A" → mid "Sibling B" (set directly), ⌫: A\'s line goes as a node, B keeps only its tail, kids lifted; caret at the start of the first lifted kid', async () => {
    // The one delete branch the ⇧↓ walks never reach: `to` mid-way through the last block, `from` at the first block's start.
    const { crepe } = await mount('* Parent A\n  * Child A1\n  * Child A2\n* Bhead Btail\n')
    fold(crepe, 'Parent A')
    select(crepe, posOf(crepe, 'Parent A'), posOf(crepe, 'Btail'))
    expect(backspace(crepe)).toBe(true)
    expect(md(crepe)).toBe('* Child A1\n* Child A2\n* Btail\n')
    // `Selection.near` after the node delete: the nearest text position forward of the cut is the first lifted kid's start.
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Child A1'), head: posOf(crepe, 'Child A1') })
  })

  it('S-F9 start "Parent A", ⇧↓ → start "Sibling B"; Enter (D7, no join): A\'s line goes, kids lift, then the ordinary Enter splits at the first kid\'s start — an empty item above it; B, C intact', async () => {
    const { crepe } = await mount(FOLDED)
    fold(crepe, 'Parent A')
    select(crepe, posOf(crepe, 'Parent A'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Parent A'), head: posOf(crepe, 'Sibling B') })
    expect(enter(crepe)).toBe(true)
    expect(md(crepe)).toBe('*\n* Child A1\n* Child A2\n  * Grandchild A2a\n* Sibling B\n* Sibling C\n\nafter\n')
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Child A1'), head: posOf(crepe, 'Child A1') })
  })
})

// ---- 08 Zoomed ----------------------------------------------------------------------------------

const ZOOMED = '* Above\n* Zoom into me\n  * Inside one\n  * Inside two\n  * Inside three\n* Below\n'

describe('08 Zoomed (into "Zoom into me")', () => {
  it('S-Z1 end "Inside three", ⇧↓ → true, unchanged', async () => {
    const { crepe } = await mount(ZOOMED)
    zoom(crepe, 'Zoom into me')
    select(crepe, endOf(crepe, 'Inside three'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'Inside three'), head: endOf(crepe, 'Inside three') })
  })

  it('S-Z2 start "Inside three", ⇧↓ → true, unchanged', async () => {
    const { crepe } = await mount(ZOOMED)
    zoom(crepe, 'Zoom into me')
    select(crepe, posOf(crepe, 'Inside three'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Inside three'), head: posOf(crepe, 'Inside three') })
  })

  it('S-Z3 (pinned observation) start "Inside one", ⇧↑', async () => {
    const { crepe } = await mount(ZOOMED)
    zoom(crepe, 'Zoom into me')
    select(crepe, posOf(crepe, 'Inside one'))
    // OBSERVED: returns true and the head moves to the START of the zoomed item's OWN text ("Zoom into me") — that paragraph is inside the zoomed item's subtree, so it is visible and counts as the line above "Inside one".
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Inside one'), head: posOf(crepe, 'Zoom into me') })
    expect(headNode(crepe)).toBe('paragraph')
  })

  it('S-Z4 start "Inside one", ⇧↓×2 → start "Inside three"', async () => {
    const { crepe } = await mount(ZOOMED)
    zoom(crepe, 'Zoom into me')
    select(crepe, posOf(crepe, 'Inside one'))
    expect(shiftDown(crepe)).toBe(true)
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Inside one'), head: posOf(crepe, 'Inside three') })
  })
})

// ---- 09 Things to know --------------------------------------------------------------------------

describe('09 Things to know', () => {
  it('09-type-over-joins start "Replace me", ⇧↓, type `x` → "xThe next line…"', async () => {
    const { crepe } = await mount('Replace me\n\nThe next line stays\n')
    select(crepe, posOf(crepe, 'Replace me'))
    expect(shiftDown(crepe)).toBe(true)
    // No hidden line inside the range, so `visibleTypeOver`'s `handleTextInput` declines (false): in a
    // browser the DOM input event then types over the selection — ProseMirror's own path, not ours.
    expect(typeText(crepe, 'x')).toBe(false)
  })

  it('09-caret-after-delete start "Eat one", (⇧↓, ⌫)×3 → only "Keep me" left, caret at its start', async () => {
    const { crepe } = await mount('Eat one\n\nEat two\n\nEat three\n\nKeep me\n')
    select(crepe, posOf(crepe, 'Eat one'))
    for (let i = 0; i < 3; i++) {
      expect(shiftDown(crepe)).toBe(true)
      expect(backspace(crepe)).toBe(true)
    }
    expect(md(crepe)).toBe('Keep me\n')
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'Keep me'), head: posOf(crepe, 'Keep me') })
  })
})
