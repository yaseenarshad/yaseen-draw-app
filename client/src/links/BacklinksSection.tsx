/**
 * "Linked mentions" — the backlinks section (Links D, GRO-2193; placement LOCKED): a collapsible
 * block at the END of the note's own scrollable content, so it scrolls WITH the note, exactly
 * like Obsidian's in-document backlinks. No right panel, no sidebar section, one per tab.
 *
 * Behaviour, all locked:
 *  - COLLAPSED by default; the count N is always on the header ("Linked mentions (3)").
 *  - N === 0 renders NOTHING at all — a note nobody links to shows no chrome (quiet over
 *    complete; Obsidian's in-document mode keeps an empty section, we do not).
 *  - Context snippets are read ON DEMAND: an entry only mounts while the section is EXPANDED,
 *    and its `fs:read` runs from that mount — collapsed costs zero reads. A skeleton line shows
 *    while the read is in flight; a failed read leaves the entry standing WITHOUT snippets
 *    (never an error dialog, never a notice).
 *  - Clicks ride the same model as everything else: plain → the CURRENT tab, ⌘ → a BACKGROUND
 *    tab (`openCurrent` / `openBackground`, the window's tabs API threaded down from App).
 *  - Collapse state is per-component and in-memory: because every visited tab keeps its editor
 *    layer mounted (Editor rule 4), it is effectively per tab for the session. Never persisted —
 *    an open backlinks block is not part of a note's identity.
 *
 * Feed: the window's ONE `WikilinkResolveSource` (App-owned, fed by `WikilinkIndexBridge`), which
 * carries the resolver AND the snapshot it was built from. A refetched snapshot pokes the source,
 * N recomputes live, and an entry re-reads its snippets when its own record's mtime moved — so a
 * link added or removed on disk lands here without a watcher or an IPC call of our own.
 */
import { useEffect, useRef, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { api } from '../api'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { backlinksFor, mentionSnippets, type MentionSnippet } from './backlinks'
import './backlinks.css'

export interface BacklinksSectionProps {
  /** The open note (absolute path): mentions OF this file are what the section lists. */
  path: string
  /** The window's link index feed — resolver + the snapshot it came from. */
  source: WikilinkResolveSource
  /** Plain click on an entry or a snippet: open in the CURRENT tab. */
  openCurrent: (path: string) => void
  /** ⌘-click: append a background tab. Absent → ⌘-click opens in the current tab. */
  openBackground?: (path: string) => void
}

const NONE: readonly IndexRecord[] = []

/** The resolver and the records it was built from, always read together (never half a snapshot). */
interface Feed {
  records: readonly IndexRecord[]
  resolve: ResolveLink | null
}

export function BacklinksSection({ path, source, openCurrent, openBackground }: BacklinksSectionProps) {
  // The same live-feed idiom the folder page's contents block uses: subscribe once, re-read
  // the whole feed on each poke. Identical contents keep the previous object, so a snapshot that
  // changed nothing for us costs no render.
  const [feed, setFeed] = useState<Feed>(() => ({ records: source.records, resolve: source.resolve }))
  useEffect(() => {
    const read = () =>
      setFeed((prev) =>
        prev.records === source.records && prev.resolve === source.resolve ? prev : { records: source.records, resolve: source.resolve },
      )
    read()
    return source.subscribe(read)
  }, [source])

  const [expanded, setExpanded] = useState(false)

  const entries = feed.resolve === null ? NONE : backlinksFor(path, feed.records, feed.resolve)
  if (entries.length === 0) return null

  return (
    <section className="backlinks">
      <button type="button" className="backlinks__header" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        <svg className="backlinks__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        <span className="backlinks__title">Linked mentions <span className="backlinks__count">({entries.length})</span></span>
      </button>
      {expanded && (
        <ul className="backlinks__list">
          {entries.map((record) => (
            <BacklinkEntry
              key={record.path}
              record={record}
              target={path}
              resolve={feed.resolve}
              openCurrent={openCurrent}
              openBackground={openBackground}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/** One referencing note: its name, then its mention lines — read from disk on mount (= on expand). */
function BacklinkEntry({
  record,
  target,
  resolve,
  openCurrent,
  openBackground,
}: {
  record: IndexRecord
  target: string
  resolve: ResolveLink | null
  openCurrent: (path: string) => void
  openBackground?: (path: string) => void
}) {
  /** null = the read is in flight (skeleton); [] = read failed, or nothing left to show. */
  const [snippets, setSnippets] = useState<MentionSnippet[] | null>(null)
  // Ref-backed so a new resolver (any vault change re-swaps one) never re-reads the file; the
  // record's own mtime is what says this note's mentions may have moved.
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve

  useEffect(() => {
    let cancelled = false
    setSnippets(null)
    void api.readFile(record.path).then(
      (file) => {
        if (!cancelled) setSnippets(mentionSnippets(file.content, target, resolveRef.current ?? (() => null)))
      },
      () => {
        if (!cancelled) setSnippets([]) // unreadable (gone, too large, …): the entry stands alone
      },
    )
    return () => {
      cancelled = true
    }
  }, [record.path, record.mtime, target])

  const open = (event: React.MouseEvent): void => {
    if (event.metaKey && openBackground !== undefined) openBackground(record.path)
    else openCurrent(record.path)
  }

  return (
    <li className="backlinks__entry">
      <button type="button" className="backlinks__note" title={record.path} onClick={open}>
        {record.basename}
      </button>
      {snippets === null ? (
        <div className="backlinks__skeleton" aria-hidden />
      ) : (
        snippets.map((snippet, i) => (
          <button key={i} type="button" className="backlinks__snippet" title={record.path} onClick={open}>
            {snippetRuns(snippet)}
          </button>
        ))
      )}
    </li>
  )
}

/**
 * One snippet line interleaved with its highlights: plain runs between the ranges, a `<mark>`
 * per mention of the target — a line holding two mentions is ONE row with TWO marks (FN10,
 * GRO-2197). Ranges are ascending and non-overlapping by construction (`mentionSnippets`).
 */
function snippetRuns(snippet: MentionSnippet): React.ReactNode[] {
  const runs: React.ReactNode[] = []
  let cursor = 0
  snippet.ranges.forEach(({ from, to }, i) => {
    if (from > cursor) runs.push(snippet.text.slice(cursor, from))
    runs.push(
      <mark key={i} className="backlinks__match">
        {snippet.text.slice(from, to)}
      </mark>,
    )
    cursor = to
  })
  if (cursor < snippet.text.length) runs.push(snippet.text.slice(cursor))
  return runs
}
