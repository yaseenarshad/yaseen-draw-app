/**
 * Empty list items round-trip (GRO-2012). Milkdown serialises an empty paragraph as the html
 * node `<br />`, so an empty bullet (Enter at the end of an item, outdented empty item, …)
 * was written as `* <br />`. That is not harmless: on the next load CommonMark reads `<br />`
 * as the start of an HTML block that runs to the next blank line, so the item's nested
 * children became literal text. Obsidian writes an empty bullet as a bare marker.
 *
 * Five pieces, all schema/remark/text-level (no Milkdown fork):
 *  1. serialise: an empty paragraph that STARTS a list item is emitted as an empty mdast
 *     paragraph → bare marker (`*`, `1.`); other empty paragraphs keep `<br />`. Inside Milkdown
 *     an empty TASK item stays `* [ ] <br />` (remark drops the checkbox from `* [ ]`, and `[ ]`
 *     already stops the HTML-block reading) — see 4 for what reaches the disk.
 *  2. parse: a listItem whose nested list starts on a later line (`* ` + children — what
 *     Obsidian writes for an empty parent) gets an empty leading paragraph, instead of
 *     becoming a list_item that starts with a bullet_list and serialising as `* * child`.
 *     A numeric marker immediately after a bullet is armored before parsing (see 6), so it is
 *     paragraph text rather than a nested ordered list.
 *  3. load: `normalizeEmptyItems()` rewrites `* <br />` lines (written by earlier builds) to
 *     bare markers so their children are not swallowed, and Obsidian's empty task `* [ ] ` /
 *     `* [ ]` (text `[ ]` for remark, round-tripped as `* \[ ]`) to `* [ ] <br />` so it stays a
 *     checkbox.
 *  4. save: `stripEmptyTaskBreaks()` turns `* [ ] <br />` back into `* [ ]` — `<br />` never
 *     reaches the disk, and 3 restores the checkbox on the next load.
 *  5. load (GRO-2112): `unifySiblingMarkers()` makes `-` / `*` / `+` siblings at one indent share a
 *     marker so they parse as ONE list (see its docblock).
 *  6. load/save (YAZ-1329): `* 6) text` / `* 6. text` are bullet text, not an implicit ordered
 *     child. Load temporarily escapes that inner delimiter for CommonMark; save restores the
 *     visible source spelling. Real ordered lines (`6. text`) remain structural.
 *  7. load (YAZ-1357): `separateEmptyNestedItems()` puts a blank line between a text item and a
 *     deeper bare marker on the next line — an EMPTY item cannot interrupt a paragraph in
 *     CommonMark, so without it rule 1's spelling reads back as text (or a setext heading).
 */
import { paragraphSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as MdNode } from '@milkdown/kit/transformer'
import { $remark } from '@milkdown/kit/utils'

type MdParent = MdNode & { children?: MdParent[]; position?: { start: { line: number } } }

const emptyParagraphFirstInListItem = paragraphSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const parent = state.top()
        if (node.content.size === 0 && parent?.type === 'listItem' && !parent.children?.length && typeof parent.props.checked !== 'boolean') {
          state.openNode('paragraph')
          state.closeNode()
          return
        }
        base.toMarkdown.runner(state, node)
      },
    },
  }
})

/** An item whose nested list starts on a LATER line (`* ` + children). */
const isEmptyParent = (item: MdParent): boolean => {
  const first = item.children?.[0]
  if (first?.type !== 'list') return false
  const itemLine = item.position?.start.line
  const listLine = first.position?.start.line
  return itemLine === undefined || listLine === undefined || listLine > itemLine
}

const addLeadingParagraph = (node: MdParent): void => {
  if (!node.children) return
  if (node.type === 'listItem' && isEmptyParent(node)) node.children.unshift({ type: 'paragraph', children: [] })
  node.children.forEach(addLeadingParagraph)
}

const listItemLeadingParagraph = $remark('mdapp-list-item-leading-paragraph', () => () => (tree: MdParent) => {
  addLeadingParagraph(tree)
})

/** Register with `editor.use(...)`. */
export const listItemRoundTrip = [emptyParagraphFirstInListItem, listItemLeadingParagraph].flat()

const MARKER = String.raw`[ \t]*(?:[-*+]|\d+[.)])`
const LEGACY_EMPTY_ITEM = new RegExp(String.raw`^(${MARKER}) <br />[ \t]*$`, 'gm')
const EMPTY_TASK_ITEM = new RegExp(String.raw`^(${MARKER} \[[ xX]\])[ \t]*$`, 'gm')
const EMPTY_TASK_ITEM_BREAK = new RegExp(String.raw`^(${MARKER} \[[ xX]\]) <br />$`, 'gm')

const SAME_LINE_ORDERED_MARKER = /^([ \t]*[-*+][ \t]+\d+)([.)])(?=[ \t\r]|$)/
const ESCAPED_SAME_LINE_ORDERED_MARKER = /^([ \t]*[-*+][ \t]+\d+)\\([.)])(?=[ \t\r]|$)/
const FENCE_BOUNDARY = /^[ \t]*(`{3,}|~{3,})/

/** Transform ordinary Markdown lines while leaving complete fenced code blocks byte-identical. */
const mapOutsideFences = (markdown: string, transform: (line: string) => string): string => {
  let fence: { marker: '`' | '~'; length: number } | null = null
  return markdown
    .split('\n')
    .map((line) => {
      const boundary = FENCE_BOUNDARY.exec(line)
      if (fence !== null) {
        if (
          boundary !== null &&
          boundary[1][0] === fence.marker &&
          boundary[1].length >= fence.length &&
          line.slice(boundary[0].length).trim() === ''
        ) {
          fence = null
        }
        return line
      }
      if (boundary !== null) {
        fence = { marker: boundary[1][0] as '`' | '~', length: boundary[1].length }
        return line
      }
      return transform(line)
    })
    .join('\n')
}

