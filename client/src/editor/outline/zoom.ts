/**
 * Zoom into a bullet (GRO-2029), obsidian-zoom / Workflowy style.
 *
 * Design: zoom is VIEW STATE ONLY. The plugin state holds the position of the zoomed
 * `list_item` (mapped through every transaction, like the fold plugin's collapsed set) and
 * renders two kinds of decorations:
 *  - node decorations adding `outline-zoom-hidden` (CSS `display:none`) to every block that is
 *    not on the path from the doc root to the zoomed item and not inside it, plus
 *    `outline-zoom-ancestor` on the ancestor list_items (their glyph/chevron are hidden and a
 *    folded ancestor is shown expanded — fold state itself is untouched);
 *  - a breadcrumb widget at the start of the document: `File › Ancestor › … › Zoomed`. Each crumb
 *    zooms to that ancestor; the file-name crumb zooms out fully.
 * Zooming dispatches a metadata-only transaction (`tr.docChanged === false`), so the listener never
 * fires `markdownUpdated`, the file on disk is untouched and fold state is unaffected. Zoom is not
 * persisted: switching files remounts the editor and therefore clears it.
 *
 * Browser history (GRO-2091 A): every zoom change pushes one in-memory history entry
 * (`{ [ZOOM_HISTORY_KEY]: { file, key } }`, URL untouched — the 2-arg `pushState`, since an empty
 * URL argument would resolve away the `#/path.md` hash) and `popstate` restores that level, so
 * Back / Forward walk zoom levels. Keys are the fold-key scheme (first-block text + occurrence)
 * counted over ALL list items; entries of another file are ignored, an unresolvable key zooms out.
 *
 * ⌘Z panic-undo (GRO-2091 B, same rule as folds in GRO-2075): the state remembers the level
 * before the latest zoom change while that change is the latest VIEW action — cleared by a user
 * document change (plugin-appended transactions excepted) or by a fold (viewActions.ts stamp).
 * `undoLastZoom` (Mod-z, priority 100) reverts exactly that one step and declines otherwise.
 *
 * Triggers: click on the bullet glyph (`.label-wrapper`; task checkboxes keep toggling instead),
 * `Mod-.` = zoom into the item at the caret, `Mod-Shift-.` = zoom out one level. While zoomed,
 * `Shift-Tab` / `Mod-[` on the zoomed item or one of its direct children is a no-op (lifting would
 * move the item out of the visible subtree).
 */
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, Selection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { ancestorItemPositions, innermostItemPos, isListItem, itemLabelText } from './listNodes'
import { getOutlineFoldKey, outlineFoldLabel } from './outlineFoldKeys'
import { VIEW_ACTION_META, type ViewAction } from './viewActions'

export interface ZoomOptions {
  /** Shown as the first breadcrumb; clicking it zooms out fully. */
  fileName: string
}

interface ZoomState {
  /** Position of the zoomed list_item, or null when not zoomed. */
  itemPos: number | null
  /** Breadcrumb root and the `file` stamped on history entries (so another file's entries are ignored). */
  fileName: string
  /**
   * ⌘Z target: the level before the latest zoom change, kept while that change is still the latest
   * view action. `undefined` = nothing to revert; `null` = revert to zoomed-out.
   */
  undoLevel: ZoomLevel | undefined
}

/** A zoom level: position of the zoomed list_item, or `null` = zoomed out. Also the plugin's transaction meta. */
type ZoomLevel = number | null
/** Set on the ⌘Z revert transaction: it consumes the pending undo instead of creating a new one. */
const UNDO_META = 'mdapp-outline-zoom-undo'

export const ZOOM_HIDDEN_CLASS = 'outline-zoom-hidden'
export const ZOOM_ANCESTOR_CLASS = 'outline-zoom-ancestor'
export const ZOOM_CRUMBS_CLASS = 'outline-zoom-crumbs'
export const ZOOM_CRUMB_CLASS = 'outline-zoom-crumb'
/** Property on `history.state` carrying `{ file, key }` (`key` null = zoomed out) for this file. */
export const ZOOM_HISTORY_KEY = 'mdappZoom'

interface ZoomHistoryEntry {
  file: string
  key: string | null
}

const LABEL_MAX_CHARS = 40
/** Priority above Crepe's keymaps (50), like `listCommands.ts` / `hotkeys.ts`. */
const PRIORITY = 100

