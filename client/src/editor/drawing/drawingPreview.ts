/**
 * Drawing previews in the page (YAZ-878, third build unit of the Excalidraw embed YAZ-852):
 * `![[Sketch.excalidraw]]` renders as the SCENE instead of as its own text.
 *
 * DECORATIONS ONLY (🔒 the locked editor contract): like the wikilink renderer next door, the
 * embed stays PLAIN TEXT in the document — no schema node, no serializer, no node view — so
 * round-trip stays byte-identical (`roundtrip.test.ts`). ProseMirror has no "replace this range
 * with a widget" decoration, so the honest pair the codebase already uses is:
 *   - `Decoration.inline` over the whole match carrying `drawing-embed__syntax` (CSS
 *     `display: none`) — the same hiding mechanism `wikilink__syntax` uses for `[[` / `]]`,
 *   - `Decoration.widget` at the match START (`side: -1`) holding the preview, `contenteditable
 *     ="false"` so the caret cannot land inside it.
 * The widget's `key` is `target + state`, so ProseMirror reuses the DOM node across rebuilds and
 * a settled preview never flickers.
 *
 * REVEAL: a selection STRICTLY INSIDE the match (boundaries EXCLUSIVE) drops both decorations —
 * raw, editable syntax, exactly like a wikilink under the caret. Exclusive on purpose, unlike
 * rule 23's inclusive rule: the Drawing slash item leaves the caret immediately AFTER the embed
 * it just inserted (YAZ-877), and an inclusive rule would hide the preview the insert exists to
 * show. Boundary behaviour stays sane either way — ArrowLeft/Right off an edge steps inside and
 * reveals the text, and Backspace at the right edge eats the final `]`, which un-matches the
 * embed and leaves the plain text a plain-text delete would have left.
 *
 * ONLY `.excalidraw` targets (`isDrawingTarget`): every other embed (`![[img.png]]`) and every
 * link (`[[note]]`) passes through this plugin untouched. The target is handed to `readAsset`
 * RAW — path or basename — because that is where the resolution rule lives (YAZ-876).
 *
 * STATES: loading is a quiet empty box (no spinner, so nothing jitters on a fast read); broken —
 * missing, unreadable, not a scene — is a small INERT chip and the embed text stays visible and
 * editable, because a drawing whose file is gone must still be a line the user can fix by hand;
 * ready is the SVG, `max-width: 100%` inside the editor column and clickable when the host
 * supplies `onOpenDrawing` — Editor opens the modal on it (YAZ-879); absent → the preview is inert.
 *
 * REFRESH: scenes are cached per target for the life of this plugin instance (one editor mount).
 * A `DrawingFeed` poke naming a target drops its entry and pokes the decorations, which re-read
 * and re-render it — the live path the modal's save uses (YAZ-879). No feed → previews still
 * render, they just never refresh short of a remount.
 */
import { Plugin, PluginKey, type EditorState, type Selection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import type { DrawingFeed } from '../../drawings/drawingFeed'
import { isDrawingTarget, loadDrawingScene } from '../../drawings/drawingScene'
import { renderSceneToSvg } from '../../drawings/renderScene'
import { WIKILINK_RE, eachPlainRun } from '../wikilink/wikilinkPlugin'
import './drawingPreview.css'

export const DRAWING_SYNTAX_CLASS = 'drawing-embed__syntax'
export const DRAWING_PREVIEW_CLASS = 'drawing-preview'
export const DRAWING_CLICKABLE_CLASS = 'drawing-preview--clickable'
export const DRAWING_BROKEN_CLASS = 'drawing-preview__broken'

export interface DrawingPreviewOptions {
  /** Vault root; the only thing `readAsset` needs beyond the embed's own target. */
  root: string
  /** Live refresh (YAZ-879's save pokes it). Absent → previews render but never re-read. */
  feed?: DrawingFeed
  /** Click on a rendered preview (YAZ-879 opens the modal). Absent → the preview is inert. */
  onOpenDrawing?: (target: string) => void
}

/** What the plugin knows about one target right now; `svg` only on `ready`. */
interface PreviewEntry {
  status: 'loading' | 'ready' | 'broken'
  svg?: SVGSVGElement
}

const previewKey = new PluginKey<DecorationSet>('mdapp-drawing-preview')

/** True when the selection reaches INSIDE [from, to] — boundaries excluded (see the module doc). */
function revealed(sel: Selection, from: number, to: number): boolean {
  return sel.from < to && sel.to > from
}

/** One preview's DOM: the empty loading box, the inert broken chip, or the scene. */
function previewDom(target: string, entry: PreviewEntry, onOpenDrawing?: (target: string) => void): HTMLElement {
  const el = document.createElement('span')
  el.className = `${DRAWING_PREVIEW_CLASS} ${DRAWING_PREVIEW_CLASS}--${entry.status}`
  el.dataset.drawingTarget = target
  // The widget lives inside the contenteditable; without this the caret could be dropped in it.
  el.contentEditable = 'false'
  if (entry.status === 'broken') {
    const chip = document.createElement('span')
    chip.className = DRAWING_BROKEN_CLASS
    chip.textContent = 'Broken drawing'
    el.appendChild(chip)
    return el
  }
  if (entry.status === 'ready' && entry.svg !== undefined) {
    el.appendChild(entry.svg.cloneNode(true))
    if (onOpenDrawing !== undefined) {
      el.classList.add(DRAWING_CLICKABLE_CLASS)
      // Same move as the wikilink click handler: swallow the mousedown so the caret never lands
      // in the match (which would reveal the raw text under the click).
      el.addEventListener('mousedown', (event) => event.preventDefault())
      el.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenDrawing(target)
      })
    }
  }
  return el
}

