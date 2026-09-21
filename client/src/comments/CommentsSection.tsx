/**
 * The comment stream (YAZ-1472) — a Linear-style block of the note's own, INSIDE the editor's
 * scroller after the folder page's contents and before "Linked mentions" (🔒 D4). Always
 * rendered, unlike the backlinks: the composer is the door to the first comment. Storage is the
 * note's frontmatter (`shared/comments.ts`, 🔒 D1), so this block is a VIEW over the same disk
 * truth the properties panel reads — `file.content` is CrepeHost's `disk` — with no watcher of
 * its own.
 *
 * Writes (🔒 D8): every mutation is one `transformFile(path, fresh => …)` — the change applies to
 * the FRESH bytes, lands with `expectedMtime`, retries once on conflict — and the block adopts
 * exactly the bytes that landed. The watcher then echoes the write back through the Editor's
 * `absorbFrontmatterOnly` → `setDisk`, which the snapshot below recognises as the same content.
 *
 * Shapes (`commentsShape`): a note whose `comments` is a value of the user's own, or whose block
 * does not parse, gets the header and one line saying why — no composer, nothing overwritten.
 * Threads are one level deep; an orphaned reply shows at top level (`threadsOf`).
 *
 * The shape on screen — one card per thread, the outliner's folds, the title fixed in the header
 * row, "(agent)" after the time — is CONTRACTS "Comments" 🔒 D12. Fold state and the header's
 * collapse are session chrome, never persisted (the backlinks' rule). A link inside a body opens
 * through the shell like the editor's own, never by navigating the app window.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  addComment,
  commentsShape,
  deleteComment,
  editComment,
  newCommentId,
  nowIso,
  readComments,
  threadsOf,
  type PageComment,
} from '@shared/comments'
import type { CommentsOrder, FileResponse } from '@shared/types'
import { api } from '../api'
import { relativeTime } from '../lib/relativeTime'
import { transformFile } from '../views/writeProperty'
import { ConfirmDeleteComment } from './ConfirmDeleteComment'
import { commentHtml, commentInlineHtml, commentSplit } from './markdown'
import './comments.css'

export interface CommentsSectionProps {
  /** The open note as the Editor last saw it on disk — the block's truth until its own write moves it. */
  file: Pick<FileResponse, 'path' | 'content'>
  /** How the stream READS (YAZ-1515): a global setting handed down as a prop, never read from storage here. */
  order: CommentsOrder
  /** The header's Oldest/Newest toggle writes the setting through this; the block holds no order of its own. */
  onChangeOrder: (order: CommentsOrder) => void
}

interface Snapshot {
  /** The `file.content` PROP this was last derived from — the re-derive trigger, and nothing else. */
  seen: string
  /** Whole-file bytes the block believes are on disk; its own writes move this AHEAD of `seen`. */
  content: string
}

/** The one inline composer open besides the bottom one: a reply under a thread, or an edit in place of a body. */
type Inline = { kind: 'reply'; to: string } | { kind: 'edit'; id: string } | null

/** A delete waiting on the sheet: which comment, the number it wears, how many replies go with it. */
interface PendingDelete {
  id: string
  label: string | null
  replies: number
}