const pluginKey = new PluginKey<ZoomState>('mdapp-outline-zoom')

/** Position of the zoomed list_item (null when not zoomed or when the plugin is absent). */
export const getZoomedItemPos = (state: EditorState): number | null => pluginKey.getState(state)?.itemPos ?? null

/**
 * Walk every list_item in document order with its zoom key — fold-key scheme, but the occurrence
 * index counts ALL items (fold keys only count parents), so this is a separate key space.
 * `visit` returning true ends the visits (the underlying `descendants` still iterates, skipping
 * children — fine at document scale).
 */
const eachItemKey = (doc: ProseNode, visit: (pos: number, key: string) => boolean): void => {
  const occurrences = new Map<string, number>()
  let stop = false
  doc.descendants((node, pos) => {
    if (stop) return false
    if (!isListItem(node)) return true
    const label = itemLabelText(node)
    const keyLabel = outlineFoldLabel(label)
    const occurrence = occurrences.get(keyLabel) ?? 0
    occurrences.set(keyLabel, occurrence + 1)
    if (visit(pos, getOutlineFoldKey(label, occurrence))) stop = true
    return !stop
  })
}

/** Position-independent key of the list_item at `itemPos` (null when there is no item there). */
export const zoomKeyAt = (doc: ProseNode, itemPos: number): string | null => {
  let found: string | null = null
  eachItemKey(doc, (pos, key) => {
    if (pos !== itemPos) return false
    found = key
    return true
  })
  return found
}

/** Position of the list_item with zoom key `key`, or null when it no longer exists. */
export const itemPosForZoomKey = (doc: ProseNode, key: string): number | null => {
  let found: number | null = null
  eachItemKey(doc, (pos, itemKey) => {
    if (itemKey !== key) return false
    found = pos
    return true
  })
  return found
}

const readZoomEntry = (state: unknown): ZoomHistoryEntry | null => {
  if (typeof state !== 'object' || state === null) return null
  const entry = (state as Record<string, unknown>)[ZOOM_HISTORY_KEY]
  if (typeof entry !== 'object' || entry === null) return null
  const { file, key } = entry as Record<string, unknown>
  return typeof file === 'string' && (typeof key === 'string' || key === null) ? { file, key } : null
}

/** Breadcrumb label: the item's first-block text, truncated. */
const itemLabel = (item: ProseNode): string => {
  const text = itemLabelText(item)
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…` : text
}

/** Position of the innermost list_item containing the selection head, or null outside lists. */
const itemAtSelection = (state: EditorState): number | null => innermostItemPos(state.selection.$from)

/**
 * Zoom into the list_item at `itemPos` (null = zoom out fully); moves the caret into it if the
 * selection was outside. Every user-driven zoom change pushes a history entry; `fromHistory`
 * (popstate) restores a level without pushing another.
 */
const zoomTo = (itemPos: ZoomLevel, { fromHistory = false, isUndo = false } = {}): Command => (state, dispatch) => {
  const zoom = pluginKey.getState(state)
  if (!zoom || zoom.itemPos === itemPos) return false
  if (itemPos !== null && !isListItem(state.doc.nodeAt(itemPos))) return false
  if (dispatch) {
    const tr = state.tr.setMeta(pluginKey, itemPos).setMeta(VIEW_ACTION_META, 'zoom' satisfies ViewAction)
    if (isUndo) tr.setMeta(UNDO_META, true)
    if (itemPos !== null) {
      const item = state.doc.nodeAt(itemPos)
      const { from, to } = state.selection
      const inside = item !== null && from >= itemPos && to <= itemPos + item.nodeSize
      if (!inside) tr.setSelection(Selection.near(tr.doc.resolve(itemPos + 1), 1))
    }
    if (!fromHistory) {
      const entry: ZoomHistoryEntry = { file: zoom.fileName, key: itemPos === null ? null : zoomKeyAt(state.doc, itemPos) }
      // No URL argument: an empty string would resolve against the document and drop `#/path.md`.
      history.pushState({ [ZOOM_HISTORY_KEY]: entry }, '')
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

/**
 * `Mod-z` (GRO-2091 B): revert the latest zoom change iff it is still the latest view action;
 * declines otherwise so the fold undo / ProseMirror history get the key. The revert is itself a
 * zoom change (history entry pushed, so Back returns to the zoomed view) and consumes the undo.
 */
export const undoLastZoom: Command = (state, dispatch) => {
  const undoLevel = pluginKey.getState(state)?.undoLevel
  if (undoLevel === undefined) return false
  return zoomTo(undoLevel, { isUndo: true })(state, dispatch)
}

/** `Mod-.`: zoom into the item at the caret. */
const zoomIntoSelection: Command = (state, dispatch) => {
  const itemPos = itemAtSelection(state)
  return itemPos === null ? false : zoomTo(itemPos)(state, dispatch)
}

/** `Mod-Shift-.`: zoom out one level (to the parent item, or fully when the zoomed item is top-level). */
const zoomOutOneLevel: Command = (state, dispatch) => {
  const itemPos = getZoomedItemPos(state)
  if (itemPos === null) return false
  const parents = ancestorItemPositions(state.doc.resolve(itemPos))
  return zoomTo(parents.length > 0 ? parents[parents.length - 1] : null)(state, dispatch)
}

/**
 * Swallow a lift (`Shift-Tab` / `Mod-[`) that would move the caret's item out of the zoomed
 * subtree: the zoomed item itself or one of its direct children.
 */
const blockEscapingLift: Command = (state) => {
  const itemPos = getZoomedItemPos(state)
  if (itemPos === null) return false
  const positions = ancestorItemPositions(state.selection.$from)
  const index = positions.indexOf(itemPos)
  return index >= 0 && positions.length - index <= 2
}

const crumbButton = (view: EditorView, label: string, target: ZoomLevel, current: boolean): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = ZOOM_CRUMB_CLASS
  button.textContent = label
  button.disabled = current
  if (current) button.setAttribute('aria-current', 'location')
  // Keep the caret where it is: crumbs must not steal focus or move the selection.
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    zoomTo(target)(view.state, view.dispatch)
  })
  return button
}

