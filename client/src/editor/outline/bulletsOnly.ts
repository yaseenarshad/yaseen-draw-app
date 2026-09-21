/**
 * THE BULLETS-ONLY LOCK (YAZ-901, 🔒 F3). The folder page's outline view hosts a SECOND Milkdown
 * instance — the same `createCrepe()` the note editor uses, with the same outliner plugins and the
 * same wikilink surfaces — holding a document that is exactly ONE bullet list and can never become
 * anything else. Nothing is forked or copied here; four locks are added, cheapest first.
 *
 *  1. CONFIG. `outlineFeatures` drops BlockEdit (slash menu + block handle) and Toolbar, the two UI
 *     doors to a heading / table / code block, and `trailingConfig` stops Crepe appending its
 *     trailing paragraph under the list — a click target OUTSIDE the outline is the whole hole.
 *  2. SCHEMA. `list_item` narrows from `createCrepe`'s `block+` (widened there so `* # Heading`
 *     round-trips) to `paragraph bullet_list?`. This is what makes the markdown input rules DECLINE
 *     rather than fire: `wrappingInputRule` / `textblockTypeInputRule` both ask the schema whether
 *     the node fits before matching, so `# `, `> `, ``` and `1. ` typed in a bullet leave their
 *     characters standing as list text. It is also what makes a pasted block arrive as the bullet's
 *     own paragraph: ProseMirror fits every slice to the item's content expression.
 *  3. PASTE. A paste rule rewrites a foreign slice into bullets BEFORE that fit — see
 *     `flattenToBullets`. Without it a MULTI-block paste fits only its first block into the caret's
 *     bullet and leaves the rest below the list, where lock 4 rejects the whole transaction and the
 *     paste silently does nothing.
 *  4. FILTER, for the one thing none of the above can prevent. `docSchema` is a bare `$node` with no
 *     `extendSchema`, so the top level cannot be narrowed without copying Milkdown's doc spec; and
 *     Backspace / Enter on a level-1 bullet LIFT it out of the list (`outline/listCommands.ts`),
 *     which is a perfectly legal `block+` document. One `filterTransaction` rejects any transaction
 *     whose doc stops being bullets — a hard backstop that also catches an inline image and
 *     whatever a future Crepe upgrade adds.
 */
import { CrepeFeature, type Crepe } from '@milkdown/crepe'
import type { Ctx } from '@milkdown/kit/ctx'
import { trailingConfig } from '@milkdown/kit/plugin/trailing'
import { bulletListSchema, listItemSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark'
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm'
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $pasteRule, $prose } from '@milkdown/kit/utils'
import { features } from '../featureConfig'

/** The note editor's feature allowlist minus the two UI insert doors; everything else is shared. */
export const outlineFeatures: Record<CrepeFeature, boolean> = {
  ...features,
  [CrepeFeature.BlockEdit]: false,
  [CrepeFeature.Toolbar]: false,
}

const BULLET_LIST = 'bullet_list'
/** Every node type an outline document may hold. Marks (strong, emphasis, inline code) are free. */
const ALLOWED_NODES = new Set(['doc', BULLET_LIST, 'list_item', 'paragraph', 'text', 'hardbreak'])

/** One bullet list at the top level, and nothing but bullets, items, paragraphs and inline text under it. */
export function isBulletsOnly(doc: ProseNode): boolean {
  let ok = true
  doc.forEach((child) => {
    if (child.type.name !== BULLET_LIST) ok = false
  })
  if (!ok) return false
  doc.descendants((node) => {
    if (!ALLOWED_NODES.has(node.type.name)) ok = false
    return ok
  })
  return ok
}

/**
 * A pasted slice as bullets: every textblock in it (heading, code line, table cell, quoted
 * paragraph) becomes one list item's paragraph, inline nodes that are not text are dropped, and
 * `maxOpen` lets the first one merge into the bullet the caret is in — so a one-block paste is
 * still plain inline text and a multi-block paste is a run of siblings. A slice that is ALREADY
 * bullets (an outline copied from this editor or the note editor) is returned untouched, nesting
 * and all: flattening a copy of the user's own outline would be vandalism.
 */
function flattenToBullets(slice: Slice, ctx: Ctx): Slice {
  const listType = bulletListSchema.type(ctx)
  let allBullets = slice.content.childCount > 0
  slice.content.forEach((child) => {
    if (child.type !== listType) allBullets = false
  })
  if (allBullets) return slice

  const itemType = listItemSchema.type(ctx)
  const paragraphType = paragraphSchema.type(ctx)
  const items: ProseNode[] = []
  slice.content.descendants((node) => {
    if (!node.isTextblock) return true
    const inline: ProseNode[] = []
    node.content.forEach((child) => {
      if (ALLOWED_NODES.has(child.type.name)) inline.push(child)
    })
    items.push(itemType.create(null, paragraphType.create(null, Fragment.fromArray(inline))))
    return false
  })
  return items.length === 0 ? Slice.empty : Slice.maxOpen(Fragment.from(listType.create(null, items)))
}

/**
 * Milkdown's OWN paste hook, not a `transformPasted` view prop: core sets that prop itself (to run
 * `pasteRulesCtx`) and `EditorView.someProp` lets a direct view prop win over every plugin's, so a
 * plugin-level `transformPasted` would silently never run.
 */
const bulletsOnlyPaste = $pasteRule((ctx) => ({ run: (slice: Slice) => flattenToBullets(slice, ctx) }))

const bulletsOnlyFilter = $prose(
  () =>
    new Plugin({
      key: new PluginKey('mdapp-bullets-only'),
      filterTransaction: (tr) => !tr.docChanged || isBulletsOnly(tr.doc),
    }),
)

/**
 * Apply locks 1b–4 to a Crepe built with `createCrepe({ features: outlineFeatures })`, BEFORE
 * `create()`. The schema override is `use`d after createCrepe's own, and `extendSchema` always
 * derives from the ORIGINAL spec, so this one replaces the `block+` widening rather than stacking
 * on it.
 */
export function lockToBullets(crepe: Crepe): void {
  crepe.editor
    .config((ctx) => {
      ctx.update(trailingConfig.key, (prev) => ({ ...prev, shouldAppend: () => false }))
    })
    .use(
      extendListItemSchemaForTask.extendSchema((prev) => (ctx) => ({ ...prev(ctx), content: `paragraph ${BULLET_LIST}?` })),
    )
    .use(bulletsOnlyPaste)
    .use(bulletsOnlyFilter)
}
