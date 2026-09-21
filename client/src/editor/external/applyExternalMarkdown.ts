/**
 * Apply an external/AI edit to the open file as a DIFF, not a rebuild (YAZ-1351).
 *
 * The `setMarkdown` path builds a fresh EditorState, so every collapsed bullet re-opens from a
 * content-hash seed and the caret is re-derived from a raw offset (YAZ-1342's boundary). Here the
 * new body is parsed, structurally diffed (`diffDocs`, YAZ-1350) and dispatched as ONE transaction
 * over the live state — ProseMirror's own position mapping then carries folds, selection and
 * scroll for free, which is the whole point: nothing in this path restores them by hand.
 *
 * Two deliberate escapes back to the rebuild, both returning 'rebuilt':
 *  - the body does not parse — the diff has nothing trustworthy to aim at;
 *  - one range covers ≥ 80% of the document, i.e. a whole-document rewrite. Mapping every fold
 *    onto one collapsed point loses them all, whereas the rebuild's key-based reseed can put back
 *    the folds whose lines survived. A rewrite must never behave worse than v0.9.1.
 * The transaction is also discarded (and rebuilt) if it fails to reproduce the parsed document
 * exactly: the diff is an optimisation, never a source of divergence from the file on disk.
 *
 * `addToHistory: false` keeps the user's own ⌘Z pointing at the user's own last edit; the
 * `external-edit` stamp marks the transaction for plugins that must tell it from typing.
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { setMarkdown } from '../createCrepe'
import { normalizeEmptyItems } from '../listItemRoundTrip'
import { diffDocs } from './diffDocs'

/** Share of the old document one range may cover before the edit counts as a rewrite. */
const REWRITE_SHARE = 0.8

/** Transaction meta stamped on every external apply, for plugins that must tell it from typing. */
export const EXTERNAL_EDIT_META = 'external-edit'

const isEmptyParagraph = (node: ProseNode | null): boolean => node !== null && node.type.name === 'paragraph' && node.content.size === 0

/**
 * Milkdown's trailing plugin keeps an empty paragraph after a document that ends in a list or
 * heading; the parser never emits one. Give the diff target that same tail, or the top-level child
 * counts differ on EVERY edit and each apply deletes a paragraph the plugin re-adds a tick later,
 * nudging a caret parked there. `postProcessMarkdown` strips it on save, so disk never sees it.
 */
const withTrailingParagraphOf = (live: ProseNode, parsed: ProseNode): ProseNode => {
  const tail = live.lastChild
  if (tail === null || !isEmptyParagraph(tail) || isEmptyParagraph(parsed.lastChild)) return parsed
  return parsed.copy(parsed.content.append(Fragment.from(tail)))
}

export const applyExternalMarkdown = (crepe: Crepe, body: string): 'applied' | 'rebuilt' => {
  let applied = false
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    // Exactly what `setMarkdown` feeds `replaceAll`, so the diff target is byte-for-byte the
    // document the rebuild would have produced.
    const fresh = ctx.get(parserCtx)(normalizeEmptyItems(body))
    if (fresh === null || typeof fresh === 'string') return
    const parsed = withTrailingParagraphOf(view.state.doc, fresh)
    const ranges = diffDocs(view.state.doc, parsed)
    if (ranges.length === 0) {
      applied = true
      return
    }
    const rewriteWidth = view.state.doc.content.size * REWRITE_SHARE
    if (ranges.some(({ from, to }) => to - from >= rewriteWidth)) return
    const tr = view.state.tr
    // Right-to-left: every range is expressed in OLD-document coordinates, so applying the later
    // ones first leaves the earlier ones' positions untouched.
    for (const { from, to, slice } of [...ranges].sort((a, b) => b.from - a.from)) tr.replace(from, to, slice)
    if (!tr.doc.eq(parsed)) return
    view.dispatch(tr.setMeta('addToHistory', false).setMeta(EXTERNAL_EDIT_META, true))
    applied = true
  })
  if (!applied) setMarkdown(crepe, body)
  return applied ? 'applied' : 'rebuilt'
}
