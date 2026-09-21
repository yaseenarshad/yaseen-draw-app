import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'

/**
 * Comments per page (YAZ-1472): a note's comment stream lives ON the note, under the reserved
 * frontmatter key `comments` — a FLAT list of maps (🔒 D1/D2). A reply carries `reply_to: <id>`
 * and a thread is ONE level deep: a reply to a reply is filed under the top-level parent. Who
 * wrote it is whatever the writer declared in `by` (🔒 D3 — the app declares nothing for the
 * person at the keyboard; an agent writes `by: agent`). Pure: no React, no fs. The block writes through
 * `transformFile`, the index drops the key from `properties` (🔒 D5), the Properties panel chips
 * it "Reserved" (🔒 D6).
 *
 * Every reader and writer here CARRIES what it does not understand: unknown keys on an entry and
 * unknown entries in the list are spread through, never rebuilt from the typed subset. What the
 * key holds is checked on the FRESH bytes before every write (`commentsShape`): a value of the
 * user's own under this name, or a block that does not parse, is never overwritten.
 */

export const COMMENTS_KEY = 'comments'

export interface PageComment {
  /** `crypto.randomUUID().slice(0, 8)` — enough for one note. */
  id: string
  /**
   * The comment's number, quotable and never reassigned: a top-level comment is one past the
   * highest top-level number on the page (shown `#3`); a reply is one past the highest among its
   * parent's replies (shown `#3.1`). A delete leaves a gap, the way an issue tracker does, so
   * every reference ever written keeps pointing at the same comment. Absent on a hand-written
   * entry that did not set one.
   */
  n?: number
  /** ISO UTC at seconds precision (`2026-09-11T18:22:31Z`), so it sorts as a string. */
  at: string
  /** Optional one-line heading; the row's summary when folded. Absent when empty. */
  title?: string
  /** Plain text; trailing whitespace trimmed on write, nothing else. */
  body: string
  /** The TOP-LEVEL parent's id — never a reply's. */
  reply_to?: string
  /** Stamped by `editComment`, same format as `at`. */
  edited?: string
  /**
   * Who left it, declared by the WRITER — the app writes none for the person at the keyboard; an
   * agent editing the file writes `by: agent`. Never inferred: a file carries no authorship.
   */
  by?: string
  [extra: string]: unknown
}

/** One top-level comment with its replies, both in `at` order — what the block renders. */
export interface CommentThread {
  comment: PageComment
  replies: PageComment[]
}

/**
 * What the key holds on disk: nothing (or an explicit empty `comments:`), a YAML sequence (empty
 * included), some OTHER value of the user's own (an Obsidian vault may already use the name for a
 * scalar), or a frontmatter block that does not parse. Only `absent` and `list` are ours to write.
 */
export type CommentsShape = 'absent' | 'list' | 'foreign' | 'invalid'

/** Thrown INSTEAD of writing when the fresh bytes are `foreign` or `invalid`: the block never overwrites what is not a comment list. */
export class CommentsShapeError extends Error {
  constructor(readonly shape: CommentsShape) {
    super(
      shape === 'invalid'
        ? 'the properties block does not parse (invalid)'
        : `the ${COMMENTS_KEY} property is not a comment list (${shape})`,
    )
    this.name = 'CommentsShapeError'
  }
}

function rawList(content: string): { shape: CommentsShape; list: readonly unknown[] } {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (error !== undefined) return { shape: 'invalid', list: [] }
  const raw = properties[COMMENTS_KEY]
  if (raw === undefined || raw === null) return { shape: 'absent', list: [] }
  if (Array.isArray(raw)) return { shape: 'list', list: raw }
  return { shape: 'foreign', list: [] }
}

export function commentsShape(content: string): CommentsShape {
  return rawList(content).shape
}

const isString = (v: unknown): v is string => typeof v === 'string'
/** An optional key may be absent, a string, or a bare `title:` (YAML null) — never another shape. */
const optionalString = (v: unknown): boolean => v == null || typeof v === 'string'
const OPTIONAL = ['reply_to', 'by', 'title', 'edited'] as const

/** A list entry the block understands: a map with string `id`, `at` and `body` (an EMPTY body included), and string-or-empty `reply_to` / `by` / `title` / `edited`. */
function isComment(entry: unknown): entry is PageComment {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
  const e = entry as Record<string, unknown>
  return isString(e.id) && isString(e.at) && isString(e.body) && OPTIONAL.every((k) => optionalString(e[k])) && (e.n == null || typeof e.n === 'number')
}

/** The typed view drops a bare optional (`title:` with nothing) so readers see it as absent; the raw list keeps it for the write. */
function withoutEmptyOptionals(c: PageComment): PageComment {
  const copy: PageComment = { ...c }
  for (const k of OPTIONAL) if (copy[k] === null) delete copy[k]
  if (copy.n === null) delete copy.n
  return copy
}

const byTime = (a: PageComment, b: PageComment): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)

/** The recognised entries, `at` ascending (stable). Anything else in the list is skipped here and carried on write. */
const typed = (list: readonly unknown[]): PageComment[] => list.filter(isComment).map(withoutEmptyOptionals).sort(byTime)

/** The comments the block shows. A non-list value or a broken block reads as none — `commentsShape` says which. */
export function readComments(content: string): PageComment[] {
  return typed(rawList(content).list)
}

