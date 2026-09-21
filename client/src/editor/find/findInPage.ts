/**
 * CMD+F find in the open note (YAZ-968) — the engine behind `FindChannel`.
 *
 * Design, the fold plugin's (outlineFolding.ts): the whole search lives in plugin state (query,
 * matches, active index, the items this search revealed — every position mapped through every
 * transaction) and paints through decorations. Nothing it dispatches changes the document, so
 * `tr.docChanged` is always false, `markdownUpdated` never fires and the file on disk is untouched.
 *
 * Matching is case-insensitive and literal, per TEXTBLOCK: a block's adjacent text nodes are
 * concatenated with their absolute start, so a match crosses mark boundaries (`say wo**rld**` finds
 * `world`) but never a block boundary. While zoomed (zoom.ts) only the zoomed subtree counts.
 *
 * Folds and the search (the part with a memory): a collapsed item hiding a match is expanded
 * SILENTLY — `setOutlineFoldSet(..., { silent: true })`, which leaves ⌘Z panic-undo pointing at
 * whatever it pointed at before. `close()` puts every one of them back EXCEPT the ones hiding the
 * active match: the search hands the reader a landing, not a re-opened outline.
 * Collapsed HEADING sections (YAZ-1140) hide matches the same way and get the same treatment, on
 * their own books: two revealed sets, never merged, because the two kinds are separate plugin
 * states and each must be handed back only its own positions.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { collapsedHeadingsHiding, setHeadingFoldSet } from '../outline/headingFolding'
import { collapsedItemsHiding, setOutlineFoldSet } from '../outline/outlineFolding'
import { getZoomedItemPos } from '../outline/zoom'
import type { FindChannel, FindController, FindResult } from './findChannel'

export const FIND_MATCH_CLASS = 'find-match'
/** The active match carries this IN ADDITION to `FIND_MATCH_CLASS`. */
export const FIND_ACTIVE_CLASS = 'find-match--active'

/** An absolute document range: one match, or the zoomed subtree. */
interface Match {
  from: number
  to: number
}

interface FindState {
  query: string
  matches: readonly Match[]
  /** Index into `matches`; −1 when there are none. */
  activeIndex: number
  /** Items THIS search expanded; `close()` re-collapses all but the active match's. */
  revealed: ReadonlySet<number>
  /** The same, for heading sections (YAZ-1140) — kept apart: the two plugins own different positions. */
  revealedHeadings: ReadonlySet<number>
}

type FindMeta =
  | { type: 'query'; query: string }
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'revealed'; revealed: ReadonlySet<number>; revealedHeadings: ReadonlySet<number> }
  | { type: 'clear' }

/** Shared across instances: a PluginKey only identifies the plugin within one EditorState. */
const findKey = new PluginKey<FindState>('mdapp-find-in-page')

const EMPTY: FindState = { query: '', matches: [], activeIndex: -1, revealed: new Set(), revealedHeadings: new Set() }

/**
 * The block's text as runs of ADJACENT text nodes, each with its absolute start. Marks split text
 * nodes but not positions, so one run spans them and a match may too; a non-text inline node
 * (hard_break, image) is a real gap and starts a new run.
 */
const textRuns = (block: ProseNode, blockPos: number): { text: string; start: number }[] => {
  const runs: { text: string; start: number }[] = []
  let end = -1
  block.forEach((child, offset) => {
    if (!child.isText || child.text === undefined) return
    const start = blockPos + 1 + offset
    if (start === end) runs[runs.length - 1].text += child.text
    else runs.push({ text: child.text, start })
    end = start + child.nodeSize
  })
  return runs
}

/** Every case-insensitive literal occurrence of `query`, in document order; `zoom` filters to the zoomed subtree. */
const findMatches = (doc: ProseNode, query: string, zoom: Match | null): Match[] => {
  const needle = query.toLowerCase()
  if (needle === '') return []
  const matches: Match[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    for (const run of textRuns(node, pos)) {
      const haystack = run.text.toLowerCase()
      for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) {
        const from = run.start + i
        if (zoom === null || (from >= zoom.from && from < zoom.to)) matches.push({ from, to: from + needle.length })
      }
    }
    return false
  })
  return matches
}

