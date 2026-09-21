/**
 * Click navigation on wiki links (Links C, GRO-2192) — the interaction layer over Links A's
 * decorations (`wikilinkPlugin.ts`), wired through `createCrepe({ wikilinkNav })`.
 *
 * MOUSEDOWN, not click: a plain click's default mousedown would set the caret inside the
 * match, and the adjacency rule would flip the decoration into its revealed raw form — the
 * text would flash to `[[raw]]` before any navigation. Acting on mousedown and calling
 * `preventDefault()` keeps the caret and focus exactly where they were: the collapsed link
 * never reveals, and a ⌘ background open leaves the document's focused/unfocused state
 * untouched. This is the Obsidian live-preview model, matched exactly: click NAVIGATES; to
 * EDIT the link text you place the caret adjacent (click outside, arrow in) and edit the
 * raw syntax — which is why a click on REVEALED raw text never navigates: a revealed match
 * has no `.wikilink` decoration span, so this handler ignores it (normal caret placement).
 *
 * Gestures: plain click → open in the CURRENT tab (`nav.openCurrent` — an already-open path
 * activates its tab, tabs dedupe); ⌘(meta)-click → NEW BACKGROUND tab (`nav.openBackground`
 * — appended, never activated, never focused; an already-open path is a no-op). An
 * UNRESOLVED link is created first (`createFromLink` — bare targets under `nav.createFolder()`,
 * the Files & Links "default location for new notes" setting read at CLICK time; C2-,
 * GRO-2240), then opened by the same gesture; failures surface via `nav.onNotice` (App's
 * passive link-notice), never a dialog. Two more notices (F2, GRO-2197) keep otherwise
 * invisible outcomes visible: a click during the pre-index window (nothing resolvable yet)
 * says the index is still loading, and a ⌘-click that CREATES a note names it — the new page
 * opened in a background tab, so nothing else on screen moves. `[[#h]]` (same-file, empty
 * target) is a no-op — the
 * heading jump is GRO-2239. Alt-/Shift-/Ctrl-modified clicks keep their defaults (future
 * gestures, context menus).
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { createFromLink } from './createFromLink'
import { WIKILINK_CLASS, WIKILINK_RE, eachPlainRun, linkPageName, type WikilinkResolveSource } from './wikilinkPlugin'
import { viewOnlyLinkTarget, type ViewOnlyLinkSource } from './viewOnlyLinkSource'

/** How clicks leave the editor: App threads this window's tabs API + notice setter (via Editor). */
export interface WikilinkNav {
  /** Vault root — every created path is built under it. */
  root: string
  /**
   * Root-relative folder where a BARE unresolved link creates its page ('' = the vault
   * root). A getter, read at CLICK time: the host resolves the Files & Links "default
   * location for new notes" setting against ITS OWN page path (`newNoteBase`, C2- GRO-2240),
   * so right-panel and folder-page editors create beside themselves, not beside the main
   * tab (YAZ-1643); settings changes land live without remounting any editor. Pathed
   * targets (`[[Sub/Page]]`) ignore it — see `planLinkCreation`.
   */
  createFolder: () => string
  /** Plain click: open in the CURRENT tab (already-open → activates its tab). */
  openCurrent: (path: string) => void
  /** ⌘-click: append a background tab (already-open → no-op; focus never moves). */
  openBackground: (path: string) => void
  /** Create failure: the passive in-window notice (App's link-notice style), never a dialog. */
  onNotice: (message: string) => void
}

const wikilinkClickKey = new PluginKey('mdapp-wikilink-click')

/**
 * The raw inner text of the wikilink match covering `pos`, or null. Re-runs the decoration
 * pass's own scan (plain runs of the block, embeds skipped) so a hit here is exactly a match
 * the plugin decorated — code and `![[…]]` embeds can never navigate.
 */
export function wikilinkInnerAt(doc: ProseNode, pos: number): string | null {
  const $pos = doc.resolve(pos)
  const block = $pos.parent
  if (!block.isTextblock) return null
  let found: string | null = null
  eachPlainRun(block, $pos.start(), (text, runPos) => {
    for (const m of text.matchAll(WIKILINK_RE)) {
      if (m[1] === '!') continue
      const from = runPos + m.index
      if (pos >= from && pos < from + m[0].length) found = m[2]
    }
  })
  return found
}

export function createWikilinkClick(source: WikilinkResolveSource, nav: WikilinkNav, viewOnly?: ViewOnlyLinkSource) {
  return $prose(
    () =>
      new Plugin({
        key: wikilinkClickKey,
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey) return false
              if (!(event.target instanceof Element)) return false
              const span = event.target.closest(`.${WIKILINK_CLASS}`)
              // A `.wikilink` span exists ONLY while the match is collapsed (the adjacency rule
              // drops every decoration of a revealed match) — raw text falls through to editing.
              if (span === null || !view.dom.contains(span)) return false
              const inner = wikilinkInnerAt(view.state.doc, view.posAtDOM(span, 0))
              if (inner === null) return false
              // From here the gesture is ours: no caret placement, no focus change, no reveal.
              event.preventDefault()
              const page = linkPageName(inner)
              if (page === '') return true // same-file [[#h]] — the heading jump is GRO-2239, not this unit
              const background = event.metaKey
              const open = background ? nav.openBackground : nav.openCurrent
              const viewSource = viewOnly
              const viewTarget = viewSource === undefined ? null : viewOnlyLinkTarget(inner)
              if (viewTarget !== null && viewSource !== undefined) {
                if (viewTarget.hasSubtarget) {
                  nav.onNotice(`Can't open "${viewTarget.raw}": headings and blocks aren't supported for read-only files`)
                  return true
                }
                if (viewSource.resolve === null) {
                  nav.onNotice('File catalog is still loading — try that link again in a moment')
                  return true
                }
                const viewPath = viewSource.resolve(viewTarget.page)
                if (viewPath === null) nav.onNotice(`Can't open "${viewTarget.page}": file not found`)
                else open(viewPath)
                return true
              }
              const resolve = source.resolve
              // Pre-index window: every link renders resolved but nothing can be resolved yet;
              // creating here could shadow an existing note, so the gesture is swallowed — but
              // SAID (GRO-2197): a silently dead click reads as breakage.
              if (resolve === null) {
                nav.onNotice('Vault index is still loading — try that link again in a moment')
                return true
              }
              const path = resolve(page)
              if (path !== null) open(path)
              else
                void createFromLink(nav.root, inner, nav.createFolder()).then((result) => {
                  if (result.status === 'error') nav.onNotice(result.message)
                  else if (result.status !== 'noop') {
                    open(result.path)
                    // A ⌘-click's freshly CREATED page landed in a background tab (locked I3
                    // ruling — never activated), so name what just appeared (GRO-2197). Losing
                    // the creation race ('exists') created nothing and stays silent.
                    if (background && result.status === 'created') nav.onNotice(`Created "${page}" in a background tab`)
                  }
                })
              return true
            },
          },
        },
      }),
  )
}
