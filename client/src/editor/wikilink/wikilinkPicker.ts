/**
 * The `[[` link picker (Links B, GRO-2191): typing `[[` in the editor opens a suggestion popup
 * over every markdown note in the vault; typing filters, ↑/↓ navigate, Enter/click INSERTS THE
 * PLAIN TEXT `[[name]]` (the A- decorations restyle it on their next pass — never a schema or
 * doc-structure change, so round-trip stays byte-identical), Esc dismisses leaving the typed
 * text as-is.
 *
 * Anatomy — three cooperating pieces, one module:
 *  - a `$prose` plugin OWNS the state: the active completion session (position of the `[[`, the
 *    fragment before the caret, the matched rows, the highlighted index) recomputed per
 *    transaction from doc + selection, plus the Esc-dismissed anchor so the same `[[` never
 *    reopens until the caret leaves it. Candidates come from a `WikilinkCandidateSource` — the
 *    same mutable-holder pattern as A-'s resolve source: App owns one per window,
 *    `WikilinkIndexBridge` feeds it `linkCandidates(records)` per index snapshot, updates poke
 *    subscribed editors with a meta transaction (live rows, no remount). A CLOSED picker only ever
 *    OPENS on a doc-changing transaction (YAZ-908) — moving the caret into a closed `[[Alpha]]`
 *    reads like a fresh `[[Al` before it, so caret movement (and a candidate refresh) must never
 *    pop the popup; an already-open session survives caret moves within its own `[[`.
 *  - `SlashProvider` (@milkdown/kit/plugin/slash — the locked foundation; the machinery behind
 *    Crepe's own `/` menu) POSITIONS the popup element at the caret via floating-ui and toggles
 *    `data-show`. Its single-character `trigger` cannot express `[[`, so it runs with a custom
 *    `shouldShow` that just reads the plugin state; row rendering stays ours (plain DOM — the
 *    rows are ≤ 9 buttons). The `session === last` guard in `render` is an IDENTITY check and
 *    the plugin builds a fresh session object per transaction, so while the picker is open the
 *    rows are in fact rebuilt on every keystroke (GRO-2197 audit): ≤ 9 buttons of DOM, measured
 *    as not worth a structural comparison yet — recorded here so the next reader is not misled.
 *  - `wikilinkPickerKeymap` (`$shortcut`, priority 100 — CONTRACTS "Keyboard") binds
 *    ↑/↓/Enter/Esc. Every command returns false when no session is open, so the keys fall
 *    through untouched (the outliner keeps Enter in lists, Crepe keeps its arrows). Enter ties
 *    with the outliner's priority-100 Enter — createCrepe registers this keymap FIRST, and
 *    KeymapManager runs equal priorities in addition order, so an open picker wins
 *    (`wikilinkPicker.test.ts` pins it).
 *
 * Matching is the shared `links/completion.ts` (one matcher with the Bases cell editors —
 * locked ruling): case-insensitive substring, cap 8. A note with frontmatter aliases (E2,
 * GRO-2214) is offered twice — under its name (inserting `[[Name]]`) and under each alias,
 * which READS `CAC — Customer Acquisition Cost` and INSERTS the piped `[[Customer Acquisition
 * Cost|CAC]]`, so the link targets the note and displays the alias. When nothing matches a
 * non-empty fragment, a single "Create" row inserts `[[typed text]]` as-is AND creates the page
 * (YAZ-1357, 🔒 D3 revised — through Links C's own `createFromLink`, staying put; see
 * `createPage`). A `|` in the fragment is alias
 * entry: the popup closes and typing continues as plain text. Code is excluded like the
 * decorations: no picker inside `code_block` or inline-`code` text.
 */
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Plugin, PluginKey, TextSelection, type Command } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { SlashProvider } from '@milkdown/kit/plugin/slash'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { matchLinkCandidates, trailingLinkFragment, type LinkCandidate } from '../../links/completion'
import { createFromLink } from './createFromLink'
import type { WikilinkNav } from './wikilinkClick'
import { linkPageName } from './wikilinkPlugin'
import './wikilinkPicker.css'

export const WIKILINK_PICKER_CLASS = 'wikilink-picker'
export const WIKILINK_PICKER_ITEM_CLASS = 'wikilink-picker__item'
export const WIKILINK_PICKER_CREATE_CLASS = 'wikilink-picker__item--create'

/** How the vault's candidates reach the picker; see `createWikilinkCandidateSource`. */
export interface WikilinkCandidateSource {
  /** Shortest unambiguous names + alias rows (`linkCandidates`); `[]` until the index first loads. */
  readonly candidates: readonly LinkCandidate[]
  /** Wakes subscribed editors (row recompute) whenever `candidates` is swapped. */
  subscribe(listener: () => void): () => void
}

export interface MutableWikilinkCandidateSource extends WikilinkCandidateSource {
  /** Swap in a fresh candidate list (index refetch) and notify every subscribed editor. */
  update(candidates: readonly LinkCandidate[]): void
}

