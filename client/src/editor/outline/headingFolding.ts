/**
 * Collapsible heading sections (YAZ-1140). The heading-shaped twin of outlineFolding.ts: same
 * architecture, same ⌘Z protocol, a different answer to "what does a chevron own".
 *
 * Design: fold state lives ONLY in plugin state (the document's heading entries + the collapsed
 * heading positions, mapped through every transaction) + decorations. Toggling dispatches a
 * metadata-only transaction (`tr.setMeta(pluginKey, headingPos)`), so `tr.docChanged` is false, the
 * listener plugin never fires `markdownUpdated`, and the markdown on disk is untouched.
 * A heading's SECTION is the run of FOLLOWING SIBLING blocks up to (not including) the next heading
 * of the same or a shallower level — exactly what a reader means by "everything under this
 * heading". Nothing under it → no entry and no chevron. Headings inside `bullet_list` /
 * `ordered_list` are skipped whole: the bullet chevron (outlineFolding.ts) already owns that
 * gutter. Every other block container (blockquote, …) is walked, so a heading nested in one folds
 * its own siblings and nothing outside them.
 * Persistence is by stable fold key: `h:` + the bullet scheme (outlineFoldKeys.ts), so the two key
 * spaces can never collide even though they hash labels the same way.
 * ⌘Z panic-undo (the GRO-2075 protocol): the state remembers the most recent fold action while it
 * is the latest USER action, and drops it when a foreign view action goes by — an individual bullet
 * fold or a zoom (see viewActions.ts). `document-fold` is deliberately shared: foldAllHotkeys.ts
 * updates headings + bullets atomically, and one ⌘Z restores both exact prior sets.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { innermostItemPos, LIST_NODE_NAMES } from './listNodes'
import { getOutlineFoldKey } from './outlineFoldKeys'
import { VIEW_ACTION_META, type ViewAction } from './viewActions'

/** H1-H3 fold; H4-H6 are in-paragraph labels here, not structure. */
const DEEPEST_FOLDABLE_LEVEL = 3

interface HeadingEntry {
  foldKey: string
  headingPos: number
  /** `headingPos + nodeSize`: the caret is "on" this heading anywhere in `[headingPos, headingEnd)`. */
  headingEnd: number
  label: string
  /** One range per sibling block in the section — node decorations must match exact node boundaries. */
  sectionBlockRanges: readonly { from: number; to: number }[]
}

/** The most recent fold action while it is still the latest action (GRO-2075 panic-undo). */
type LastToggle =
  | { kind: 'toggle'; headingPos: number }
  /** An explicit set fold: the collapsed set as it was right before the action. */
  | { kind: 'set'; previousCollapsed: ReadonlySet<number> }

interface HeadingFoldingState {
  /** Every H1-H3 that owns a non-empty section, in document order (recomputed per transaction). */
  entries: readonly HeadingEntry[]
  collapsedHeadingPositions: ReadonlySet<number>
  /** Cleared by any document change: ⌘Z only reverts a fold that is the latest action. */
  lastToggle: LastToggle | null
}

export interface HeadingFoldingOptions {
  /**
   * Read on EVERY state init — first mount and every full reload (an external/AI edit to the open
   * file, YAZ-1342) — so the session's folds survive `setMarkdown`.
   */
  seedCollapsedKeys?: () => ReadonlySet<string>
  /** Called with the sorted live collapsed keys whenever the set changes (and once on mount). */
  onCollapsedKeysChange?: (keys: readonly string[]) => void
}

export const HEADING_TOGGLE_CLASS = 'heading-toggle'
export const HEADING_FOLDED_ATTR = 'data-heading-folded'

/** Shared across instances: a PluginKey only identifies the plugin within one EditorState. */
const pluginKey = new PluginKey<HeadingFoldingState>('mdapp-heading-folding')

