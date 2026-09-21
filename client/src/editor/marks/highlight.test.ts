/**
 * Highlight mark (YAZ-1480): real editor (`createCrepe`), Obsidian's `==text==` ↔ `highlight`
 * mark / `<mark>` in the DOM, byte-identical round trips, the `\=` adjacency escape, the four
 * adjacency shapes (text before / after a mark, and content whose own edges are `=`),
 * `Mod-Shift-h` through ProseMirror's `handleKeyDown`, the `==x==` typing rule, and pasted
 * `<mark>` HTML.
 *
 * The mount / posOf / selectText / selectAcross / caretIn / marksOn / md / key-press helpers are
 * shared with `underline.test.ts` and live in `markTestKit.ts`. Everything below is
 * highlight-specific: the colour probes, the lit-dot probes, and literal text insertion.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  caretIn,
  marksOn,
  md,
  mount,
  posOf,
  pressKey,
  selectAcross,
  selectText,
  unmountAll,
} from './markTestKit'
import {
  HIGHLIGHT_COLORS,
  highlightSchema,
  rangeHasHighlight,
  setHighlightCommand,
  type HighlightColor,
} from './highlight'

afterEach(unmountAll)

const textOf = (view: EditorView) => view.state.doc.textContent
const markEls = (root: HTMLElement) => [...root.querySelectorAll('.milkdown mark')].map((el) => el.textContent)

/** Put `text` in an empty document as literal characters — no parser, no input rules. */
async function insertLiteral(text: string) {
  const { crepe, root, view } = await mount('\n')
  view.dispatch(view.state.tr.insertText(text, 1))
  return { crepe, root, view }
}

/** Select an exact position range — for spans whose own edges are whitespace. */
function selectRange(crepe: Crepe, from: number, to: number): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  })
}

/** Run the mark's one command with a colour, exactly as a swatch press does. */
function setHighlight(crepe: Crepe, color: HighlightColor): boolean {
  return crepe.editor.action((ctx) => ctx.get(commandsCtx).call(setHighlightCommand.key, color))
}

/** The attrs of the `highlight` mark on the text node containing `text` (null when unmarked). */
function colorOn(crepe: Crepe, text: string): HighlightColor | 'none' {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    const mark = doc.resolve(posOf(crepe, text) + 1).marks().find((m) => m.type.name === 'highlight')
    return mark === undefined ? 'none' : ((mark.attrs.color ?? null) as HighlightColor)
  })
}

/** Whether the dot for `color` would be lit for the CURRENT selection (`rangeHasHighlight`). */
function lit(crepe: Crepe, color: HighlightColor): boolean {
  return crepe.editor.action((ctx) => rangeHasHighlight(ctx.get(editorViewCtx).state, highlightSchema.type(ctx), color))
}

/** Which of the four dots are lit, in swatch order — the toolbar's own `[null, ...HIGHLIGHT_COLORS]`. */
const litDots = (crepe: Crepe): HighlightColor[] =>
  ([null, ...HIGHLIGHT_COLORS] as HighlightColor[]).filter((c) => lit(crepe, c))

/** How many `highlight` marks the document carries in total (one per distinct run). */
function highlightRuns(crepe: Crepe): number {
  return crepe.editor.action((ctx) => {
    let count = 0
    ctx.get(editorViewCtx).state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'highlight')) count++
      return true
    })
    return count
  })
}

/** Type `text` one character at a time at the end of the document, the way the browser does. */
function typeAtEnd(view: EditorView, text: string): void {
  let pos = view.state.doc.content.size - 1
  for (const char of text) {
    const handled = view.someProp('handleTextInput', (f) => f(view, pos, pos, char, () => view.state.tr.insertText(char, pos)))
    if (!handled) view.dispatch(view.state.tr.insertText(char, pos))
    pos++
  }
}

/** `Mod-Shift-h` — the yellow shortcut. */
const pressModShiftH = (crepe: Crepe) => pressKey(crepe, 'h', { shift: true, mod: true })

