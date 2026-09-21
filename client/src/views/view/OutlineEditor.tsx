/**
 * THE OUTLINE EDITOR (YAZ-901, 🔒 F3): the folder page's outline view is a SECOND, small Milkdown
 * instance — the note editor's own `createCrepe()`, its outliner plugins (bullet glyphs, Tab /
 * Shift-Tab, guide lines, folding) and its wikilink surfaces (live-preview decorations, the `[[`
 * picker, click navigation) — locked by `editor/outline/bulletsOnly.ts` to a document that is
 * exactly one bullet list. Not one plugin is copied: the reuse IS the feature.
 *
 * SEEDED at mount from `markdown`, and LIVE afterwards (YAZ-1356). Both doors go through YAZ-900's
 * grammar (`parseOutline` → `serializeOutline`), which is both the empty state — no bullets means
 * ONE empty bullet, so there is something to click and type into — and the guarantee the lock
 * needs: the document cannot be anything but bullets. Each line's text goes in through the
 * grammar's `escapeBlockStart`, so text that merely LOOKS like a block — `1. Title`, `# x` — stays
 * the literal text the grammar promises instead of re-parsing into a node the lock drops (YAZ-964).
 * A later `markdown` — the disk moving under an open folder page — lands as a DIFF over the live
 * state (`applyExternalMarkdown`, the note editor's own path since YAZ-1347), so caret, folds and
 * scroll ride ProseMirror's position mapping. TYPING WINS: a live document the caller has not been
 * told about yet means the user's save is about to be the truth on disk, so that snapshot is skipped
 * rather than silently undoing keystrokes. The apply's own listener emission is remembered and
 * swallowed — looking at the disk is not an edit and is never written back. THE GUARD below runs at
 * both doors: a snapshot the parse cannot hold is shown read-only exactly as a lossy seed is.
 *
 * THE GUARD is the escape's backstop, for the gap nobody has found yet: after the create, fewer
 * bullets back than went in means Milkdown could not hold the seed, and a seed the parse cannot
 * hold must never be written back as the truth. The editor goes read-only and reports through
 * `onSeedLoss` — the loss is shown, never saved.
 *
 * ONCHANGE is the note editor's save idiom minus the disk: Crepe's listener debounces
 * `markdownUpdated` ~200ms, this adds the same 500ms `useAutosave` uses, and the caller owns the
 * settings write. Only real edits are reported — the seed's normalisation on the way through
 * Milkdown (`- ` at four spaces becomes `* ` at two) is not a document change and never fires — and
 * on unmount the pending edit is flushed, so switching views never drops the last keystroke.
 */
import { useEffect, useMemo, useRef } from 'react'
import type { Crepe } from '@milkdown/crepe'
import { applyExternalMarkdown } from '../../editor/external/applyExternalMarkdown'
import { lockToBullets, outlineFeatures } from '../../editor/outline/bulletsOnly'
import { createCrepe, getMarkdownForSave } from '../../editor/createCrepe'
import { FindBar } from '../../editor/find/FindBar'
import { createFindChannel } from '../../editor/find/findChannel'
import type { WikilinkNav } from '../../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { escapeBlockStart, parseOutline, serializeOutline } from '../outlineDoc'
import '../../editor/outline/bullets.css'
import '../../editor/outline/guideLines.css'
import '../../editor/outline/outlineFolding.css'
import '../../editor/outline/zoom.css'
import './outlineEditor.css'

/** Same interval as `useAutosave`'s `delayMs` — one debounce rhythm across the app. */
const DEBOUNCE_MS = 500

/** Markdown → the bullets the editor may hold: YAZ-900's grammar, shared by the seed and every later apply. */
const outlineDoc = (markdown: string): { depth: number; text: string }[] => {
  const lines = parseOutline(markdown).map((line) => ({ ...line, text: escapeBlockStart(line.text) }))
  return lines.length > 0 ? lines : [{ depth: 0, text: '' }]
}

export interface OutlineEditorProps {
  /** The outline document (YAZ-900's `views[i].outline`): the seed at mount, a diff over the live editor afterwards; empty seeds one bullet. */
  markdown: string
  /** Debounced serialised markdown after every committed edit; the caller owns the settings write. */
  onChange: (markdown: string) => void
  /** Called ONCE, after mount, when the parsed document holds fewer lines than the seed — the
      guard's report; the editor is already read-only when it fires. */
  onSeedLoss?: () => void
  /** Wikilink resolve source (Links A): App's one per window — the very instance the note editor holds. */
  wikilinks?: WikilinkResolveSource
  /** `[[` picker candidates (Links B): same ownership and feed. */
  wikilinkCandidates?: WikilinkCandidateSource
  /**
   * Wiki-link click navigation (Links C), verbatim the note editor's contract. Absent → links
   * render but clicks stay plain editing. Keep the identity STABLE: a new object remounts the
   * editor, and a remount costs the caret and the undo history.
   */
  nav?: WikilinkNav
}