/** Transaction meta understood by the plugin: toggle one heading, fold/unfold all or an explicit set, or revert the latest fold. */
type FoldMeta = number | 'fold-all' | 'unfold-all' | 'undo-fold' | FoldSetMeta
interface FoldSetMeta {
  set: readonly number[]
  collapsed: boolean
  /**
   * A fold the USER did not ask for — CMD+F's fold-reveal (YAZ-968) will use this. It leaves
   * `lastToggle` alone and carries no view-action stamp, so ⌘Z panic-undo is untouched by it.
   */
  silent?: boolean
}

/** Every fold transaction: the plugin meta plus the shared view-action stamp (the bullet fold and zoom watch for it). */
const foldTransaction = (state: EditorState, meta: FoldMeta) =>
  state.tr.setMeta(pluginKey, meta).setMeta(VIEW_ACTION_META, 'heading-fold' satisfies ViewAction)

/**
 * Stable key for a foldable heading: the bullet hash (outlineFoldKeys.ts) behind an `h:` prefix so
 * heading folds and bullet folds share one persisted set without ever answering to each other.
 */
export const getHeadingFoldKey = (label: string, occurrence: number): string => `h:${getOutlineFoldKey(label, occurrence)}`

/** Whether the heading starting at `headingPos` is currently folded (false when the plugin is absent). */
export const isHeadingCollapsed = (state: EditorState, headingPos: number): boolean =>
  pluginKey.getState(state)?.collapsedHeadingPositions.has(headingPos) ?? false

/**
 * The collapsed headings whose sections contain `pos` — everything hiding that position, in
 * document order. CMD+F (YAZ-968) will reveal exactly these to show a match, and put them back.
 */
export const collapsedHeadingsHiding = (state: EditorState, pos: number): number[] => {
  const foldingState = pluginKey.getState(state)
  if (!foldingState) return []
  return foldingState.entries
    .filter(
      ({ headingPos, sectionBlockRanges }) =>
        foldingState.collapsedHeadingPositions.has(headingPos) &&
        sectionBlockRanges.some((range) => pos >= range.from && pos < range.to),
    )
    .map(({ headingPos }) => headingPos)
}

/** Add this plugin's half of a document-wide fold-all transaction without dispatching it. */
export const addHeadingFoldAllMeta = (state: EditorState, transaction: Transaction, collapsed: boolean): boolean => {
  const foldingState = pluginKey.getState(state)
  if (!foldingState || foldingState.entries.length === 0) return false
  const allCollapsed = foldingState.entries.every(({ headingPos }) => foldingState.collapsedHeadingPositions.has(headingPos))
  if (collapsed ? allCollapsed : foldingState.collapsedHeadingPositions.size === 0) return false
  transaction.setMeta(pluginKey, collapsed ? 'fold-all' : 'unfold-all')
  return true
}

/**
 * ⌘↑ / ⌘↓: fold (`collapsed: true`) or unfold the section the caret sits in — the INNERMOST one,
 * so ⌘↑ under an H3 folds the H3, not the H1 wrapping it. Inside a section the key is always
 * consumed (already in that state is a no-op) so ⌘↑ never flings the caret to the top of the
 * document mid-read; outside every section it declines and the browser's native jump runs.
 * Inside a list it declines outright: the bullet handler keeps owning ⌘↑ there.
 */
export const setHeadingFoldAtSelection = (collapsed: boolean): Command => (state, dispatch) => {
  const foldingState = pluginKey.getState(state)
  if (!foldingState || innermostItemPos(state.selection.$from) !== null) return false
  const { from } = state.selection
  // Entries are in document order, so the LAST match is the innermost enclosing section.
  let innermost: HeadingEntry | null = null
  for (const entry of foldingState.entries) {
    const onHeading = from >= entry.headingPos && from < entry.headingEnd
    const inSection = entry.sectionBlockRanges.some((range) => from >= range.from && from < range.to)
    if (onHeading || inSection) innermost = entry
  }
  if (innermost === null) return false
  if (foldingState.collapsedHeadingPositions.has(innermost.headingPos) !== collapsed) {
    dispatch?.(foldTransaction(state, innermost.headingPos))
  }
  return true
}