describe('highlight mark', () => {
  it('loads `==b==` as a highlight mark, renders <mark>, and saves identical bytes', async () => {
    const { crepe, root } = await mount('a ==b== c\n')
    expect(marksOn(crepe, 'b')).toEqual(['highlight'])
    expect(root.querySelector('.milkdown mark')?.textContent).toBe('b')
    expect(md(crepe)).toBe('a ==b== c\n')
  })

  it('round-trips nested with bold, inside list items and headings', async () => {
    const src = '# Title ==h==\n\n* item with **==x==** and ==two words==\n  * ==child==\n'
    const { crepe, root } = await mount(src)
    expect(marksOn(crepe, 'x')).toEqual(['highlight', 'strong'])
    expect(markEls(root)).toEqual(['h', 'x', 'two words', 'child'])
    expect(md(crepe)).toBe(src)
  })

  it('carries bold INSIDE the highlight', async () => {
    const { crepe } = await mount('==a **b** c==\n')
    expect(marksOn(crepe, 'b')).toEqual(['highlight', 'strong'])
    expect(marksOn(crepe, 'a ')).toEqual(['highlight'])
    expect(md(crepe)).toBe('==a **b** c==\n')
  })

  it('never touches a LONE `=` — every spacing of it is byte-identical', async () => {
    const src = 'a = b, x=5, x =5, x= 5\n'
    const { crepe, root } = await mount(src)
    expect(markEls(root)).toEqual([])
    expect(md(crepe)).toBe(src)
    expect(md(crepe)).not.toContain('\\')
  })

  it('escapes every `=` that touches another `=`, and the escapes read back as the same text', async () => {
    const { crepe, root } = await mount('a == b, a === b, ====, a==b\n')
    expect(markEls(root)).toEqual([])
    // NB the third `=` of the 3-run is not escaped: mdast-util-to-markdown compiles the two
    // `unsafe` rules into CONSUMING regexes, so a run of three yields only two match positions.
    // `\=\==` still reads back as the literal `===` it came from, and is byte-stable.
    expect(md(crepe)).toBe('a \\=\\= b, a \\=\\== b, \\=\\=\\=\\=, a\\=\\=b\n')
    const again = await mount(md(crepe))
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toBe('a == b, a === b, ====, a==b')
    expect(md(again.crepe)).toBe(md(crepe))
  })

  it('escapes a tight run typed as plain text, and the escape reads back as the same text', async () => {
    const { crepe, root, view } = await insertLiteral('x==5 and y==6')
    expect(markEls(root)).toEqual([])
    expect(textOf(view)).toBe('x==5 and y==6')
    expect(md(crepe)).toBe('x\\=\\=5 and y\\=\\=6\n')
    const again = await mount(md(crepe))
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toBe('x==5 and y==6')
  })

  it('the UNESCAPED form of the same string on disk is a highlight — two tight runs pair up', async () => {
    const { crepe, root } = await mount('x==5 and y==6\n')
    expect(markEls(root)).toEqual(['5 and y'])
    expect(md(crepe)).toBe('x==5 and y==6\n')
  })

  it('reads a backslash-escaped `\\==` as literal text, and writes it back per character', async () => {
    const { crepe, root, view } = await mount('literal \\==not a mark\\== here\n')
    expect(markEls(root)).toEqual([])
    expect(textOf(view)).toBe('literal ==not a mark== here')
    expect(md(crepe)).toBe('literal \\=\\=not a mark\\=\\= here\n')
    const again = await mount(md(crepe))
    expect(textOf(again.view)).toBe('literal ==not a mark== here')
    expect(md(again.crepe)).toBe(md(crepe))
  })

  it('left adjacency: text ending in `=` right before a highlight, with a letter or a space before it', async () => {
    // A letter before the `=`.
    const letter = await mount('ab\n')
    selectText(letter.crepe, 'b')
    expect(pressModShiftH(letter.crepe)).toBe(true)
    expect(md(letter.crepe)).toBe('a==b==\n')
    letter.view.dispatch(letter.view.state.tr.insertText('=', posOf(letter.crepe, 'b')))
    expect(md(letter.crepe)).toBe('a\\===b==\n')
    const letterAgain = await mount(md(letter.crepe))
    expect(marksOn(letterAgain.crepe, 'b')).toEqual(['highlight'])
    expect(textOf(letterAgain.view)).toBe('a=b')

    // A SPACE before it: the `=` still escapes, so the mark survives the reload.
    const space = await mount('hello world\n')
    selectText(space.crepe, 'world')
    expect(pressModShiftH(space.crepe)).toBe(true)
    space.view.dispatch(space.view.state.tr.insertText('=', posOf(space.crepe, 'world')))
    expect(md(space.crepe)).toBe('hello \\===world==\n')
    const spaceAgain = await mount(md(space.crepe))
    expect(marksOn(spaceAgain.crepe, 'world')).toEqual(['highlight'])
    expect(textOf(spaceAgain.view)).toBe('hello =world')
  })

  it('right adjacency: text starting with `=` right after a highlight', async () => {
    const { crepe } = await mount('x=more\n')
    selectText(crepe, 'x')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('==x==\\=more\n')
    const again = await mount(md(crepe))
    expect(marksOn(again.crepe, 'x')).toEqual(['highlight'])
    expect(marksOn(again.crepe, '=more')).toEqual([])
    expect(textOf(again.view)).toBe('x=more')
  })

  it('content edges: a highlight whose own text starts and ends with `=`', async () => {
    const { crepe } = await mount('=x=\n')
    selectText(crepe, '=x=')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('==\\=x\\===\n')
    const again = await mount(md(crepe))
    expect(marksOn(again.crepe, '=x=')).toEqual(['highlight'])
    expect(textOf(again.view)).toBe('=x=')
  })

  it('Mod-Shift-h adds the mark on a selection and removes it again', async () => {
    const { crepe, root } = await mount('hello world\n')
    selectText(crepe, 'world')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello ==world==\n')
    expect(marksOn(crepe, 'world')).toEqual(['highlight'])
    expect(markEls(root)).toEqual(['world'])
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello world\n')
    expect(markEls(root)).toEqual([])
  })

  it('typing `==word==` converts as the closing run lands', async () => {
    const { crepe, root, view } = await mount('hello\n')
    view.dispatch(view.state.tr.insertText(' ', view.state.doc.content.size - 1))
    typeAtEnd(view, '==word==')
    expect(textOf(view)).toBe('hello word')
    expect(markEls(root)).toEqual(['word'])
    expect(md(crepe)).toBe('hello ==word==\n')
  })

  it('typing a SPACED pair never converts — `== spaced ==` stays exactly that text', async () => {
    const { crepe, root, view } = await mount('hello\n')
    view.dispatch(view.state.tr.insertText(' ', view.state.doc.content.size - 1))
    typeAtEnd(view, '== spaced ==')
    expect(textOf(view)).toBe('hello == spaced ==')
    expect(markEls(root)).toEqual([])
    expect(md(crepe)).toBe('hello \\=\\= spaced \\=\\=\n')
    const again = await mount(md(crepe))
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toBe('hello == spaced ==')
  })

  it('pasted <mark> HTML becomes the mark and saves as `==…==`', async () => {
    const { crepe, root, view } = await mount('\n')
    const html = '<p>x <mark>y</mark> z</p>'
    view.pasteHTML(html, {
      clipboardData: { getData: (t: string) => (t === 'text/html' ? html : '') },
      preventDefault() {},
    } as unknown as ClipboardEvent)
    expect(marksOn(crepe, 'y')).toEqual(['highlight'])
    expect(markEls(root)).toEqual(['y'])
    expect(md(crepe)).toBe('x ==y== z\n')
  })

  it('`==` under a paragraph is still a setext heading, not a mark', async () => {
    const { crepe, root } = await mount('Title\n==\n')
    expect(root.querySelector('.milkdown .ProseMirror h1')?.textContent).toBe('Title')
    expect(markEls(root)).toEqual([])
    // Rule 6's setext → ATX normalisation.
    expect(md(crepe)).toBe('# Title\n')
  })

  it('an unmatched opener stays text — and is escaped so it keeps reading as text', async () => {
    const { crepe, root } = await mount('open ==never closed\n')
    expect(markEls(root)).toEqual([])
    expect(md(crepe)).toBe('open \\=\\=never closed\n')
    const again = await mount(md(crepe))
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toBe('open ==never closed')
  })

  it('never escapes a `==` inside a URL', async () => {
    const { crepe, root } = await mount('see <https://x.y/?a==b> now\n')
    expect(markEls(root)).toEqual([])
    expect(md(crepe)).toBe('see <https://x.y/?a==b> now\n')
  })

  /**
   * The four places `==` is NOT prose: an inline code span, a fenced block, a wikilink target and
   * a tag. None of them may grow a mark, and the first three must come back BYTE-identical — a
   * `[[Plan \=\= Draft]]` on disk is a broken link, not an escaped one.
   */
  it('leaves `==` alone inside inline code, a fence, a wikilink target and a tag', async () => {
    const src = [
      '`a == b` and `==code==`',
      '',
      '```js',
      'if (a == b) return',
      '```',
      '',
      'see [[Plan == Draft]] and #v==2',
      '',
    ].join('\n')
    const { crepe, root } = await mount(src)
    expect(markEls(root)).toEqual([])
    expect(highlightRuns(crepe)).toBe(0)

    // Byte-identical everywhere `==` is not prose — the code span, the fence, and the wikilink
    // target, which is a literal FILENAME (🔒 a `[[Plan \=\= Draft]]` on disk is a broken link,
    // not an escaped one, so the save path undoes that escape). The one place the vault does get
    // an escape is the `#tag`: a tag is not a construct of its own, just phrasing, so its `==`
    // escapes like any other text `==` — and reads back as the same characters.
    const saved = md(crepe)
    expect(saved).toBe(
      [
        '`a == b` and `==code==`',
        '',
        '```js',
        'if (a == b) return',
        '```',
        '',
        'see [[Plan == Draft]] and #v\\=\\=2',
        '',
      ].join('\n'),
    )
    expect(saved).not.toContain('[[Plan \\=\\= Draft]]')

    const again = await mount(saved)
    expect(markEls(again.root)).toEqual([])
    expect(textOf(again.view)).toContain('#v==2')
    expect(md(again.crepe)).toBe(saved)
  })

  it('cannot apply where marks are not allowed: inside a fenced code block the command is a no-op', async () => {
    const src = '```\nx == y\n```\n'
    const { crepe } = await mount(src)
    caretIn(crepe, 'x == y')
    // Pin that the caret really is in the fence — otherwise `false` would prove nothing.
    expect(crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection.$from.parent.type.name)).toBe('code_block')
    expect(setHighlight(crepe, null)).toBe(false)
    expect(setHighlight(crepe, 'green')).toBe(false)
    expect(md(crepe)).toBe(src)
    expect(highlightRuns(crepe)).toBe(0)
  })
})