export function OutlineEditor({ markdown, onChange, onSeedLoss, wikilinks, wikilinkCandidates, nav }: OutlineEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Mount reads the FIRST markdown; every later one lands as a diff over the live editor (effect below).
  const seedRef = useRef(markdown)
  const crepeRef = useRef<Crepe | null>(null)
  /**
   * The last markdown the editor and its caller AGREED on — the seed as Milkdown holds it, the
   * last reported edit, the last applied snapshot. A live document that differs from it is typing
   * in flight (a disk snapshot waits); a listener emission equal to it is an apply's echo (no edit).
   * ONE serialisation throughout, `getMarkdownForSave` — the very string the listener reports —
   * because raw `getMarkdown()` differs from it (`\[\[` escapes, the trailing paragraph) and a
   * comparison across the two called every document "typing in flight" after the first edit.
   */
  const knownRef = useRef<string | null>(null)
  // Read at emit time so a re-rendered parent's fresh callback lands without remounting the editor.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSeedLossRef = useRef(onSeedLoss)
  onSeedLossRef.current = onSeedLoss
  /** The document must survive the parse: fewer bullets back than went in means Milkdown dropped content (YAZ-964/974). */
  const guard = (crepe: Crepe, expected: number): void => {
    if (parseOutline(crepe.getMarkdown()).length >= expected) return
    crepe.setReadonly(true)
    onSeedLossRef.current?.()
  }
  /**
   * This view's OWN CMD+F (YAZ-968/969), the note editor's wiring verbatim: one channel per mount,
   * bound by the engine and driven by the bar below, whose claim is focus standing in this host
   * (🔒 YAZ-967). Stable identity — a new channel would remount the editor.
   */
  const findChannel = useMemo(() => createFindChannel(), [])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // Own wrapper per instance (StrictMode mounts twice) wearing the note editor's class, so every
    // outline stylesheet applies unchanged — see outlineEditor.css.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    host.appendChild(el)

    let timer: ReturnType<typeof setTimeout> | null = null
    let pending: string | null = null
    const flush = () => {
      timer = null
      if (pending === null) return
      const md = pending
      pending = null
      knownRef.current = md
      onChangeRef.current(md)
    }

    const seeded = outlineDoc(seedRef.current)
    const crepe = createCrepe({
      root: el,
      defaultValue: serializeOutline(seeded),
      features: outlineFeatures,
      onMarkdownUpdated: (md) => {
        if (md === knownRef.current) return // an external apply's own emission: not the user's edit, never written back
        pending = md
        if (timer === null) timer = setTimeout(flush, DEBOUNCE_MS)
      },
      wikilinks,
      wikilinkCandidates,
      wikilinkNav: nav,
      find: findChannel,
      // No `image` options (YAZ-1656) on purpose: lock 4 below rejects any document holding an
      // `image` node, so a pasted screenshot would be written to the vault and then have its insert
      // filtered away. Images here stay Crepe's stock `<img>` until the lock says otherwise.
    })
    lockToBullets(crepe)

    const ready = crepe.create().then(() => {
      crepeRef.current = crepe
      knownRef.current = getMarkdownForSave(crepe)
      guard(crepe, seeded.length)
    })

    return () => {
      crepeRef.current = null
      if (timer !== null) clearTimeout(timer)
      flush()
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [wikilinks, wikilinkCandidates, nav, findChannel])

  // A disk edit to `views[i].outline` (YAZ-1356) lands as a DIFF over the live state — the note
  // editor's own path (YAZ-1347) — so caret, folds and scroll ride position mapping. Typing in
  // flight WINS: a live document the caller has not been told about yet means the user's save is
  // about to be the truth on disk, so the snapshot is skipped rather than silently undoing
  // keystrokes. The LIVE document is asked, not the debounced listener — the same pull the note
  // editor does before its own reload — so the 200ms listener window cannot hide a keystroke.
  useEffect(() => {
    const crepe = crepeRef.current
    if (crepe === null || getMarkdownForSave(crepe) !== knownRef.current) return
    const lines = outlineDoc(markdown)
    applyExternalMarkdown(crepe, serializeOutline(lines))
    knownRef.current = getMarkdownForSave(crepe)
    guard(crepe, lines.length)
  }, [markdown])

  return (
    <div className="view-outline-editor" ref={hostRef}>
      <FindBar channel={findChannel} scope="outline" hostRef={hostRef} />
    </div>
  )
}