/**
 * The zoomed subtree in the NEW document. Zoom's own plugin state is not applied yet when this
 * plugin's field runs first (createCrepe registers find before `createOutlineZoom`), so the level
 * is read from the old state and mapped the way zoom.ts maps it.
 */
const zoomedRange = (transaction: Transaction, oldState: EditorState, newState: EditorState): Match | null => {
  const itemPos = getZoomedItemPos(oldState)
  if (itemPos === null) return null
  const pos = transaction.mapping.map(itemPos, 1)
  const item = newState.doc.nodeAt(pos)
  return item === null ? null : { from: pos, to: pos + item.nodeSize }
}

/** Where the active match lands: the caret's next match on a new query, a wrapped step, else held in range. */
const nextActive = (previous: FindState, meta: FindMeta | undefined, matches: readonly Match[], caret: number): number => {
  if (matches.length === 0) return -1
  if (meta?.type === 'step') return (previous.activeIndex + meta.delta + matches.length) % matches.length
  if (meta?.type !== 'query') return Math.min(Math.max(previous.activeIndex, 0), matches.length - 1)
  const index = matches.findIndex((match) => match.from >= caret)
  return index === -1 ? 0 : index
}

/** One revealed set across a transaction: the freshly reported one, else the old one mapped through any doc change. */
const carryRevealed = (transaction: Transaction, reported: ReadonlySet<number> | undefined, previous: ReadonlySet<number>): ReadonlySet<number> =>
  reported ?? (transaction.docChanged ? new Set([...previous].map((pos) => transaction.mapping.map(pos, 1))) : previous)

/** The engine behind the channel's commands. Every step is metadata-only, and synchronous. */
const createController = (view: EditorView): FindController => {
  const findState = (): FindState => findKey.getState(view.state) ?? EMPTY
  const result = (): FindResult => {
    const { matches, activeIndex } = findState()
    return { total: matches.length, activeIndex }
  }
  const activeMatch = (): Match | null => {
    const { matches, activeIndex } = findState()
    return matches[activeIndex] ?? null
  }
  const dispatchMeta = (meta: FindMeta): void => {
    view.dispatch(view.state.tr.setMeta(findKey, meta))
  }
  const fold = (positions: readonly number[], collapsed: boolean): void => {
    setOutlineFoldSet(positions, collapsed, { silent: true })(view.state, view.dispatch)
  }
  const foldHeadings = (positions: readonly number[], collapsed: boolean): void => {
    setHeadingFoldSet(positions, collapsed, { silent: true })(view.state, view.dispatch)
  }
  /** The collapsed items hiding any of `positions`, as the document stands right now. */
  const hiders = (positions: readonly number[]): Set<number> => {
    const found = new Set<number>()
    for (const pos of positions) for (const item of collapsedItemsHiding(view.state, pos)) found.add(item)
    return found
  }
  /** The same, for collapsed heading sections. */
  const headingHiders = (positions: readonly number[]): Set<number> => {
    const found = new Set<number>()
    for (const pos of positions) for (const heading of collapsedHeadingsHiding(view.state, pos)) found.add(heading)
    return found
  }
  const differs = (next: ReadonlySet<number>, previous: ReadonlySet<number>): boolean =>
    next.size !== previous.size || [...next].some((pos) => !previous.has(pos))
  /**
   * Re-collapse what the search opened, then open what still hides a match: one pass covers both
   * the reveal and the re-collapse of an item the query has moved off. Both transactions land in
   * the same synchronous turn, so the outline is never rendered half-way. Bullets and headings ride
   * along together — a match can be hidden by either kind, or by both at once.
   */
  const reveal = (): void => {
    const previous = findState()
    fold([...previous.revealed], true)
    foldHeadings([...previous.revealedHeadings], true)
    const positions = findState().matches.map((match) => match.from)
    const revealed = hiders(positions)
    const revealedHeadings = headingHiders(positions)
    fold([...revealed], false)
    foldHeadings([...revealedHeadings], false)
    if (differs(revealed, previous.revealed) || differs(revealedHeadings, previous.revealedHeadings))
      dispatchMeta({ type: 'revealed', revealed, revealedHeadings })
  }
  /** jsdom has no `scrollIntoView` and the contract runs there, so the call stays optional. */
  const scrollToActive = (): void => {
    const match = activeMatch()
    if (match === null) return
    const { node } = view.domAtPos(match.from)
    const element = node instanceof Element ? node : node.parentElement
    element?.scrollIntoView?.({ block: 'center' })
  }
  return {
    search: (query) => {
      dispatchMeta({ type: 'query', query })
      reveal()
      scrollToActive()
      return result()
    },
    step: (delta) => {
      dispatchMeta({ type: 'step', delta })
      reveal()
      scrollToActive()
      return result()
    },
    close: () => {
      const { revealed, revealedHeadings } = findState()
      const match = activeMatch()
      fold([...revealed], true)
      foldHeadings([...revealedHeadings], true)
      // The landing stays open: whatever hides the active match is opened straight back.
      if (match !== null) {
        fold([...hiders([match.from])], false)
        foldHeadings([...headingHiders([match.from])], false)
      }
      const transaction = view.state.tr.setMeta(findKey, { type: 'clear' } satisfies FindMeta)
      if (match !== null) transaction.setSelection(TextSelection.create(transaction.doc, match.from))
      view.dispatch(transaction)
      view.focus()
    },
  }
}

