/**
 * Whole-line selection (YAZ-1734), unit level: the real editor (`createCrepe`), `Shift-ArrowDown` /
 * `Shift-ArrowUp` dispatched through ProseMirror's `handleKeyDown` (so Crepe's keymaps and
 * `lineKeymap` take part in priority order), then the selection positions and — after a plain
 * `Backspace` — the serialised markdown (`getMarkdownForSave`) are asserted. The delete over a
 * fold-spanning range is `deleteVisible`'s own construction (D6) and the headless-item lift is
 * `liftHeadlessItems` (D3); an ordinary range takes ProseMirror's own `deleteRange`.
 *
 * The approved scenario matrix (S-numbers) is `lineSelection.scenarios.test.ts`; this file keeps
 * only what the matrix does not pin: the D3 list variants, walking out of / into a nested list,
 * ⇧↑ over hidden kids from the sibling's start, the `Delete` key, Enter (D7), the no-hidden-line
 * control, a node selection, and the anchor never moving.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { NodeSelection } from '@milkdown/kit/prose/state'
import { caretIn, endOf, md, mount, nodePos, posOf, pressKey, runCommand, select, selection, typeText, unmountAll } from './marks/markTestKit'
import { setHeadingFoldAtSelection } from './outline/headingFolding'
import { toggleOutlineFold } from './outline/outlineFolding'
import { deleteVisible } from './lineSelection'

afterEach(unmountAll)

const shiftDown = (crepe: Crepe) => pressKey(crepe, 'ArrowDown', { shift: true })
const shiftUp = (crepe: Crepe) => pressKey(crepe, 'ArrowUp', { shift: true })
const backspace = (crepe: Crepe) => pressKey(crepe, 'Backspace')
const forwardDelete = (crepe: Crepe) => pressKey(crepe, 'Delete')

/** Fold the parent bullet whose own text is `text` (item = text pos - paragraph open - item open). */
const foldItem = (crepe: Crepe, text: string) => expect(runCommand(crepe, toggleOutlineFold(posOf(crepe, text) - 2))).toBe(true)

const FIVE = 'l1\n\nl2\n\nl3\n\nl4\n\nl5\n'

describe('list items (D1: a line is the item\'s OWN paragraph; D3: children survive)', () => {
  const NESTED = '* parent\n  * child a\n  * child b\n* sibling\n'

  it('⇧↓ from the start of a parent lands on the start of its first child; ⌫ puts the children in its place, one level up (D3)', async () => {
    const { crepe } = await mount(NESTED)
    select(crepe, posOf(crepe, 'parent'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'parent'), head: posOf(crepe, 'child a') })
    backspace(crepe)
    // `deleteRange` alone leaves `list_item(bullet_list(...))` — `* * child a`; `liftHeadlessItems`
    // normalises it in the same dispatch. The caret stays on its line.
    expect(md(crepe)).toBe('* child a\n* child b\n* sibling\n')
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'child a'), head: posOf(crepe, 'child a') })
  })

  it('D3: a parent that is the FIRST item of a nested list — its children take its place at that level', async () => {
    const { crepe } = await mount('* top\n  * parent\n    * child a\n    * child b\n  * sib\n')
    select(crepe, posOf(crepe, 'parent'))
    expect(shiftDown(crepe)).toBe(true)
    backspace(crepe)
    expect(md(crepe)).toBe('* top\n  * child a\n  * child b\n  * sib\n')
  })

  it('D3: a parent in the middle of its list', async () => {
    const { crepe } = await mount('* before\n* parent\n  * c1\n  * c2\n* after\n')
    select(crepe, posOf(crepe, 'parent'))
    expect(shiftDown(crepe)).toBe(true)
    backspace(crepe)
    expect(md(crepe)).toBe('* before\n* c1\n* c2\n* after\n')
  })

  it('D3: grandchildren stay nested under their own child', async () => {
    const { crepe } = await mount('* parent\n  * child a\n    * grand a\n    * grand b\n  * child b\n* sibling\n')
    select(crepe, posOf(crepe, 'parent'))
    expect(shiftDown(crepe)).toBe(true)
    backspace(crepe)
    expect(md(crepe)).toBe('* child a\n  * grand a\n  * grand b\n* child b\n* sibling\n')
  })

  it('D3 is path-agnostic: any transaction that leaves an item without its paragraph is normalised', async () => {
    const { crepe } = await mount(NESTED)
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const $p = view.state.doc.resolve(posOf(crepe, 'parent'))
      view.dispatch(view.state.tr.delete($p.before(), $p.after()))
    })
    expect(md(crepe)).toBe('* child a\n* child b\n* sibling\n')
  })

  it('walks child → next sibling → back OUT to a parent-level item (the less-indented neighbour)', async () => {
    const { crepe } = await mount(NESTED)
    select(crepe, posOf(crepe, 'child a'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe).head).toBe(posOf(crepe, 'child b'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'child a'), head: posOf(crepe, 'sibling') })
    backspace(crepe)
    // Exactly the two child lines go; `sibling` keeps its own level.
    expect(md(crepe)).toBe('* parent\n* sibling\n')
  })

  it('⇧↑ from the end of a parent-level item climbs INTO the previous item\'s last child', async () => {
    const { crepe } = await mount(NESTED)
    select(crepe, endOf(crepe, 'sibling'))
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'sibling'), head: endOf(crepe, 'child b') })
  })
})

