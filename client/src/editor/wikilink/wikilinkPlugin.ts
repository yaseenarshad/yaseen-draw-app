/**
 * Wikilink rendering in the editor (Links A, GRO-2190): `[[target]]` stays PLAIN TEXT in the
 * document (Crepe parses it as text; `postProcessMarkdown` un-escapes it on save) and a `$prose`
 * plugin renders it Obsidian-live-preview style with INLINE DECORATIONS only — never a schema or
 * serializer change, so round-trip stays byte-identical (`roundtrip.test.ts`).
 *
 * Display (caret outside the match):
 *  - the `[[` / `]]` brackets get `wikilink__syntax` (CSS `display: none`),
 *  - `[[target|alias]]` hides `target|` and shows only the alias,
 *  - `[[target#heading]]` shows `target > heading` (the `#` is hidden; each post-`#` segment
 *    carries `wikilink__sub`, whose CSS `::before` draws the ` > ` separator),
 *  - a match whose display would be EMPTY (`[[Note|]]`, `[[|]]`, `[[#]]`) stays raw — no
 *    decorations at all, so nothing ever collapses to a zero-width invisible run (FN12,
 *    GRO-2197),
 *  - visible segments get `wikilink` (accent + pointer cursor), plus `wikilink--unresolved`
 *    (dimmed) when the resolve source cannot find the target. Click handling lives in the
 *    sibling `wikilinkClick.ts` (Links C, GRO-2192), which navigates on mousedown over these
 *    decorated spans; this plugin stays decoration-only.
 *
 * Caret inside or immediately adjacent (selection overlapping the match, boundaries INCLUSIVE):
 * that match's decorations drop entirely — raw `[[syntax]]` is visible and editable. This is
 * also what makes arrow traversal work with `display: none` hiding: the caret can never sit
 * against hidden text, because by the time it reaches a match boundary the match is already raw.
 *
 * Exclusions: `![[…]]` embeds (image embeds stay plain),
 * `code_block` nodes and inline-`code` marked text (mirrors the index's `stripCode`,
 * CONTRACTS "Property index").
 *
 * Resolution: the ONE resolver (`views/engine.ts` `resolverFor`) reaches the plugin through a
 * `WikilinkResolveSource` — a mutable holder App owns. Index updates call `source.update(...)`,
 * which pokes every subscribed editor with a meta transaction: decorations recompute live, the
 * Crepe instance is never recreated and the document never changes.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Selection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { IndexRecord } from '@shared/types'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from './viewOnlyLinkSource'
import './wikilink.css'

export const WIKILINK_CLASS = 'wikilink'
export const WIKILINK_UNRESOLVED_CLASS = 'wikilink--unresolved'
export const WIKILINK_SYNTAX_CLASS = 'wikilink__syntax'
export const WIKILINK_SUB_CLASS = 'wikilink__sub'

/** Link target → resolved absolute path, or null when no note matches. */
export type ResolveLink = (target: string) => string | null

/** How the latest resolver reaches the plugin; see `createWikilinkResolveSource`. */
export interface WikilinkResolveSource {
  /** null until the vault index first loads — every link renders as resolved meanwhile. */
  readonly resolve: ResolveLink | null
  /**
   * The index snapshot `resolve` was built from — `[]` until the first index lands. The
   * decorations never read it; the backlinks section does (Links D, GRO-2193), and pairing it
   * with the resolver in ONE object is what guarantees the two can never come from different
   * snapshots.
   */
  readonly records: readonly IndexRecord[]
  /** Wakes subscribed editors (decoration recompute) whenever `resolve` is swapped. */
  subscribe(listener: () => void): () => void
}

export interface MutableWikilinkResolveSource extends WikilinkResolveSource {
  /**
   * Swap in a fresh resolver + its snapshot (index refetch) and notify every subscriber.
   * `records` omitted = no snapshot in play (decoration-only mounts): backlinks have nothing
   * to list, which is exactly right — the resolver alone cannot say who links where.
   */
  update(resolve: ResolveLink, records?: readonly IndexRecord[]): void
}

const NO_RECORDS: readonly IndexRecord[] = []

export function createWikilinkResolveSource(): MutableWikilinkResolveSource {
  let current: ResolveLink | null = null
  let snapshot: readonly IndexRecord[] = NO_RECORDS
  const listeners = new Set<() => void>()
  return {
    get resolve() {
      return current
    },
    get records() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(resolve, records = NO_RECORDS) {
      current = resolve
      snapshot = records
      listeners.forEach((l) => l())
    },
  }
}

/** Non-embed wiki links; inner brackets are unrepresentable (same shape as the index's WIKILINK_RE). */
export const WIKILINK_RE = /(!?)\[\[([^[\]]+)\]\]/g

/**
 * The page-name half of a raw `[[inner]]` text: `|alias` and `#heading` / `#^block` stripped,
 * trimmed. '' for the same-file `[[#h]]` form. The ONE strip shared by the decorations below,
 * click navigation and create-on-click (`wikilinkClick.ts` / `createFromLink.ts`, Links C).
 */
export function linkPageName(inner: string): string {
  return inner.split('|')[0].split('#')[0].trim()
}

/**
 * The DISPLAY text the collapsed decorations show for a raw `[[inner]]` match: the alias after
 * the first `|` when piped, else the non-empty `#`-split parts joined with the ` > ` separator
 * the CSS draws between segments. '' means NOTHING would be visible (`[[Note|]]`, `[[|]]`,
 * `[[#]]`) — such a match stays raw (FN12, GRO-2197; see `decorate`). Exported for the
 * backlinks snippets (FN9, GRO-2197), which must read exactly as the editor renders: one
 * mapping, never a second regex.
 */