export function createWikilinkCandidateSource(): MutableWikilinkCandidateSource {
  let current: readonly LinkCandidate[] = []
  const listeners = new Set<() => void>()
  return {
    get candidates() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(candidates) {
      current = candidates
      listeners.forEach((l) => l())
    },
  }
}

/**
 * One popup row: shows `label`, inserts `[[insert]]` — the two differ for an alias row, which
 * reads `CAC — Customer Acquisition Cost` and inserts the piped `[[Customer Acquisition
 * Cost|CAC]]` (E2, GRO-2214). `create` rows show as Create "…" (nothing matched) and make the page.
 */
interface PickerRow {
  label: string
  insert: string
  create: boolean
}

interface PickerSession {
  /** Doc position of the `[[`'s first bracket. */
  from: number
  /** The caret (end of the fragment) — the insert replaces from..to. */
  to: number
  fragment: string
  rows: PickerRow[]
  selected: number
}

interface PickerState {
  session: PickerSession | null
  /** `from` of an Esc-dismissed `[[`: that session stays closed until the context dissolves. */
  dismissed: number | null
}

type PickerMeta = { type: 'move'; delta: 1 | -1 } | { type: 'dismiss' } | { type: 'refresh' }

const pickerKey = new PluginKey<PickerState>('mdapp-wikilink-picker')

/** The unclosed `[[fragment` ending at the caret, or null (no cursor / code / alias `|`). */
function findContext(state: EditorState): { from: number; to: number; fragment: string } | null {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || !sel.empty) return null
  const $from = sel.$from
  const parent = $from.parent
  if (!parent.isTextblock || parent.type.spec.code) return null
  if ($from.marks().some((m) => m.type.name === 'inlineCode')) return null
  // Leaf nodes become one object-replacement char, so offsets in `before` = parent offsets.
  const before = parent.textBetween(0, $from.parentOffset, undefined, '￼')
  const fragment = trailingLinkFragment(before)
  if (fragment === null || fragment.includes('|')) return null
  return { from: $from.pos - fragment.length - 2, to: $from.pos, fragment }
}

/** Matches through the shared matcher; a non-empty fragment nothing matches offers Create. */
function rowsFor(fragment: string, candidates: readonly LinkCandidate[]): PickerRow[] {
  const matches = matchLinkCandidates(candidates, fragment)
  if (matches.length > 0) return matches.map(({ label, insert }) => ({ label, insert, create: false }))
  return fragment.trim() === '' ? [] : [{ label: fragment, insert: fragment, create: true }]
}

function compute(state: EditorState, prev: PickerState | null, tr: Transaction | null, source: WikilinkCandidateSource): PickerState {
  const meta = tr?.getMeta(pickerKey) as PickerMeta | undefined
  let dismissed = prev === null || prev.dismissed === null ? null : tr?.docChanged ? tr.mapping.map(prev.dismissed) : prev.dismissed
  if (meta?.type === 'dismiss' && prev?.session != null) dismissed = prev.session.from
  const ctx = findContext(state)
  if (ctx === null) return { session: null, dismissed: null } // context gone: a fresh [[ starts clean
  if (dismissed !== null && ctx.from === dismissed) return { session: null, dismissed }
  // Only TYPING opens a closed picker (YAZ-908): walking the caret into a closed `[[Alpha]]` reads
  // like a fresh `[[Al` but must stay shut. `from` needs no mapping — when the doc changed the gate
  // passes anyway, and when it did not the positions are already comparable.
  const sameOpen = prev?.session != null && prev.session.from === ctx.from
  if (!sameOpen && tr?.docChanged !== true) return { session: null, dismissed }
  const rows = rowsFor(ctx.fragment, source.candidates)
  if (rows.length === 0) return { session: null, dismissed }
  const held =
    prev?.session != null && tr !== null && !tr.docChanged && prev.session.from === ctx.from && prev.session.fragment === ctx.fragment
      ? Math.min(prev.session.selected, rows.length - 1)
      : 0
  const selected = meta?.type === 'move' ? (held + meta.delta + rows.length) % rows.length : held
  return { session: { ...ctx, rows, selected }, dismissed }
}

/**
 * The Create row's other half (YAZ-1357, 🔒 D3 revised): the page is BORN here, not on a later
 * click — Yasin's ruling, so a picked "Create" shows up in the sidebar at once. Same placement as
 * create-on-click (`createFromLink` under `nav.createFolder()`), no navigation (the caret keeps
 * typing; the link turns from dim to resolved on the index echo, and in an outline the reconcile
 * pass tags the member), one passive notice either way. Without a nav there is no vault to create
 * in, so the row only inserts.
 */
function createPage(nav: WikilinkNav | undefined, name: string): void {
  if (nav === undefined) return
  void createFromLink(nav.root, name, nav.createFolder()).then((result) => {
    if (result.status === 'error') nav.onNotice(result.message)
    else if (result.status === 'created') nav.onNotice(`Created "${linkPageName(name)}"`)
  })
}

/** Replace the `[[fragment` with the full `[[insert]]` text, park the caret after it — and, for the Create row, make the page. */
function insertRow(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, session: PickerSession, row: PickerRow, nav?: WikilinkNav): boolean {
  if (dispatch) {
    const text = `[[${row.insert}]]`
    const tr = state.tr.insertText(text, session.from, session.to)
    tr.setSelection(TextSelection.create(tr.doc, session.from + text.length))
    dispatch(tr.scrollIntoView())
    if (row.create) createPage(nav, row.insert)
  }
  return true
}