/** What a composer hands back: the text, and the optional one-line title. */
interface Draft {
  body: string
  title: string
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const NOTICE = {
  foreign: "This note's comments property isn't a comment list, so nothing can be added here.",
  invalid: "The properties block doesn't parse. Fix it in Properties to comment here.",
} as const

/** A declared `by` or `title` counts only when it says something. */
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/**
 * What a comment shows in its header row and what sits below it. A title is the header and the
 * whole body is below. Without one, the body's first line is the header — permanently, so a fold
 * never moves text — and only the REST is below; a one-liner has nothing below and nothing to fold.
 */
/** `#3` for a top-level comment, `#3.1` for a reply under it; null (a dot) when either number is missing or the parent is gone. */
function labelOf(comment: PageComment, parent?: PageComment): string | null {
  if (comment.n === undefined) return null
  if (parent === undefined) return comment.reply_to === undefined ? `#${comment.n}` : null
  return parent.n === undefined ? null : `#${parent.n}.${comment.n}`
}

function shapeOf(comment: PageComment): { title: string | null; head: string; below: string; foldable: boolean } {
  const title = nonBlank(comment.title)
  if (title !== null) return { title, head: title, below: comment.body, foldable: true }
  const { summary, rest } = commentSplit(comment.body)
  return { title: null, head: summary, below: rest, foldable: rest.trim() !== '' }
}

const Chevron = () => (
  <svg className="comments__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m4 6 4 4 4-4" />
  </svg>
)

const toggled = (set: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function CommentsSection({ file, order, onChangeOrder }: CommentsSectionProps) {
  const [snap, setSnap] = useState<Snapshot>(() => ({ seen: file.content, content: file.content }))
  // The file moved under us (a reload, a property write, our own write echoed back): follow it.
  if (snap.seen !== file.content) setSnap({ seen: file.content, content: file.content })

  // Open by default only when there is something to read (🔒 E): an empty stream starts folded and the header is the door. Decided once, at mount.
  const [expanded, setExpanded] = useState(() => readComments(file.content).length > 0)
  /** Comment ids folded to one line, and parent ids whose replies are hidden — the bullet's fold, twice. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [repliesFolded, setRepliesFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [inline, setInline] = useState<Inline>(null)
  const [confirming, setConfirming] = useState<PendingDelete | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = useClock()

  const shape = commentsShape(snap.content)
  // The model's order is by the ROOT's `at`; newest-first is that list read backwards. Replies stay oldest-first: a conversation reads down.
  const newest = order === 'newest'
  const chronological = threadsOf(readComments(snap.content))
  const threads = newest ? [...chronological].reverse() : chronological
  const count = threads.reduce((n, t) => n + 1 + t.replies.length, 0)

  // One fold-all control, the outliner's pair in one seat: while anything is open it collapses
  // everything (comments and reply groups); once everything is folded it expands everything.
  // Only what can fold counts toward "everything folded": a one-liner has nothing to fold.
  const everyId = threads.flatMap((t) => [t.comment, ...t.replies]).filter((c) => shapeOf(c).foldable).map((c) => c.id)
  const everyThreaded = threads.filter((t) => t.replies.length > 0).map((t) => t.comment.id)
  const allFolded = everyId.every((id) => folded.has(id)) && everyThreaded.every((id) => repliesFolded.has(id))
  const foldAll = (): void => {
    setFolded(allFolded ? new Set() : new Set(everyId))
    setRepliesFolded(allFolded ? new Set() : new Set(everyThreaded))
  }

  /** ONE write, whole: fresh bytes in, landed bytes adopted. Never throws to React — the line at the foot of the block says. */
  const write = async (transform: (fresh: string) => string): Promise<boolean> => {
    setSaving(true)
    try {
      const { content } = await transformFile(file.path, transform)
      setSnap((s) => ({ seen: s.seen, content }))
      setError(null)
      return true
    } catch (err) {
      setError(`Could not save the comment: ${messageOf(err)}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  const add = (draft: Draft, replyTo?: string): Promise<boolean> =>
    write((fresh) => addComment(fresh, draft.body, { id: newCommentId(), at: nowIso(), replyTo, title: draft.title }))

  const closeInline = (): void => {
    setInline(null)
    setError(null)
  }

  const item = (comment: PageComment, parent?: PageComment, onReply?: () => void, replies = 0) => (
    <CommentItem
      key={comment.id}
      comment={comment}
      label={labelOf(comment, parent)}
      now={now}
      saving={saving}
      folded={folded.has(comment.id)}
      editing={inline?.kind === 'edit' && inline.id === comment.id}
      onToggleFold={() => setFolded((s) => toggled(s, comment.id))}
      onReply={onReply}
      onEdit={() => {
        setFolded((s) => (s.has(comment.id) ? toggled(s, comment.id) : s))
        setInline({ kind: 'edit', id: comment.id })
      }}
      onDelete={() => setConfirming({ id: comment.id, label: labelOf(comment, parent), replies })}
      onSave={async (draft) => {
        // Save is against the comment as it was opened: gone or changed underneath → refuse, never clobber.
        const ok = await write((fresh) => {
          const current = readComments(fresh).find((c) => c.id === comment.id)
          if (current === undefined || current.body !== comment.body || current.edited !== comment.edited) {
            throw new Error('this comment changed on disk — cancel and reopen Edit')
          }
          return editComment(fresh, comment.id, draft.body, nowIso(), draft.title)
        })
        if (ok) closeInline()
        return ok
      }}
      onCancel={closeInline}
    />
  )

  /** A link in a rendered body: through the shell, the editor's way — a click must never navigate the app window. */
  const onClick = (e: React.MouseEvent<HTMLElement>): void => {
    const a = (e.target as Element).closest('.comments__body a[href]')
    if (a === null) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (href === '' || href.startsWith('#')) return
    void api.openLink({ href, sourcePath: file.path }).catch((err: unknown) => setError(`Could not open the link: ${messageOf(err)}`))
  }

  return (
    <section className="comments" onClick={onClick}>
      <div className="comments__bar">
        <button type="button" className="comments__header" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
          <Chevron />
          <span className="comments__title">
            Comments
            {count > 0 && <span className="comments__count"> ({count})</span>}
          </span>
        </button>
        {expanded && (
          <div className="comments__tools">
            {/* The order toggle (YAZ-1515): state-driven like fold-all — the label names the CURRENT order; below two threads there is nothing to reorder. */}
            {threads.length > 1 && (
              <button type="button" className="comments__tool" title={newest ? 'Show oldest first' : 'Show newest first'} onClick={() => onChangeOrder(newest ? 'oldest' : 'newest')}>
                <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {newest ? <path d="M8 3v10M4 9l4 4 4-4" /> : <path d="M8 13V3M4 7l4-4 4 4" />}
                </svg>
                {newest ? 'Newest first' : 'Oldest first'}
              </button>
            )}
            {(everyId.length > 0 || everyThreaded.length > 0) && (
              <button type="button" className="comments__tool" onClick={foldAll}>
                <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {allFolded ? <path d="m5 5.5 3-3 3 3M5 10.5l3 3 3-3" /> : <path d="m5 3 3 3 3-3M5 13l3-3 3 3" />}
                </svg>
                {allFolded ? 'Expand all' : 'Collapse all'}
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && (
        <>
          {shape === 'foreign' || shape === 'invalid' ? (
            <p className="comments__notice">{NOTICE[shape]}</p>
          ) : (
            <>
              {threads.length > 0 && (
                <div className="comments__list">
                  {threads.map(({ comment, replies }) => {
                    const opened = inline?.kind === 'reply' && inline.to === comment.id
                    const threaded = replies.length > 0
                    const hidden = repliesFolded.has(comment.id)
                    return (
                      <div key={comment.id} className="comments__thread">
                        {/* A thread already has its reply field; a lone comment offers Reply on hover. */}
                        {item(comment, undefined, threaded ? undefined : () => setInline({ kind: 'reply', to: comment.id }), replies.length)}
                        {threaded && (
                          <button type="button" className="comments__replies-toggle" aria-expanded={!hidden} onClick={() => setRepliesFolded((s) => toggled(s, comment.id))}>
                            <Chevron />
                            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                          </button>
                        )}
                        {threaded && !hidden && (
                          <div className="comments__replies">
                            {replies.map((reply) => item(reply, comment))}
                            <Composer placeholder="Reply…" submitLabel="Reply" saving={saving} collapsible onSubmit={(draft) => add(draft, comment.id)} />
                          </div>
                        )}
                        {!threaded && opened && (
                          <div className="comments__replies">
                            <Composer
                              placeholder="Reply…"
                              submitLabel="Reply"
                              saving={saving}
                              onSubmit={async (draft) => {
                                const ok = await add(draft, comment.id)
                                if (ok) closeInline()
                                return ok
                              }}
                              onCancel={closeInline}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {/* The composer stays at the BOTTOM whichever way the list reads (YAZ-1515: Yasin's call on the demo). */}
              <Composer placeholder="Leave a comment…" submitLabel="Comment" saving={saving} onSubmit={(draft) => add(draft)} />
            </>
          )}
          {error !== null && (
            <p className="comments__error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {confirming !== null && (
        <ConfirmDeleteComment
          label={confirming.label}
          replies={confirming.replies}
          onConfirm={() => {
            const { id } = confirming
            setConfirming(null)
            void write((fresh) => deleteComment(fresh, id))
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </section>
  )
}

/** Wall-clock for the relative stamps: a minute's resolution is all "just now" → "1 minute ago" needs. */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** A stamp that will not parse is shown as written rather than as "just now". */
const parsed = (iso: string): number | null => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

function CommentItem({
  comment,
  label,
  now,
  saving,
  folded,
  editing,
  onToggleFold,
  onReply,
  onEdit,
  onDelete,
  onSave,
  onCancel,
}: {
  comment: PageComment
  /** `#3` / `#3.1`, or null for a dot. */
  label: string | null
  now: number
  saving: boolean
  folded: boolean
  editing: boolean
  onToggleFold: () => void
  /** Only on a top-level comment with no replies yet: a thread carries its own reply field. */
  onReply?: () => void
  onEdit: () => void
  onDelete: () => void
  onSave: (draft: Draft) => Promise<boolean>
  onCancel: () => void
}) {
  const at = parsed(comment.at)
  const edited = comment.edited === undefined ? null : parsed(comment.edited)
  const by = nonBlank(comment.by)
  const { title, head, below, foldable } = shapeOf(comment)
  const closed = foldable && folded && !editing
  return (
    <article className={`comments__item${by === null ? '' : ' comments__item--agent'}`}>
      <div className="comments__meta">
        {foldable ? (
          <button type="button" className="comments__fold" aria-expanded={!closed} aria-label={closed ? 'Expand comment' : 'Collapse comment'} onClick={onToggleFold}>
            <Chevron />
          </button>
        ) : (
          <span className="comments__fold comments__fold--none" aria-hidden />
        )}
        {/* The comment's number, worn like an id (`#3`, a reply `#3.1`); a hand-written one without a number gets a dot. */}
        <span className="comments__mark" title={label === null ? 'No number on this comment' : `Comment ${label}`}>
          {label ?? '·'}
        </span>
        {/* The header text never moves: a title, or the body's first line — the whole comment when that is all there is. */}
        {title !== null ? (
          <span className="comments__summary comments__summary--title">{head}</span>
        ) : (
          // A body's first line keeps its inline Markdown (sanitised, the same renderer as the body).
          <span className={`comments__summary${foldable ? '' : ' comments__summary--whole'}`} dangerouslySetInnerHTML={{ __html: commentInlineHtml(head) }} />
        )}
        <time className="comments__when" dateTime={comment.at} title={at === null ? comment.at : new Date(at).toLocaleString()}>
          {at === null ? comment.at : relativeTime(at, now)}
        </time>
        {comment.edited !== undefined && (
          <span className="comments__edited" title={edited === null ? comment.edited : `Edited ${new Date(edited).toLocaleString()}`}>
            (edited)
          </span>
        )}
        {/* The writer, as declared in `by`, in the same quiet voice as "(edited)" — the dot's colour already says it. */}
        {by !== null && <span className="comments__by">({by})</span>}
        <div className="comments__actions">
          {onReply !== undefined && (
            <button type="button" className="comments__action" onClick={onReply}>
              Reply
            </button>
          )}
          <button type="button" className="comments__action" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="comments__action comments__action--danger" disabled={saving} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {editing ? (
        <Composer initial={{ body: comment.body, title: title ?? '' }} placeholder="Edit…" submitLabel="Save" saving={saving} onSubmit={onSave} onCancel={onCancel} />
      ) : (
        // Sanitised HTML from `commentHtml`: Markdown in, document markup out, nothing that can run.
        !closed && foldable && <div className="comments__body" dangerouslySetInnerHTML={{ __html: commentHtml(below) }} />
      )}
    </article>
  )
}

/**
 * The one composer, three seats: the bottom of the block, the bottom of a card with replies (Reply),
 * in place of a body (Edit). ⌘Enter submits, Esc cancels — or clears the draft when there is
 * nothing to cancel. The textarea grows with its text and keeps focus across a submit. The
 * optional title line appears once the composer is in use (focused, holding text, or editing). A
 * `collapsible` seat shows one placeholder line until then — Linear's "Reply…" row — and folds
 * back when it is empty and loses focus. A seat that can be cancelled was opened by a click, so
 * it takes focus.
 */
function Composer({
  placeholder,
  submitLabel,
  initial,
  saving,
  collapsible = false,
  onSubmit,
  onCancel,
}: {
  placeholder: string
  submitLabel: string
  /** The edit seat's starting text; absent everywhere else. */
  initial?: Draft
  saving: boolean
  collapsible?: boolean
  /** Resolves true when the text landed; the composer then clears (a seat that closes unmounts it anyway). */
  onSubmit: (draft: Draft) => Promise<boolean>
  /** Esc and the Cancel button; absent → Esc clears the draft and there is no Cancel. */
  onCancel?: () => void
}) {
  const autoFocus = onCancel !== undefined
  const [text, setText] = useState(initial?.body ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [focused, setFocused] = useState(autoFocus)
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const holding = text.trim() !== '' || title.trim() !== ''
  const ready = text.trim() !== '' && !saving
  // In use: focused anywhere inside, holding text, or an edit — a collapsible seat is one line otherwise.
  const active = focused || holding || initial !== undefined
  const open = !collapsible || active

  const submit = async (): Promise<void> => {
    if (!ready) return
    if (await onSubmit({ body: text, title })) {
      setText('')
      setTitle('')
      ref.current?.focus()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape') {
      // The textarea owns Esc while focused, the properties panel's way: nothing else in the window hears it.
      e.preventDefault()
      e.stopPropagation()
      if (onCancel !== undefined) onCancel()
      else {
        setText('')
        setTitle('')
        if (collapsible) (e.currentTarget as HTMLElement).blur()
      }
    }
  }

  return (
    <div
      className={`comments__composer${open ? '' : ' comments__composer--collapsed'}`}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        // Focus moving to a button inside is still "in use": the click must land before anything folds.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      {active && (
        <input
          type="text"
          className="comments__title-input"
          placeholder="Title (optional)"
          aria-label="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            // Enter on the title line moves to the text, the way a subject line does.
            if (e.key === 'Enter' && !e.metaKey) {
              e.preventDefault()
              ref.current?.focus()
            } else onKeyDown(e)
          }}
        />
      )}
      <textarea
        ref={ref}
        className="comments__textarea"
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="comments__footer">
          <span className="comments__hint">⌘ Enter</span>
          {onCancel !== undefined && (
            <button type="button" className="btn comments__btn" disabled={saving} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="btn btn--primary comments__btn" disabled={!ready} onClick={() => void submit()}>
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  )
}