export function linkDisplayText(inner: string): string {
  const pipe = inner.indexOf('|')
  if (pipe >= 0) return inner.slice(pipe + 1)
  return inner
    .split('#')
    .filter((part) => part.length > 0)
    .join(' > ')
}

const wikilinkKey = new PluginKey<DecorationSet>('mdapp-wikilink')

/**
 * Calls `cb` for every maximal run of plain text (consecutive text children WITHOUT the
 * inlineCode mark) in `block`. Adjacent text children are contiguous in document positions,
 * so `runPos + offset-in-run` addresses any character of the run. Exported for
 * `wikilinkClick.ts`, which re-finds the clicked match over the same runs.
 */
export function eachPlainRun(block: ProseNode, base: number, cb: (text: string, runPos: number) => void): void {
  let text = ''
  let start = -1
  block.forEach((child, offset) => {
    if (child.isText && !child.marks.some((m) => m.type.name === 'inlineCode')) {
      if (start < 0) start = offset
      text += child.text ?? ''
      return
    }
    if (start >= 0) cb(text, base + start)
    text = ''
    start = -1
  })
  if (start >= 0) cb(text, base + start)
}

/** Push a hidden-syntax decoration (empty ranges are skipped). */
function hide(out: Decoration[], from: number, to: number): void {
  if (from < to) out.push(Decoration.inline(from, to, { class: WIKILINK_SYNTAX_CLASS }))
}

/** Decorations for one collapsed match: `[[inner]]` starting at `start`. */
function linkIsResolved(inner: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): boolean {
  const viewSource = viewOnly
  const viewTarget = viewSource === undefined ? null : viewOnlyLinkTarget(inner)
  if (viewTarget !== null && viewSource !== undefined) {
    if (viewTarget.hasSubtarget) return false
    return viewSource.resolve === null || viewSource.resolve(viewTarget.page) !== null
  }
  const target = linkPageName(inner)
  return source.resolve === null || target === '' || source.resolve(target) !== null
}

function decorate(out: Decoration[], start: number, inner: string, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): void {
  // A match whose display would be EMPTY ([[Note|]], [[|]], [[#]]) gets NO decorations at all:
  // hiding every character would leave a zero-width invisible run the click handler cannot see
  // and only exact caret placement can recover — raw-and-editable, the revealed state, is the
  // consistent answer (FN12, GRO-2197).
  if (linkDisplayText(inner) === '') return
  const resolved = linkIsResolved(inner, source, viewOnly)
  const cls = resolved ? WIKILINK_CLASS : `${WIKILINK_CLASS} ${WIKILINK_UNRESOLVED_CLASS}`
  const innerStart = start + 2
  const end = innerStart + inner.length + 2
  hide(out, start, innerStart) // [[
  const pipe = inner.indexOf('|')
  if (pipe >= 0) {
    hide(out, innerStart, innerStart + pipe + 1) // target(#heading)?| — the alias is the display
    out.push(Decoration.inline(innerStart + pipe + 1, end - 2, { class: cls })) // never empty: guarded above
  } else {
    // target, then ` > `-separated sub segments for each `#heading` / `#^block` part
    let at = innerStart
    let shown = 0
    const parts = inner.split('#')
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        hide(out, at, at + 1) // the #
        at += 1
      }
      const part = parts[i]
      if (part.length > 0) {
        out.push(Decoration.inline(at, at + part.length, { class: shown > 0 ? `${cls} ${WIKILINK_SUB_CLASS}` : cls }))
        shown++
      }
      at += part.length
    }
  }
  hide(out, end - 2, end) // ]]
}

/** True when the selection touches [from, to] with inclusive boundaries — the reveal rule. */
function touches(sel: Selection, from: number, to: number): boolean {
  return sel.from <= to && sel.to >= from
}

function build(state: EditorState, source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource): DecorationSet {
  const decorations: Decoration[] = []
  const sel = state.selection
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') return false
    if (!node.isTextblock) return true
    eachPlainRun(node, pos + 1, (text, runPos) => {
      for (const m of text.matchAll(WIKILINK_RE)) {
        if (m[1] === '!') continue // embeds are someone else's (or nobody's) business
        const from = runPos + m.index
        const to = from + m[0].length
        if (touches(sel, from, to)) continue // caret inside/adjacent → raw, editable syntax
        decorate(decorations, from, m[2], source, viewOnly)
      }
    })
    return false
  })
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, decorations)
}

export function createWikilink(source: WikilinkResolveSource, viewOnly?: ViewOnlyLinkSource) {
  return $prose(
    () =>
      new Plugin({
        key: wikilinkKey,
        state: {
          init: (_, state) => build(state, source, viewOnly),
          apply: (tr, set, _old, state) =>
            tr.docChanged || tr.selectionSet || tr.getMeta(wikilinkKey) !== undefined ? build(state, source, viewOnly) : set,
        },
        props: {
          decorations: (state) => wikilinkKey.getState(state),
        },
        view: (editorView) => {
          const unsubscribe = source.subscribe(() => {
            editorView.dispatch(editorView.state.tr.setMeta(wikilinkKey, 'resolver-updated'))
          })
          const unsubscribeViewOnly = viewOnly?.subscribe(() => {
            editorView.dispatch(editorView.state.tr.setMeta(wikilinkKey, 'view-only-resolver-updated'))
          })
          return {
            destroy: () => {
              unsubscribe()
              unsubscribeViewOnly?.()
            },
          }
        },
      }),
  )
}