const buildDecorations = (state: EditorState, itemPos: number, fileName: string): Decoration[] => {
  const $item = state.doc.resolve(itemPos)
  const zoomed = $item.nodeAfter
  const decorations: Decoration[] = []
  if (!isListItem(zoomed)) return decorations
  const crumbs: Array<{ label: string; target: ZoomLevel }> = [{ label: fileName, target: null }]

  // Walk the containers on the path root → zoomed item; hide every child that is off the path.
  for (let depth = 0; depth <= $item.depth; depth++) {
    const container = $item.node(depth)
    if (isListItem(container)) {
      const pos = $item.before(depth)
      decorations.push(Decoration.node(pos, pos + container.nodeSize, { class: ZOOM_ANCESTOR_CLASS }))
      crumbs.push({ label: itemLabel(container), target: pos })
    }
    const pathIndex = $item.index(depth)
    container.forEach((child, _offset, index) => {
      if (index === pathIndex) return
      const pos = $item.posAtIndex(index, depth)
      decorations.push(Decoration.node(pos, pos + child.nodeSize, { class: ZOOM_HIDDEN_CLASS }))
    })
  }
  crumbs.push({ label: itemLabel(zoomed), target: itemPos })

  decorations.push(
    Decoration.widget(
      0,
      (view) => {
        const nav = document.createElement('nav')
        nav.className = ZOOM_CRUMBS_CLASS
        nav.setAttribute('aria-label', 'Zoom breadcrumbs')
        nav.contentEditable = 'false'
        crumbs.forEach((crumb, index) => {
          if (index > 0) {
            const separator = document.createElement('span')
            separator.className = `${ZOOM_CRUMB_CLASS}-separator`
            separator.setAttribute('aria-hidden', 'true')
            separator.textContent = '›'
            nav.appendChild(separator)
          }
          nav.appendChild(crumbButton(view, crumb.label, crumb.target, index === crumbs.length - 1))
        })
        return nav
      },
      { side: -1, key: `outline-zoom-crumbs:${itemPos}:${crumbs.map((c) => c.label).join('\u0000')}` },
    ),
  )
  return decorations
}

/** The list_item whose bullet glyph (`.label-wrapper`) received `event`, or null. */
const itemPosFromGlyphClick = (view: EditorView, event: MouseEvent): number | null => {
  const target = event.target
  if (!(target instanceof Element)) return null
  const wrapper = target.closest('.label-wrapper')
  if (wrapper === null || !view.dom.contains(wrapper)) return null
  // Task checkboxes toggle on click (Crepe); only plain bullets / ordered labels zoom.
  if (wrapper.querySelector('.label.checked, .label.unchecked') !== null) return null
  const $pos = view.state.doc.resolve(view.posAtDOM(wrapper, 0))
  return isListItem($pos.parent) ? $pos.before() : null
}

