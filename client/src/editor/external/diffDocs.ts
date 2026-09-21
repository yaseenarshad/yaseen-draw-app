/**
 * Structural diff of two ProseMirror documents (YAZ-1350) — the input to YAZ-1347's
 * one-transaction external apply.
 *
 * The constraint that shapes everything here: an external edit must NOT be expressed as one big
 * replace. ProseMirror carries folds, caret and scroll through position mapping, and a range that
 * spans the whole document maps every fold onto the same collapsed point — exactly the
 * `setMarkdown` rebuild we are replacing. So the walk is deliberately structural, one rule at
 * every level (YAZ-1638):
 *  - trim `.eq()` children off both ends, then pair the middle index-wise, recursing through
 *    same-markup children so a renumber of every list item produces one small range PER item
 *    instead of one range over the list; whatever one side has left over is a sibling shift (a
 *    bullet added or removed), expressed as ONE insert or delete, never a rewrite of its neighbours;
 *  - textblocks → `findDiffStart`/`findDiffEnd` over the INLINE fragment, so marks travel with the
 *    text instead of being re-derived from a plain-string diff.
 *
 * Positions are in the OLD document; every slice is cut from the NEW one. The absolute invariant
 * (asserted by the contract tests): applying every returned range right-to-left yields a document
 * that `.eq(newDoc)`. Callers that cannot honour that must fall back to a rebuild.
 */
import type { Node as ProseNode, Slice } from '@milkdown/kit/prose/model'

export interface ReplaceRange {
  /** Start of the range, in OLD-document coordinates. */
  from: number
  /** End of the range, in OLD-document coordinates. */
  to: number
  /** The replacement content, cut from the NEW document. */
  slice: Slice
}

/** Offset of child `index` within its parent's content. */
const offsetOfChild = (node: ProseNode, index: number): number => {
  let offset = 0
  for (let i = 0; i < index; i++) offset += node.child(i).nodeSize
  return offset
}

/**
 * Inline diff of one textblock pair. `findDiffEnd` may walk back past the shared prefix when the
 * change repeats characters ("Kid" → "Kid but edited elsewhere"); pushing both ends forward by the
 * overlap keeps the range well-ordered without widening it to the whole block.
 */
const diffTextblock = (
  oldNode: ProseNode,
  newNode: ProseNode,
  oldPos: number,
  newPos: number,
  newDoc: ProseNode,
  out: ReplaceRange[],
): void => {
  const start = oldNode.content.findDiffStart(newNode.content)
  const end = start === null ? null : oldNode.content.findDiffEnd(newNode.content)
  if (start === null || end === null) return
  const overlap = Math.max(0, start - Math.min(end.a, end.b))
  out.push({
    from: oldPos + start,
    to: oldPos + end.a + overlap,
    slice: newDoc.slice(newPos + start, newPos + end.b + overlap),
  })
}

/** `oldPos` / `newPos` are the CONTENT starts of the two nodes, each in its own document. */
const diffNode = (
  oldNode: ProseNode,
  newNode: ProseNode,
  oldPos: number,
  newPos: number,
  newDoc: ProseNode,
  out: ReplaceRange[],
): void => {
  if (oldNode.isTextblock) {
    diffTextblock(oldNode, newNode, oldPos, newPos, newDoc, out)
    return
  }

  let head = 0
  let oldTail = oldNode.childCount
  let newTail = newNode.childCount
  while (head < oldTail && head < newTail && oldNode.child(head).eq(newNode.child(head))) head++
  while (oldTail > head && newTail > head && oldNode.child(oldTail - 1).eq(newNode.child(newTail - 1))) {
    oldTail--
    newTail--
  }

  let oldChildPos = oldPos + offsetOfChild(oldNode, head)
  let newChildPos = newPos + offsetOfChild(newNode, head)
  const paired = Math.min(oldTail, newTail) - head
  for (let i = 0; i < paired; i++) {
    const oldChild = oldNode.child(head + i)
    const newChild = newNode.child(head + i)
    if (!oldChild.eq(newChild)) {
      // A changed type or attrs (a paragraph turned heading, an ordered list renumbered) is a
      // node identity change: replace it whole rather than diffing across two different shapes.
      if (oldChild.sameMarkup(newChild) && !oldChild.isLeaf) {
        diffNode(oldChild, newChild, oldChildPos + 1, newChildPos + 1, newDoc, out)
      } else {
        out.push({
          from: oldChildPos,
          to: oldChildPos + oldChild.nodeSize,
          slice: newDoc.slice(newChildPos, newChildPos + newChild.nodeSize),
        })
      }
    }
    oldChildPos += oldChild.nodeSize
    newChildPos += newChild.nodeSize
  }

  // Whatever one side has left over is a sibling shift: one insert (`from === to`) or one delete
  // (an empty slice), placed after the pairs so the neighbours' own ranges stay small.
  if (oldTail - head > paired || newTail - head > paired) {
    out.push({
      from: oldChildPos,
      to: oldPos + offsetOfChild(oldNode, oldTail),
      slice: newDoc.slice(newChildPos, newPos + offsetOfChild(newNode, newTail)),
    })
  }
}

/** Non-overlapping ranges, in document order, that turn `oldDoc` into `newDoc`. Empty when equal. */
export const diffDocs = (oldDoc: ProseNode, newDoc: ProseNode): ReplaceRange[] => {
  const ranges: ReplaceRange[] = []
  if (!oldDoc.eq(newDoc)) diffNode(oldDoc, newDoc, 0, 0, newDoc, ranges)
  return ranges
}
