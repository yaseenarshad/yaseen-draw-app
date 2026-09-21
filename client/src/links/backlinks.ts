/**
 * Backlinks — "Linked mentions" (Links D, GRO-2193; decision D of GRO-2096, LOCKED): the notes
 * that link to the open one, computed CLIENT-SIDE in ONE pass over the index snapshot this
 * window already holds, through THE shared resolver (`views/engine.ts` `resolverFor`, the one
 * behind views, wikilink decorations and clicks). No reverse map in the main process, no
 * new IPC, no new index field — and alias-awareness comes free: a note linking `[[CAC]]` IS a
 * linked mention of the page whose frontmatter aliases it (E2, GRO-2214).
 *
 * A mention is a `links` OR an `embeds` entry that resolves to the open path — an `![[embed]]`
 * mentions its target exactly like a `[[link]]` does (locked). The open note never lists itself.
 * One entry per referencing NOTE (however many mentions it holds), path-sorted, so the section
 * renders the same order for the same snapshot.
 *
 * Context snippets are read ON DEMAND (`fs:read` per shown entry, `mentionSnippets` below) —
 * the index stores no positions, and nothing is read until the section is expanded.
 */
import type { IndexRecord } from '@shared/types'
import { WIKILINK_RE, linkDisplayText, linkPageName, type ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { maskCode } from './renameLinks'

/** Records whose links/embeds resolve to `path`, path-sorted; `path` itself never counts. */
function referencing(path: string, records: readonly IndexRecord[], resolve: ResolveLink): IndexRecord[] {
  return records
    .filter((r) => r.path !== path && [...r.links, ...r.embeds].some((target) => resolve(target) === path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * Referencing sets per records array identity, then per path — `resolverFor`'s WeakMap idiom.
 * Every mounted tab's section recomputes on each ready snapshot, so one snapshot must cost one
 * pass per open path; a refetched index is a NEW array and recomputes (that IS the live update),
 * and dropped snapshots are collectable. The resolver is derived from the SAME snapshot
 * (memoized per its identity too), so records identity is the whole key.
 */
const backlinkCache = new WeakMap<readonly IndexRecord[], Map<string, IndexRecord[]>>()

/** The notes mentioning `path` in this snapshot: path-sorted, self excluded, embeds included. */
export function backlinksFor(path: string, records: readonly IndexRecord[], resolve: ResolveLink): IndexRecord[] {
  let byPath = backlinkCache.get(records)
  if (byPath === undefined) backlinkCache.set(records, (byPath = new Map()))
  let hit = byPath.get(path)
  if (hit === undefined) byPath.set(path, (hit = referencing(path, records, resolve)))
  return hit
}

// ---------- context snippets ----------

/** Longest snippet text before windowing; the ellipses ride on top. */
export const SNIPPET_MAX_CHARS = 120

/** Snippet LINES shown per referencing note (FN10: one snippet per line, however many mentions it holds). */
export const MAX_SNIPPETS = 5

const ELLIPSIS = '…'

/** Offsets INSIDE a snippet's `text` of one mention of the target — always a whole highlight run. */
export interface MentionRange {
  from: number
  to: number
}

export interface MentionSnippet {
  /**
   * The mention's line AS THE EDITOR SHOWS IT — every wikilink on it replaced by its display
   * text (`linkDisplayText`; embeds and empty-display forms stay raw, exactly the decorations'
   * rule) — whitespace-trimmed and windowed to ~`SNIPPET_MAX_CHARS` around the first mention
   * (FN9, GRO-2197).
   */
  text: string
  /**
   * EVERY mention of the target on this line, ascending and non-overlapping (FN10, GRO-2197).
   * Never empty; a range the window cut off is dropped, the first one never is.
   */
  ranges: MentionRange[]
}

/**
 * One snippet for the line owning the matches `line[first..]` (content coords) of `matches`,
 * anchored on `matches[first]` — the first TARGET mention on the line. Builds the display line
 * (every match replaced per `linkDisplayText`), records the [from, to) of each target mention,
 * then trims and windows centred on the first of them. Returns the content offset the line ends
 * at, so the caller can skip the matches this snippet consumed.
 */
function lineSnippet(
  content: string,
  matches: readonly RegExpExecArray[],
  first: number,
  isMention: (m: RegExpExecArray) => boolean,
): { snippet: MentionSnippet; lineEnd: number } {
  const endOfLine = (pos: number): number => {
    const nl = content.indexOf('\n', pos)
    return nl === -1 ? content.length : nl
  }
  const anchor = matches[first]
  const lineStart = content.lastIndexOf('\n', anchor.index - 1) + 1
  // Back up to the first match STARTING on this line — earlier, non-target links on the same
  // line still get their display replacement (FN9: unrelated links never show brackets either).
  let from = first
  while (from > 0 && matches[from - 1].index >= lineStart) from--
  // A target may span a line break (`[^[\]]+` allows one): a match reaching past the newline
  // extends the line, exactly as the old per-match windowing read it.
  let lineEnd = endOfLine(anchor.index + anchor[0].length)
  let text = ''
  const ranges: MentionRange[] = []
  let cursor = lineStart
  for (let k = from; k < matches.length && matches[k].index < lineEnd; k++) {
    const m = matches[k]
    const matchEnd = m.index + m[0].length
    if (matchEnd > lineEnd) lineEnd = endOfLine(matchEnd)
    text += content.slice(cursor, m.index)
    // Embeds are undecorated in the editor and empty-display forms stay raw (FN12): both keep
    // their raw text here too — the snippet reads exactly like the document.
    const display = m[1] === '!' ? '' : linkDisplayText(m[2])
    const shown = display === '' ? m[0] : display
    if (isMention(m)) ranges.push({ from: text.length, to: text.length + shown.length })
    text += shown
    cursor = matchEnd
  }
  text += content.slice(cursor, lineEnd)
  // Trim surrounding whitespace, never into a mention (a mention is never trimmed away).
  const matchFrom = ranges[0].from
  const matchTo = ranges[0].to
  const lastTo = ranges[ranges.length - 1].to
  let start = 0
  let end = text.length
  while (start < matchFrom && /\s/.test(text[start])) start++
  while (end > lastTo && /\s/.test(text[end - 1])) end--
  // Long line: a window centred on the FIRST mention, always containing it whole.
  const slack = Math.max(0, SNIPPET_MAX_CHARS - (matchTo - matchFrom))
  const windowStart = end - start > SNIPPET_MAX_CHARS ? Math.max(start, matchFrom - Math.floor(slack / 2)) : start
  const windowEnd = Math.min(end, Math.max(matchTo, windowStart + SNIPPET_MAX_CHARS))
  const head = windowStart > start ? ELLIPSIS : ''
  const shift = head.length - windowStart
  return {
    snippet: {
      // Newlines (a target spanning a line break) read as spaces, offsets intact.
      text: head + text.slice(windowStart, windowEnd).replace(/[\r\n]/g, ' ') + (windowEnd < end ? ELLIPSIS : ''),
      // Every range shifted into window coords; one the window cut off is dropped (the first
      // never can be — the window always contains it whole).
      ranges: ranges.filter((r) => r.from >= windowStart && r.to <= windowEnd).map((r) => ({ from: r.from + shift, to: r.to + shift })),
    },
    lineEnd,
  }
}

/**
 * The mention lines of one referencing note's raw file content: every line holding a `[[link]]`
 * / `![[embed]]` whose page name resolves to `target`, in document order, at most `limit` LINES —
 * one snippet per line with every mention on it highlighted (FN10, GRO-2197). Code is skipped
 * through the rename engine's length-preserving `maskCode` — the same fence/inline-span
 * discipline the index's link extraction uses, so a snippet can only highlight a link the index
 * actually counted. Frontmatter is scanned like any other line (the index reads links there too).
 */
export function mentionSnippets(content: string, target: string, resolve: ResolveLink, limit = MAX_SNIPPETS): MentionSnippet[] {
  const masked = maskCode(content)
  const matches = [...masked.matchAll(WIKILINK_RE)]
  const isMention = (m: RegExpExecArray): boolean => {
    const page = linkPageName(m[2])
    return page !== '' && resolve(page) === target // '' = the same-file `[[#heading]]` form
  }
  const out: MentionSnippet[] = []
  for (let i = 0; i < matches.length && out.length < limit; i++) {
    if (!isMention(matches[i])) continue
    const { snippet, lineEnd } = lineSnippet(content, matches, i, isMention)
    out.push(snippet)
    while (i + 1 < matches.length && matches[i + 1].index < lineEnd) i++ // this line is spoken for
  }
  return out
}