const insertSelected = (nav?: WikilinkNav): Command => (state, dispatch) => {
  const session = pickerKey.getState(state)?.session ?? null
  if (session === null) return false
  const row = session.rows[session.selected]
  if (row === undefined) return false
  return insertRow(state, dispatch, session, row, nav)
}

const move = (delta: 1 | -1): Command => (state, dispatch) => {
  if (pickerKey.getState(state)?.session == null) return false
  if (dispatch) dispatch(state.tr.setMeta(pickerKey, { type: 'move', delta } satisfies PickerMeta))
  return true
}

const dismiss: Command = (state, dispatch) => {
  if (pickerKey.getState(state)?.session == null) return false
  if (dispatch) dispatch(state.tr.setMeta(pickerKey, { type: 'dismiss' } satisfies PickerMeta))
  return true
}

/** Priority above Crepe's keymaps (50); registered before the outliner so Enter ties break to us. */
const PRIORITY = 100

/**
 * ↑/↓/Enter/Esc while the picker is open; every command declines (false) when it is closed, so
 * the keys fall through — the outliner keeps Tab/Enter in lists, nothing is ever swallowed.
 */
export const createWikilinkPickerKeymap = (nav?: WikilinkNav) =>
  $shortcut(() => ({
    WikilinkPickerNext: { key: 'ArrowDown', priority: PRIORITY, onRun: () => move(1) },
    WikilinkPickerPrev: { key: 'ArrowUp', priority: PRIORITY, onRun: () => move(-1) },
    WikilinkPickerInsert: { key: 'Enter', priority: PRIORITY, onRun: () => insertSelected(nav) },
    WikilinkPickerDismiss: { key: 'Escape', priority: PRIORITY, onRun: () => dismiss },
  }))

/** The popup element + its rows; mousedown-preventDefault so picking never blurs the editor. */
function buildPopup(view: EditorView, nav?: WikilinkNav): { element: HTMLElement; render: (session: PickerSession | null) => void } {
  const element = document.createElement('div')
  element.className = WIKILINK_PICKER_CLASS
  element.setAttribute('role', 'listbox')
  element.setAttribute('aria-label', 'Link suggestions')
  let last: PickerSession | null = null
  const render = (session: PickerSession | null) => {
    if (session === last) return
    last = session
    element.replaceChildren()
    if (session === null) return
    session.rows.forEach((row, i) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'option')
      item.className = row.create ? `${WIKILINK_PICKER_ITEM_CLASS} ${WIKILINK_PICKER_CREATE_CLASS}` : WIKILINK_PICKER_ITEM_CLASS
      item.setAttribute('aria-selected', String(i === session.selected))
      item.textContent = row.create ? `Create "${row.label}"` : row.label
      item.addEventListener('mousedown', (e) => e.preventDefault())
      item.addEventListener('click', () => {
        // Re-read the live session: the state may have moved between render and click.
        const current = pickerKey.getState(view.state)?.session ?? null
        if (current === null) return
        const liveRow = current.rows[i]
        if (liveRow === undefined) return
        insertRow(view.state, (tr) => view.dispatch(tr), current, liveRow, nav)
        view.focus()
      })
      element.appendChild(item)
    })
  }
  return { element, render }
}

export function createWikilinkPicker(source: WikilinkCandidateSource, nav?: WikilinkNav) {
  return $prose(
    () =>
      new Plugin<PickerState>({
        key: pickerKey,
        state: {
          init: (_, state) => compute(state, null, null, source),
          apply: (tr, value, _old, state) =>
            tr.docChanged || tr.selectionSet || tr.getMeta(pickerKey) !== undefined ? compute(state, value, tr, source) : value,
        },
        view: (editorView) => {
          const popup = buildPopup(editorView, nav)
          // Attached (hidden) from the start — the provider would only append it on its first
          // debounced pass; its later appendChild of the same node into the same parent is a no-op.
          popup.element.dataset.show = 'false'
          editorView.dom.parentElement?.appendChild(popup.element)
          const provider = new SlashProvider({
            content: popup.element,
            debounce: 0, // state is already exact per transaction; only positioning is deferred
            shouldShow: (view) => pickerKey.getState(view.state)?.session != null,
          })
          const unsubscribe = source.subscribe(() => {
            editorView.dispatch(editorView.state.tr.setMeta(pickerKey, { type: 'refresh' } satisfies PickerMeta))
          })
          return {
            update: (view, prevState) => {
              const session = pickerKey.getState(view.state)?.session ?? null
              popup.render(session)
              // hide() directly when closed: the provider's own update skips meta-only
              // transactions (same doc + selection — exactly what Esc's dismiss is).
              if (session === null) provider.hide()
              else provider.update(view, prevState)
            },
            destroy: () => {
              unsubscribe()
              provider.destroy()
              popup.element.remove()
            },
          }
        },
      }),
  )
}