/**
 * Fold (`collapsed: true`) or unfold an explicit set of headings at once. `silent` marks a fold the
 * user did not ask for — CMD+F's fold-reveal (YAZ-968) — which must leave ⌘Z panic-undo (every kind
 * of view action) exactly as it found it. Declines an empty set.
 */
export const setHeadingFoldSet =
  (set: readonly number[], collapsed: boolean, options?: { silent?: boolean }): Command =>
  (state, dispatch) => {
    if (set.length === 0) return false
    const meta: FoldSetMeta = { set, collapsed, silent: options?.silent }
    dispatch?.(meta.silent === true ? state.tr.setMeta(pluginKey, meta) : foldTransaction(state, meta))
    return true
  }

/** Add this plugin's half of a combined fold undo without dispatching it. Declines when stale. */
export const addHeadingFoldUndoMeta = (state: EditorState, transaction: Transaction): boolean => {
  if (!pluginKey.getState(state)?.lastToggle) return false
  transaction.setMeta(pluginKey, 'undo-fold')
  return true
}

/** ⌘Z: revert the latest eligible heading fold, otherwise let the next undo handler run. */
export const undoLastHeadingFold: Command = (state, dispatch) => {
  const transaction = state.tr
  if (!addHeadingFoldUndoMeta(state, transaction)) return false
  dispatch?.(transaction.setMeta(VIEW_ACTION_META, 'heading-fold' satisfies ViewAction))
  return true
}

/**
 * Chevron glyph: one stroked SVG (chevron-down), sized by `--fold-chevron-size` and rotated -90° by
 * CSS when collapsed, so the widget box never changes. Deliberately a local copy of the bullet
 * chevron rather than a shared import — the two plugins stay independent of each other.
 */
const chevronSvg = (): SVGSVGElement => {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', 'M6 9l6 6 6-6')
  svg.appendChild(path)
  return svg
}

/** Heading level of a node, or null for anything else. Any level ends a section; only 1-3 start one. */
const headingLevel = (node: ProseNode): number | null =>
  node.type.name === 'heading' ? Number(node.attrs.level) : null

/** Blocks whose children may hold headings of their own (blockquote, …). Lists are excluded on purpose. */
const isWalkableContainer = (node: ProseNode): boolean =>
  node.isBlock && !node.isTextblock && !node.isLeaf && !LIST_NODE_NAMES.has(node.type.name)

/**
 * Foldable headings inside ONE block container, appended in document order. `contentStart` is the
 * document position of the parent's first child (0 for the doc, `pos + 1` for a nested container).
 */
const collectHeadingEntries = (
  parent: ProseNode,
  contentStart: number,
  entries: HeadingEntry[],
  labelOccurrences: Map<string, number>,
): void => {
  const children: { node: ProseNode; pos: number }[] = []
  parent.forEach((child, offset) => children.push({ node: child, pos: contentStart + offset }))

  children.forEach(({ node, pos }, index) => {
    const level = headingLevel(node)
    if (level === null || level > DEEPEST_FOLDABLE_LEVEL) {
      if (isWalkableContainer(node)) collectHeadingEntries(node, pos + 1, entries, labelOccurrences)
      return
    }
    const sectionBlockRanges: { from: number; to: number }[] = []
    for (let next = index + 1; next < children.length; next++) {
      const sibling = children[next]
      const siblingLevel = headingLevel(sibling.node)
      if (siblingLevel !== null && siblingLevel <= level) break
      sectionBlockRanges.push({ from: sibling.pos, to: sibling.pos + sibling.node.nodeSize })
    }
    // Nothing under the heading is nothing to fold: no entry, so no chevron either.
    if (sectionBlockRanges.length === 0) return

    const label = node.textContent.trim() || 'Untitled heading'
    const occurrence = labelOccurrences.get(label) ?? 0
    labelOccurrences.set(label, occurrence + 1)
    entries.push({
      foldKey: getHeadingFoldKey(label, occurrence),
      headingPos: pos,
      headingEnd: pos + node.nodeSize,
      label,
      sectionBlockRanges,
    })
  })
}