describe('D6: the head only lands on a VISIBLE line; hidden text between goes with the selection', () => {
  const FOLDED = '* P\n  * k1\n  * k2\n* S\n'

  it('folded parent then sibling: start of P, ⇧↓ → start of S (kids skipped); ⌫ takes P\'s line only — the hidden kids lift (D6 + D3)', async () => {
    const { crepe } = await mount(FOLDED)
    foldItem(crepe, 'P')
    select(crepe, posOf(crepe, 'P'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'P'), head: posOf(crepe, 'S') })
    backspace(crepe)
    expect(md(crepe)).toBe('* k1\n* k2\n* S\n')
  })

  it('start of S, ⇧↑ → start of P (over the hidden kids); ⌫ takes P\'s line only', async () => {
    const { crepe } = await mount(FOLDED)
    foldItem(crepe, 'P')
    select(crepe, posOf(crepe, 'S'))
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'S'), head: posOf(crepe, 'P') })
    backspace(crepe)
    expect(md(crepe)).toBe('* k1\n* k2\n* S\n')
  })

  it("end of P's own text, ⇧↓ → end of S, the hidden kids inside the range", async () => {
    const { crepe } = await mount(FOLDED)
    foldItem(crepe, 'P')
    select(crepe, endOf(crepe, 'P'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'P'), head: endOf(crepe, 'S') })
  })

  it('unfolded, the same ⇧↓ lands on the first kid (the fold is what hides it)', async () => {
    const { crepe } = await mount(FOLDED)
    select(crepe, posOf(crepe, 'P'))
    shiftDown(crepe)
    expect(selection(crepe).head).toBe(posOf(crepe, 'k1'))
  })

  it('a folded H2 section then another H2: the section body is skipped both ways; ⌫ takes the heading only, its body reappears, B stays a heading', async () => {
    const { crepe } = await mount('## A\n\nbody a\n\n## B\n\nbody b\n')
    caretIn(crepe, 'A')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
    select(crepe, posOf(crepe, 'A'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'A'), head: posOf(crepe, 'B') })
    select(crepe, posOf(crepe, 'B'))
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: posOf(crepe, 'B'), head: posOf(crepe, 'A') })
    backspace(crepe)
    expect(md(crepe)).toBe('body a\n\n## B\n\nbody b\n')
  })
})

describe('D6: delete never touches hidden text', () => {
  // A's line is two words so "mid A" is a real cut; A is folded in every test but the control.
  const DOC = '* A-first-half tail\n  * a1\n  * a2\n* B\n* C\n'
  const A = 'A-first-half tail'

  it('end of B → ⇧↑ → Delete: B gone, A and its kids intact', async () => {
    const { crepe } = await mount(DOC)
    foldItem(crepe, A)
    select(crepe, endOf(crepe, 'B'))
    shiftUp(crepe)
    expect(selection(crepe).head).toBe(endOf(crepe, A))
    expect(forwardDelete(crepe)).toBe(true)
    expect(md(crepe)).toBe('* A-first-half tail\n  * a1\n  * a2\n* C\n')
  })

  it('D7: Enter over a range spanning hidden lines removes only the visible pieces, then the ordinary Enter splits there — kids survive', async () => {
    const { crepe } = await mount(DOC)
    foldItem(crepe, A)
    select(crepe, endOf(crepe, 'A-first-half'))
    expect(shiftDown(crepe)).toBe(true) // own end
    expect(shiftDown(crepe)).toBe(true) // end of B, hidden kids skipped
    pressKey(crepe, 'Enter')
    // The visible pieces went (A's tail, B); the ordinary Enter then split A's item after the cut.
    expect(md(crepe)).toBe('* A-first-half\n  * a1\n  * a2\n*\n* C\n')
  })

  it('control: a selection spanning NO hidden line is not ours — deleteVisible returns false and the ordinary path runs', async () => {
    const { crepe } = await mount(DOC)
    select(crepe, posOf(crepe, A), posOf(crepe, 'B'))
    expect(runCommand(crepe, deleteVisible)).toBe(false)
    expect(typeText(crepe, 'x')).toBe(false)
    backspace(crepe)
    // Unfolded, a1 and a2 are VISIBLE lines inside the range — the ordinary path rightly takes them.
    expect(md(crepe)).toBe('* B\n* C\n')
  })
})

describe('falls through to the native move (returns false)', () => {
  it('a node selection', async () => {
    const { crepe } = await mount('above\n\n---\n\nbelow\n')
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos(crepe, 'hr'))))
    })
    expect(shiftDown(crepe)).toBe(false)
    expect(shiftUp(crepe)).toBe(false)
  })
})

describe('the anchor never moves', () => {
  it('a non-empty selection whose head is on an edge keeps its anchor across ⇧↓ and ⇧↑', async () => {
    const { crepe } = await mount(FIVE)
    const anchor = posOf(crepe, 'l2') + 1
    select(crepe, anchor, posOf(crepe, 'l3'))
    expect(shiftDown(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'l4') })
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor, head: posOf(crepe, 'l3') })
    // Backwards selection (head above anchor) too.
    select(crepe, anchor, endOf(crepe, 'l1'))
    expect(shiftUp(crepe)).toBe(true) // l1 is the first line: consumed no-op, anchor and head untouched
    expect(selection(crepe)).toEqual({ anchor, head: endOf(crepe, 'l1') })
    select(crepe, endOf(crepe, 'l4'), endOf(crepe, 'l3'))
    expect(shiftUp(crepe)).toBe(true)
    expect(selection(crepe)).toEqual({ anchor: endOf(crepe, 'l4'), head: endOf(crepe, 'l2') })
  })
})