describe('coloured highlights (YAZ-1480)', () => {
  it('loads every `<mark class="highlight-…">` as its colour and saves identical bytes', async () => {
    const letterFor: Record<Exclude<HighlightColor, null>, string> = { green: 'g', blue: 'b', pink: 'p' }
    const src = `${HIGHLIGHT_COLORS.map((c) => `<mark class="highlight-${c}">${letterFor[c]}</mark>`).join(' ')}\n`
    expect(src).toBe(
      '<mark class="highlight-green">g</mark> <mark class="highlight-blue">b</mark> <mark class="highlight-pink">p</mark>\n',
    )
    const { crepe, root } = await mount(src)
    for (const color of HIGHLIGHT_COLORS) {
      const letter = letterFor[color]
      expect(root.querySelector(`.milkdown mark.highlight-${color}`)?.textContent).toBe(letter)
      expect(colorOn(crepe, letter)).toBe(color)
    }
    expect(markEls(root)).toEqual(['g', 'b', 'p'])
    expect(md(crepe)).toBe(src)
  })

  it('round-trips a colour inside bold, inside a list item and a heading', async () => {
    const src =
      '# Title <mark class="highlight-blue">h</mark>\n\n' +
      '* item with **<mark class="highlight-green">x</mark>** and <mark class="highlight-pink">two words</mark>\n' +
      '  * <mark class="highlight-blue">child</mark>\n'
    const { crepe } = await mount(src)
    expect(marksOn(crepe, 'x')).toEqual(['highlight', 'strong'])
    expect(colorOn(crepe, 'x')).toBe('green')
    expect(colorOn(crepe, 'two words')).toBe('pink')
    expect(colorOn(crepe, 'child')).toBe('blue')
    expect(md(crepe)).toBe(src)
  })

  it('reads a BARE <mark> as yellow and normalises it to `==…==`', async () => {
    const { crepe, root } = await mount('<mark>plain</mark>\n')
    expect(colorOn(crepe, 'plain')).toBe(null)
    expect(markEls(root)).toEqual(['plain'])
    expect(md(crepe)).toBe('==plain==\n')
  })

  it('leaves an unknown <mark class/style> as inline HTML, byte-identical', async () => {
    const src = '<mark class="foo">x</mark> and <mark style="background:red">y</mark>\n'
    const { crepe, root } = await mount(src)
    expect(colorOn(crepe, 'x')).toBe('none')
    expect(colorOn(crepe, 'y')).toBe('none')
    // Two openers and two closers, each an inline-HTML atom — nothing was swallowed into a mark.
    expect(root.querySelectorAll('.milkdown [data-type="html"]').length).toBe(4)
    expect(md(crepe)).toBe(src)
  })

  it('a highlight nested inside a highlight ENDS the outer one — the tail loses the colour', async () => {
    // 🔒 Milkdown's ParserState has ONE mark set: `openMark` of the same type REPLACES the outer
    // mark and `closeMark` removes the type outright, so there is nothing to restore the green to
    // after the inner `==b==` closes. The outer colour therefore survives only up to the nested
    // run. Lossy on the FIRST save, stable from then on. Same for colour-in-colour; a highlight
    // inside a DIFFERENT mark (`<u>`, `**`) is unaffected.
    const { crepe } = await mount('<mark class="highlight-green">a ==b== c</mark>\n')
    expect(colorOn(crepe, 'a ')).toBe('green')
    expect(colorOn(crepe, 'b')).toBe(null)
    expect(colorOn(crepe, ' c')).toBe('none')
    const saved = '<mark class="highlight-green">a</mark> ==b== c\n'
    expect(md(crepe)).toBe(saved)
    // Stable from the first save on.
    const again = await mount(saved)
    expect(md(again.crepe)).toBe(saved)
  })

  it('a highlight inside a DIFFERENT mark round-trips untouched — and the other way round', async () => {
    const outer = '<u>a <mark class="highlight-green">b</mark> c</u>\n'
    const { crepe } = await mount(outer)
    expect(marksOn(crepe, 'b')).toEqual(['highlight', 'underline'])
    expect(colorOn(crepe, 'b')).toBe('green')
    expect(md(crepe)).toBe(outer)

    // The reverse nesting: `<u>` inside the colour. Two different mark types, so neither closes
    // the other — both land on `b` and the bytes are unchanged.
    const inner = '<mark class="highlight-green">a <u>b</u> c</mark>\n'
    const nested = await mount(inner)
    expect(marksOn(nested.crepe, 'b')).toEqual(['highlight', 'underline'])
    expect(colorOn(nested.crepe, 'b')).toBe('green')
    expect(colorOn(nested.crepe, 'a ')).toBe('green')
    expect(md(nested.crepe)).toBe(inner)
  })

  it('one command, one click: apply, remove, switch, and back to yellow', async () => {
    const { crepe } = await mount('hello world\n')

    selectText(crepe, 'world')
    expect(setHighlight(crepe, 'green')).toBe(true)
    expect(md(crepe)).toBe('hello <mark class="highlight-green">world</mark>\n')

    selectText(crepe, 'world')
    expect(setHighlight(crepe, 'green')).toBe(true)
    expect(md(crepe)).toBe('hello world\n')

    selectText(crepe, 'world')
    setHighlight(crepe, 'green')
    selectText(crepe, 'world')
    setHighlight(crepe, 'blue')
    expect(md(crepe)).toBe('hello <mark class="highlight-blue">world</mark>\n')
    expect(highlightRuns(crepe)).toBe(1)
    expect(colorOn(crepe, 'world')).toBe('blue')

    selectText(crepe, 'world')
    setHighlight(crepe, null)
    expect(md(crepe)).toBe('hello ==world==\n')
  })

  it('a dot is lit when ANY of the selection carries its colour (🔒 D5) — at a caret, the colour it would type with', async () => {
    const { crepe, view } = await mount('==yellow== and <mark class="highlight-green">green</mark> and plain\n')

    selectText(crepe, 'yellow')
    expect(litDots(crepe)).toEqual([null])

    selectText(crepe, 'green')
    expect(litDots(crepe)).toEqual(['green'])

    // A partly highlighted span still lights — the Bold rule — and a mixed one lights every colour present.
    selectAcross(crepe, 'green', 'plain')
    expect(litDots(crepe)).toEqual(['green'])
    selectAcross(crepe, 'yellow', 'plain')
    expect(litDots(crepe)).toEqual([null, 'green'])

    selectText(crepe, 'plain')
    expect(litDots(crepe)).toEqual([])

    caretIn(crepe, 'green')
    expect(litDots(crepe)).toEqual(['green'])

    // At a caret the dot answers "what would I type with?" — so the command SETS a stored mark
    // and the very next character carries it.
    caretIn(crepe, 'plain')
    expect(setHighlight(crepe, null)).toBe(true)
    expect(litDots(crepe)).toEqual([null])
    view.dispatch(view.state.tr.insertText('x'))
    expect(colorOn(crepe, 'x')).toBe(null)

    // And a lit colour at a caret turns the stored mark OFF again: nothing lit, plain text typed.
    caretIn(crepe, 'green')
    expect(setHighlight(crepe, 'green')).toBe(true)
    expect(litDots(crepe)).toEqual([])
    view.dispatch(view.state.tr.insertText('z'))
    expect(colorOn(crepe, 'z')).toBe('none')
  })

  it('at a caret inside a colour, yellow SWITCHES rather than clears: the typed character is `==…==` (🔒 D5)', async () => {
    for (const run of ['command', 'shortcut'] as const) {
      const { crepe, view } = await mount('a <mark class="highlight-green">bc</mark> d\n')
      caretIn(crepe, 'bc')
      expect(lit(crepe, null)).toBe(false)
      expect(lit(crepe, 'green')).toBe(true)

      if (run === 'command') expect(setHighlight(crepe, null)).toBe(true)
      else expect(pressModShiftH(crepe)).toBe(true)

      view.dispatch(view.state.tr.insertText('X'))
      expect(colorOn(crepe, 'X')).toBe(null)
      expect(colorOn(crepe, 'b')).toBe('green')
      expect(md(crepe)).toMatch(
        /<mark class="highlight-green">b<\/mark>==X==<mark class="highlight-green">c<\/mark>/,
      )
      await unmountAll()
    }
  })

  it('never highlights the whitespace at the edge of a selection — the Bold rule', async () => {
    // Trailing space, yellow.
    const trailing = await mount('hello world again\n')
    const at = posOf(trailing.crepe, 'world')
    selectRange(trailing.crepe, at, at + 'world '.length)
    expect(setHighlight(trailing.crepe, null)).toBe(true)
    expect(md(trailing.crepe)).toBe('hello ==world== again\n')

    // Trailing space, a colour.
    const colored = await mount('hello world again\n')
    const atColored = posOf(colored.crepe, 'world')
    selectRange(colored.crepe, atColored, atColored + 'world '.length)
    expect(setHighlight(colored.crepe, 'green')).toBe(true)
    expect(md(colored.crepe)).toBe('hello <mark class="highlight-green">world</mark> again\n')

    // Leading space.
    const leading = await mount('hello world again\n')
    const atLeading = posOf(leading.crepe, 'world')
    selectRange(leading.crepe, atLeading - 1, atLeading + 'world'.length)
    expect(setHighlight(leading.crepe, null)).toBe(true)
    expect(md(leading.crepe)).toBe('hello ==world== again\n')
  })

  it('a lit colour is REMOVED from a partly highlighted selection, never extended; an unlit one replaces every colour (🔒 D5)', async () => {
    const { crepe } = await mount('==yellow== and <mark class="highlight-green">green</mark> and plain\n')

    selectAcross(crepe, 'yellow', 'plain')
    setHighlight(crepe, null)
    expect(md(crepe)).toBe('yellow and <mark class="highlight-green">green</mark> and plain\n')

    selectAcross(crepe, 'yellow', 'plain')
    setHighlight(crepe, 'green')
    expect(md(crepe)).toBe('yellow and green and plain\n')

    selectAcross(crepe, 'yellow', 'plain')
    setHighlight(crepe, 'blue')
    expect(md(crepe)).toBe('<mark class="highlight-blue">yellow and green and plain</mark>\n')
    expect(highlightRuns(crepe)).toBe(1)
  })

  it('pasted coloured <mark> HTML keeps its colour', async () => {
    const { crepe, root, view } = await mount('\n')
    const html = '<p>x <mark class="highlight-blue">y</mark> z</p>'
    view.pasteHTML(html, {
      clipboardData: { getData: (t: string) => (t === 'text/html' ? html : '') },
      preventDefault() {},
    } as unknown as ClipboardEvent)
    expect(colorOn(crepe, 'y')).toBe('blue')
    expect(root.querySelector('.milkdown mark.highlight-blue')?.textContent).toBe('y')
    expect(md(crepe)).toBe('x <mark class="highlight-blue">y</mark> z\n')
  })

  it('copy-out carries the mark as <mark> HTML, colour and all', async () => {
    const { crepe, view } = await mount('==yellow== and <mark class="highlight-green">green</mark>\n')

    selectText(crepe, 'yellow')
    const yellow = view.serializeForClipboard(view.state.selection.content()).dom.innerHTML
    expect(yellow).toContain('<mark>yellow</mark>')

    selectText(crepe, 'green')
    const green = view.serializeForClipboard(view.state.selection.content()).dom.innerHTML
    expect(green).toContain('<mark class="highlight-green">green</mark>')
  })

  it('the HTML form needs no `=` escape: text ending in `=` right before a colour', async () => {
    const { crepe, view } = await mount('ab\n')
    selectText(crepe, 'b')
    setHighlight(crepe, 'green')
    view.dispatch(view.state.tr.insertText('=', posOf(crepe, 'b')))
    expect(md(crepe)).toBe('a=<mark class="highlight-green">b</mark>\n')
    const again = await mount(md(crepe))
    expect(colorOn(again.crepe, 'b')).toBe('green')
    expect(colorOn(again.crepe, 'a=')).toBe('none')
    expect(textOf(again.view)).toBe('a=b')
  })

  it('Mod-Shift-h is always YELLOW: it switches a coloured run, then removes it', async () => {
    const { crepe } = await mount('hello <mark class="highlight-green">world</mark>\n')
    selectText(crepe, 'world')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello ==world==\n')
    expect(colorOn(crepe, 'world')).toBe(null)
    selectText(crepe, 'world')
    expect(pressModShiftH(crepe)).toBe(true)
    expect(md(crepe)).toBe('hello world\n')
  })
})