export const createOutlineZoom = ({ fileName }: ZoomOptions) =>
  $prose(
    () =>
      new Plugin<ZoomState>({
        key: pluginKey,
        state: {
          init: () => ({ itemPos: null, fileName, undoLevel: undefined }),
          apply: (transaction, previous, _oldState, newState) => {
            const meta: ZoomLevel | undefined = transaction.getMeta(pluginKey)
            if (meta !== undefined) {
              // ⌘Z-revertible while it is the latest view action; the revert itself consumes it.
              return { ...previous, itemPos: meta, undoLevel: transaction.getMeta(UNDO_META) ? undefined : previous.itemPos }
            }
            let { itemPos, undoLevel } = previous
            // A newer view action of another kind — a bullet or heading fold (YAZ-1140) — owns ⌘Z now (viewActions.ts).
            const viewAction: unknown = transaction.getMeta(VIEW_ACTION_META)
            if (viewAction !== undefined && viewAction !== 'zoom') undoLevel = undefined
            if (transaction.docChanged) {
              // User edits hand ⌘Z back to history; plugin-appended transactions (Crepe's trailing
              // paragraph) are not user actions and only map the remembered position.
              if (transaction.getMeta('appendedTransaction') === undefined) undoLevel = undefined
              else if (typeof undoLevel === 'number') {
                const mappedLast = transaction.mapping.mapResult(undoLevel, 1)
                undoLevel = !mappedLast.deleted && isListItem(newState.doc.nodeAt(mappedLast.pos)) ? mappedLast.pos : undefined
              }
              if (itemPos !== null) {
                const mapped = transaction.mapping.mapResult(itemPos, 1)
                itemPos = !mapped.deleted && isListItem(newState.doc.nodeAt(mapped.pos)) ? mapped.pos : null
              }
            }
            return itemPos === previous.itemPos && undoLevel === previous.undoLevel ? previous : { ...previous, itemPos, undoLevel }
          },
        },
        view: (view) => {
          // Back / Forward: restore the entry's level. Entries of another file (left behind by a
          // file switch) are ignored; the original page entry (no zoom state) means zoomed out.
          const onPopState = (event: PopStateEvent) => {
            const entry = readZoomEntry(event.state)
            if (entry !== null && entry.file !== pluginKey.getState(view.state)?.fileName) return
            const target = entry?.key == null ? null : itemPosForZoomKey(view.state.doc, entry.key)
            zoomTo(target, { fromHistory: true })(view.state, view.dispatch)
          }
          window.addEventListener('popstate', onPopState)
          return { destroy: () => window.removeEventListener('popstate', onPopState) }
        },
        props: {
          decorations: (state) => {
            const itemPos = getZoomedItemPos(state)
            if (itemPos === null) return DecorationSet.empty
            return DecorationSet.create(state.doc, buildDecorations(state, itemPos, fileName))
          },
          handleDOMEvents: {
            click: (view, event) => {
              const itemPos = itemPosFromGlyphClick(view, event)
              if (itemPos === null) return false
              event.preventDefault()
              zoomTo(itemPos)(view.state, view.dispatch)
              return true
            },
          },
        },
      }),
  )

/** Keymap: `Mod-.` / `Mod-Shift-.` / `Mod-z` (zoom panic-undo) plus the escape guard; register with `editor.use(zoomKeymap)`. */
export const zoomKeymap = $shortcut((_ctx: Ctx) => ({
  ZoomIn: { key: 'Mod-.', priority: PRIORITY, onRun: () => zoomIntoSelection },
  UndoZoom: { key: 'Mod-z', priority: PRIORITY, onRun: () => undoLastZoom },
  ZoomOut: { key: 'Mod-Shift-.', priority: PRIORITY, onRun: () => zoomOutOneLevel },
  ZoomLiftGuardTab: { key: 'Shift-Tab', priority: PRIORITY, onRun: () => blockEscapingLift },
  ZoomLiftGuardBracket: { key: 'Mod-[', priority: PRIORITY, onRun: () => blockEscapingLift },
}))