/** Before parsing: make an immediate inner `6)` / `6.` delimiter literal to CommonMark. */
export const escapeSameLineOrderedMarkers = (markdown: string): string =>
  mapOutsideFences(markdown, (line) => line.replace(SAME_LINE_ORDERED_MARKER, '$1\\$2'))

/** Before writing: canonicalize the same-line delimiter to its visible, unescaped spelling. */
export const restoreSameLineOrderedMarkers = (markdown: string): string =>
  mapOutsideFences(markdown, (line) => line.replace(ESCAPED_SAME_LINE_ORDERED_MARKER, '$1$2'))

/** Before parsing: `* <br />` → bare marker; empty task `* [ ]` → `* [ ] <br />` (keeps the checkbox);
 * then markers unified; then (LAST, since the blank line resets the marker memory) an empty bullet
 * nested directly under text gets its blank line (rule 7). */
export const normalizeEmptyItems = (markdown: string): string =>
  separateEmptyNestedItems(
    unifySiblingMarkers(
      escapeSameLineOrderedMarkers(markdown).replace(LEGACY_EMPTY_ITEM, '$1').replace(EMPTY_TASK_ITEM, '$1 <br />'),
    ),
  )

/** A bullet line, including a bare empty marker (`*` / `-` alone, what rule 8 writes). */
const BULLET_LINE = /^(\s*)([-*+])(?:\s|$)/
/** `- - -` / `* * *` / `***`: a thematic break, which would otherwise pass as a bullet. */
const THEMATIC_BREAK = /^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/
const FENCE_LINE = /^\s*(```|~~~)/
/** Tabs count as four spaces, the editor's own rule for depth. */
const indentWidth = (indent: string): number => indent.replace(/\t/g, '    ').length

/**
 * Mixed-marker siblings (GRO-2112): `-`, `*` and `+` are the same bullet. To CommonMark a marker
 * change starts a NEW list, so `* a` then `- b` at one indent become two sibling lists (two guide
 * lines, folding / line click / drag each seeing half the children). Outliners treat indentation
 * as the structure, so on load every bullet takes the marker of the previous bullet at its indent
 * (tabs = 4 spaces). Deeper indents are forgotten when a shallower bullet appears; a blank line
 * resets everything (`* a`, blank, `- b` stays two lists — Obsidian shows the same); non-bullet
 * lines never reset, since a lazy continuation keeps the list going and anything that really ends
 * it (heading, fence, thematic break) makes remark split the lists whatever the marker; fenced
 * code and thematic breaks are skipped; ordered items are not bullets. Save already normalises
 * markers (CONTRACTS rule 6), so nothing on disk is lost.
 */
export const unifySiblingMarkers = (markdown: string): string => {
  const markerAtIndent = new Map<number, string>()
  let inFence = false
  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE_LINE.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence || THEMATIC_BREAK.test(line)) return line
      const match = BULLET_LINE.exec(line)
      if (match === null) {
        if (line.trim() === '') markerAtIndent.clear()
        return line
      }
      const indent = indentWidth(match[1])
      for (const deeper of [...markerAtIndent.keys()]) if (deeper > indent) markerAtIndent.delete(deeper)
      const marker = markerAtIndent.get(indent) ?? match[2]
      markerAtIndent.set(indent, marker)
      return marker === match[2] ? line : `${match[1]}${marker}${line.slice(match[1].length + 1)}`
    })
    .join('\n')
}

/** A bullet or ordered item WITH text. */
const TEXT_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\S/
/** A bare marker: an empty item (what rule 1 writes). */
const BARE_ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]*\r?$/

/**
 * Before parsing (YAZ-1357, rule 7): a text item followed on the VERY NEXT line by a deeper bare
 * marker gets one blank line between them. CommonMark forbids an EMPTY list item from interrupting
 * a paragraph, so `* a` + `  *` (Enter, Tab) read back as the text `a *` in the note editor and, in
 * the outline editor's `-` spelling, as a setext heading that the bullets-only schema drops whole
 * (the YAZ-974 guard then locked the view). The blank line is the one spelling every parser reads
 * as a nested empty item — and the one Milkdown writes back, so the file converges on it. A no-op
 * once the blank line exists; fenced code is left alone; a SIBLING bare marker is not nested.
 */
export const separateEmptyNestedItems = (markdown: string): string => {
  const lines = markdown.split('\n')
  const out: string[] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    out.push(line)
    if (FENCE_LINE.test(line)) inFence = !inFence
    if (inFence) continue
    const text = TEXT_ITEM.exec(line)
    const next = i + 1 < lines.length ? BARE_ITEM.exec(lines[i + 1]) : null
    if (text !== null && next !== null && indentWidth(next[1]) > indentWidth(text[1])) out.push('')
  }
  return out.join('\n')
}

/** Before writing: `* [ ] <br />` (Milkdown's empty task) → `* [ ]`. */
export const stripEmptyTaskBreaks = (markdown: string): string => markdown.replace(EMPTY_TASK_ITEM_BREAK, '$1')