const getHeadingEntries = (doc: ProseNode): HeadingEntry[] => {
  const entries: HeadingEntry[] = []
  collectHeadingEntries(doc, 0, entries, new Map())
  return entries
}

const getCollapsedKeys = ({ entries, collapsedHeadingPositions }: HeadingFoldingState): string[] =>
  entries
    .filter(({ headingPos }) => collapsedHeadingPositions.has(headingPos))
    .map(({ foldKey }) => foldKey)
    .sort()

export const createHeadingFolding = ({ seedCollapsedKeys = () => new Set(), onCollapsedKeysChange }: HeadingFoldingOptions = {}) =>
  $prose(
    () =>
      new Plugin<HeadingFoldingState>({
        key: pluginKey,
        state: {
          init: (_config, state) => {
            const entries = getHeadingEntries(state.doc)
            const seed = seedCollapsedKeys()
            return {
              entries,
              collapsedHeadingPositions: new Set(
                entries.filter(({ foldKey }) => seed.has(foldKey)).map(({ headingPos }) => headingPos),
              ),
              lastToggle: null,
            }
          },
          apply: (transaction, previousState, _oldState, newState) => {
            const entries = transaction.docChanged ? getHeadingEntries(newState.doc) : previousState.entries
            const headingPositions = new Set(entries.map(({ headingPos }) => headingPos))
            const collapsedHeadingPositions = new Set<number>()
            previousState.collapsedHeadingPositions.forEach((position) => {
              const mappedPosition = transaction.mapping.map(position, 1)
              if (headingPositions.has(mappedPosition)) collapsedHeadingPositions.add(mappedPosition)
            })

            // A fold is only ⌘Z-revertible while it is the latest USER action. Plugin-appended
            // transactions (e.g. Crepe's trailing paragraph) are not user actions: they keep the
            // pending fold alive, with positions mapped through their doc change.
            const appended = transaction.getMeta('appendedTransaction') !== undefined
            const viewAction: unknown = transaction.getMeta(VIEW_ACTION_META)
            let lastToggle = previousState.lastToggle
            if (transaction.docChanged && !appended) lastToggle = null
            // A bullet fold or a zoom is the newer view action now: ⌘Z belongs to it, not to this fold.
            else if (viewAction !== undefined && viewAction !== 'heading-fold' && viewAction !== 'document-fold') lastToggle = null
            else if (transaction.docChanged && lastToggle !== null) {
              lastToggle =
                lastToggle.kind === 'toggle'
                  ? { kind: 'toggle', headingPos: transaction.mapping.map(lastToggle.headingPos, 1) }
                  : {
                      kind: 'set',
                      previousCollapsed: new Set(
                        [...lastToggle.previousCollapsed].map((p) => transaction.mapping.map(p, 1)),
                      ),
                    }
            }

            const meta: FoldMeta | undefined = transaction.getMeta(pluginKey)
            if (meta === 'fold-all')
              return {
                entries,
                collapsedHeadingPositions: headingPositions,
                lastToggle: { kind: 'set', previousCollapsed: collapsedHeadingPositions },
              }
            if (meta === 'unfold-all')
              return {
                entries,
                collapsedHeadingPositions: new Set(),
                lastToggle: { kind: 'set', previousCollapsed: collapsedHeadingPositions },
              }
            if (meta === 'undo-fold' && lastToggle !== null) {
              if (lastToggle.kind === 'set') {
                const restored = new Set([...lastToggle.previousCollapsed].filter((p) => headingPositions.has(p)))
                return { entries, collapsedHeadingPositions: restored, lastToggle: null }
              }
              if (collapsedHeadingPositions.has(lastToggle.headingPos)) collapsedHeadingPositions.delete(lastToggle.headingPos)
              else if (headingPositions.has(lastToggle.headingPos)) collapsedHeadingPositions.add(lastToggle.headingPos)
              return { entries, collapsedHeadingPositions, lastToggle: null }
            }
            if (typeof meta === 'number') {
              if (collapsedHeadingPositions.has(meta)) collapsedHeadingPositions.delete(meta)
              else if (headingPositions.has(meta)) collapsedHeadingPositions.add(meta)
              lastToggle = { kind: 'toggle', headingPos: meta }
            } else if (typeof meta === 'object') {
              // FoldSetMeta (never null: meta is either absent, the string, a number or the set object).
              const previousCollapsed = new Set(collapsedHeadingPositions)
              for (const pos of meta.set) {
                if (meta.collapsed && headingPositions.has(pos)) collapsedHeadingPositions.add(pos)
                else if (!meta.collapsed) collapsedHeadingPositions.delete(pos)
              }
              // A silent set is not a user fold action: ⌘Z keeps whatever it was already pointing at.
              if (meta.silent !== true) lastToggle = { kind: 'set', previousCollapsed }
            }
            return { entries, collapsedHeadingPositions, lastToggle }
          },
        },
        props: {
          decorations: (state) => {
            const foldingState = pluginKey.getState(state)
            if (!foldingState) return DecorationSet.empty

            const decorations: Decoration[] = []
            foldingState.entries.forEach((entry) => {
              const collapsed = foldingState.collapsedHeadingPositions.has(entry.headingPos)
              decorations.push(
                Decoration.widget(
                  entry.headingPos + 1,
                  (view) => {
                    const button = document.createElement('button')
                    button.type = 'button'
                    button.className = HEADING_TOGGLE_CLASS
                    button.dataset.headingFoldKey = entry.foldKey
                    button.setAttribute('aria-expanded', String(!collapsed))
                    button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${entry.label}`)
                    button.replaceChildren(chevronSvg())
                    const toggle = () => view.dispatch(foldTransaction(view.state, entry.headingPos))
                    // Keep the caret where it is: the toggle must not steal focus or move the selection.
                    button.addEventListener('mousedown', (event) => event.preventDefault())
                    button.addEventListener('click', (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      toggle()
                    })
                    // The widget sits inside the contenteditable, so ProseMirror's keymap would swallow
                    // Enter/Space before the button's native activation; handle them here and keep focus
                    // on the (re-rendered) toggle so keyboard users can fold/unfold repeatedly.
                    button.addEventListener('keydown', (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      toggle()
                      view.dom
                        .querySelector<HTMLButtonElement>(`.${HEADING_TOGGLE_CLASS}[data-heading-fold-key="${entry.foldKey}"]`)
                        ?.focus()
                    })
                    return button
                  },
                  { key: `heading-toggle:${entry.foldKey}:${collapsed ? 'collapsed' : 'expanded'}` },
                ),
              )
              if (collapsed) {
                entry.sectionBlockRanges.forEach(({ from, to }) => {
                  decorations.push(Decoration.node(from, to, { [HEADING_FOLDED_ATTR]: 'true' }))
                })
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
        view: (view) => {
          let previousKeys: string | null = null
          const notify = () => {
            const foldingState = pluginKey.getState(view.state)
            if (!foldingState || !onCollapsedKeysChange) return
            const keys = getCollapsedKeys(foldingState)
            const serializedKeys = keys.join(' ')
            if (serializedKeys !== previousKeys) {
              previousKeys = serializedKeys
              onCollapsedKeysChange(keys)
            }
          }
          notify()
          return { update: notify }
        },
      }),
  )