const findPlugin = (channel: FindChannel) =>
  $prose(
    () =>
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply: (transaction, previous, oldState, newState) => {
            const meta: FindMeta | undefined = transaction.getMeta(findKey)
            if (meta?.type === 'clear') return EMPTY
            const query = meta?.type === 'query' ? meta.query : previous.query
            // Matches are RECOMPUTED, not mapped: an edit creates and destroys them, not just moves them.
            const recompute = meta?.type === 'query' || (transaction.docChanged && query !== '')
            const revealed = carryRevealed(transaction, meta?.type === 'revealed' ? meta.revealed : undefined, previous.revealed)
            const revealedHeadings = carryRevealed(
              transaction,
              meta?.type === 'revealed' ? meta.revealedHeadings : undefined,
              previous.revealedHeadings,
            )
            if (meta === undefined && !recompute && revealed === previous.revealed && revealedHeadings === previous.revealedHeadings)
              return previous
            const matches = recompute ? findMatches(newState.doc, query, zoomedRange(transaction, oldState, newState)) : previous.matches
            return { query, matches, activeIndex: nextActive(previous, meta, matches, newState.selection.from), revealed, revealedHeadings }
          },
        },
        props: {
          decorations: (state) => {
            const { matches, activeIndex } = findKey.getState(state) ?? EMPTY
            if (matches.length === 0) return DecorationSet.empty
            return DecorationSet.create(
              state.doc,
              matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === activeIndex ? `${FIND_MATCH_CLASS} ${FIND_ACTIVE_CLASS}` : FIND_MATCH_CLASS,
                }),
              ),
            )
          },
        },
        view: (editorView) => {
          const unbind = channel.bind(createController(editorView))
          // An edit under an open find changes the count without anyone asking; the bar hears it here.
          const sync = () => {
            const { matches, activeIndex } = findKey.getState(editorView.state) ?? EMPTY
            channel.sync({ total: matches.length, activeIndex })
          }
          return { update: sync, destroy: unbind }
        },
      }),
  )

/**
 * Escape closes an OPEN find and declines otherwise, so the key falls through untouched.
 * Priority 20: above escape-to-sidebar's 10 (Esc lands the search before it hands focus back to
 * the tree, YAZ-936), below the `[[` picker's 100.
 */
const findEscapeKeymap = (channel: FindChannel) =>
  $shortcut(() => ({
    FindEscape: {
      key: 'Escape',
      priority: 20,
      onRun: () => () => {
        if (!channel.getState().open) return false
        channel.close()
        return true
      },
    },
  }))

export function createFindInPage(channel: FindChannel) {
  return [findPlugin(channel), findEscapeKeymap(channel)]
}