export function newCommentId(): string {
  // shared/ compiles against the bare ES2022 lib, so Web Crypto (Chromium and Node alike) is reached through globalThis.
  return (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID().slice(0, 8)
}

export function nowIso(now = Date.now()): string {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

interface Threading {
  byId: Map<string, PageComment>
  /** Position in the `at`-sorted list: the tie-breaker a cycle needs. */
  order: Map<string, number>
}

const threading = (comments: readonly PageComment[]): Threading => ({
  byId: new Map(comments.map((c) => [c.id, c])),
  order: new Map(comments.map((c, i) => [c.id, i])),
})

/**
 * The top-level parent of `start`: `reply_to` is followed while it resolves. A comment with no
 * parent, or whose parent is MISSING (an orphan), is its own root and shows at top level. A
 * hand-made `reply_to` cycle never loops: its earliest member stands in as the root.
 */
function rootOf({ byId, order }: Threading, start: PageComment): string {
  const path: string[] = []
  let cur = start
  for (;;) {
    const seen = path.indexOf(cur.id)
    if (seen !== -1) return path.slice(seen).reduce((best, id) => ((order.get(id) ?? Infinity) < (order.get(best) ?? Infinity) ? id : best))
    path.push(cur.id)
    const parent = cur.reply_to === undefined ? undefined : byId.get(cur.reply_to)
    if (parent === undefined) return cur.id
    cur = parent
  }
}

/** Threads in `at` order of their top-level comment, each with its replies in `at` order. */
export function threadsOf(comments: readonly PageComment[]): CommentThread[] {
  const index = threading(comments)
  const roots = comments.map((c) => rootOf(index, c))
  const threads = new Map<string, CommentThread>()
  comments.forEach((c, i) => {
    if (roots[i] === c.id) threads.set(c.id, { comment: c, replies: [] })
  })
  comments.forEach((c, i) => {
    if (roots[i] !== c.id) threads.get(roots[i])?.replies.push(c)
  })
  return [...threads.values()]
}

/** The list as it will be written back, or the refusal: `foreign` and `invalid` bytes are not ours. */
function writable(content: string): readonly unknown[] {
  const { shape, list } = rawList(content)
  if (shape === 'foreign' || shape === 'invalid') throw new CommentsShapeError(shape)
  return list
}

/** An emptied list deletes the KEY (🔒 D7): no `comments: []` is ever left behind. */
function write(content: string, list: readonly unknown[]): string {
  return setFrontmatterProperty(content, COMMENTS_KEY, list.length === 0 ? undefined : list)
}

/** A title is a key only when it says something: blank means none, and none is written as nothing. */
const titleKey = (title: string | undefined): { title?: string } => {
  const t = title?.trim() ?? ''
  return t === '' ? {} : { title: t }
}

/**
 * Append one comment. `replyTo` is filed under ITS top-level parent when it names a reply, so a
 * thread stays one level deep; an id that names nothing is kept as given (the UI never passes one).
 * `by` is written only when given, after `reply_to` and before `title`.
 */
export function addComment(content: string, body: string, entry: { id: string; at: string; replyTo?: string; title?: string; by?: string }): string {
  const list = writable(content)
  const text = body.trimEnd()
  const title = titleKey(entry.title)
  // `by` is the writer's declaration (🔒 D3): the UI passes none, the `yaseendocs` command passes its caller's (YAZ-1617).
  const by = entry.by === undefined ? {} : { by: entry.by }
  if (entry.replyTo === undefined) return write(content, [...list, { id: entry.id, n: nextNumber(list, undefined), at: entry.at, ...by, ...title, body: text }])
  const index = threading(typed(list))
  const target = index.byId.get(entry.replyTo)
  const reply_to = target === undefined ? entry.replyTo : rootOf(index, target)
  // Key order on disk is the schema's: id, n, at, reply_to, by, title, body.
  return write(content, [...list, { id: entry.id, n: nextNumber(list, reply_to), at: entry.at, reply_to, ...by, ...title, body: text }])
}

/**
 * One past the highest number in the run: the page's top-level comments, or one parent's replies.
 * Counted over the typed view the reader uses, so a bare `reply_to:` (YAML null) sits in the
 * top-level run exactly as it renders there — never outside every run.
 */
const nextNumber = (list: readonly unknown[], replyTo: string | undefined): number =>
  1 + Math.max(0, ...typed(list).filter((c) => c.reply_to === replyTo).map((c) => c.n ?? 0))


/**
 * Replace the body (and the title: blank removes it) and stamp `edited`; unknown keys ride along.
 * An unknown id changes nothing.
 */
export function editComment(content: string, id: string, body: string, at: string, title: string): string {
  const list = writable(content)
  const i = list.findIndex((e) => isComment(e) && e.id === id)
  if (i === -1) return content
  // `title`, `edited`, `body` land last in the schema's order whether this is the first stamp or a re-stamp.
  const { body: _body, edited: _edited, title: _title, ...rest } = list[i] as PageComment
  return write(
    content,
    list.map((e, j) => (j === i ? { ...rest, ...titleKey(title), edited: at, body: body.trimEnd() } : e)),
  )
}

/** Remove one comment AND every reply to it. An unknown id changes nothing. */
export function deleteComment(content: string, id: string): string {
  const list = writable(content)
  const kept = list.filter((e) => !(isComment(e) && (e.id === id || e.reply_to === id)))
  return kept.length === list.length ? content : write(content, kept)
}