export function createDrawingPreview(opts: DrawingPreviewOptions) {
  // Everything below is per EDITOR INSTANCE: `$prose`'s factory runs once per mount.
  return $prose(() => {
    const cache = new Map<string, PreviewEntry>()
    let view: EditorView | null = null
    /**
     * A poke that arrived before the view existed. The FIRST decorations are built in
     * `state.init`, which runs while the EditorView is still being constructed — so a read that
     * settles in the next microtask (a rejection, or anything cached upstream) would otherwise
     * poke into the void and leave the preview stuck on `loading` forever.
     */
    let missed = false

    /** Rebuild the decorations without touching the document (never reaches autosave). */
    const poke = (): void => {
      if (view === null) {
        missed = true
        return
      }
      view.dispatch(view.state.tr.setMeta(previewKey, 'drawing-updated'))
    }

    /** This target's entry, starting its ONE read+render the first time it is asked for. */
    const entryFor = (target: string): PreviewEntry => {
      const hit = cache.get(target)
      if (hit !== undefined) return hit
      const entry: PreviewEntry = { status: 'loading' }
      cache.set(target, entry)
      void loadDrawingScene(opts.root, target)
        .then(renderSceneToSvg)
        .then(
          (svg) => cache.set(target, { status: 'ready', svg }),
          // Missing file, unreadable bytes, not a scene, a render that threw — all one state.
          () => cache.set(target, { status: 'broken' }),
        )
        .then(poke)
      return entry
    }

    const build = (state: EditorState): DecorationSet => {
      const out: Decoration[] = []
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block') return false
        if (!node.isTextblock) return true
        eachPlainRun(node, pos + 1, (text, runPos) => {
          for (const m of text.matchAll(WIKILINK_RE)) {
            if (m[1] !== '!') continue // links are rule 23's; only EMBEDS can be a drawing
            const target = m[2].trim()
            if (!isDrawingTarget(target)) continue // every other embed renders exactly as today
            const from = runPos + m.index
            const to = from + m[0].length
            if (revealed(state.selection, from, to)) continue
            const entry = entryFor(target)
            // Broken keeps the embed text visible: the line must stay fixable by hand.
            if (entry.status !== 'broken') out.push(Decoration.inline(from, to, { class: DRAWING_SYNTAX_CLASS }))
            out.push(
              Decoration.widget(from, () => previewDom(target, entry, opts.onOpenDrawing), {
                // Identity for PM's redraw check: same target + same state = the same DOM node.
                key: `${target} · ${entry.status}`,
                side: -1,
              }),
            )
          }
        })
        return false
      })
      return out.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, out)
    }

    return new Plugin({
      key: previewKey,
      state: {
        init: (_, state) => build(state),
        apply: (tr, set, _old, state) =>
          tr.docChanged || tr.selectionSet || tr.getMeta(previewKey) !== undefined ? build(state) : set,
      },
      props: {
        decorations: (state) => previewKey.getState(state),
      },
      view: (editorView) => {
        view = editorView
        // Out of the construction call stack before dispatching (see `missed`).
        if (missed) {
          missed = false
          void Promise.resolve().then(poke)
        }
        const unsubscribe = opts.feed?.subscribe((target) => {
          if (cache.delete(target)) poke() // unknown target = nothing on screen to refresh
        })
        return {
          destroy: () => {
            unsubscribe?.()
            view = null
          },
        }
      },
    })
  })
}
