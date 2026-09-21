/**
 * A comment body as HTML (YAZ-1472, 🔒 D9): GitHub-flavoured Markdown, rendered read-only,
 * sanitised. `marked` parses (tables, task lists, strikethrough, fenced code; single newlines are
 * line breaks, the way a typed comment reads); DOMPurify keeps document markup only — no
 * scripts, styles or form controls — so a body, yours or an agent's, can never run or reach
 * outside its box. A task box is drawn as a glyph for the same reason: no `<input>` survives.
 * This is the only place the app turns Markdown into HTML rather than into a ProseMirror document.
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.use({ gfm: true, breaks: true, renderer: { checkbox: ({ checked }) => (checked ? '☑' : '☐') } })

const PURIFY = { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'select', 'textarea'] }

export function commentHtml(body: string): string {
  const html = marked.parse(body, { async: false })
  return DOMPurify.sanitize(html, PURIFY)
}

/** One line of a body as inline HTML (bold, code, a link) — the header row's seat when a comment has no title. */
export function commentInlineHtml(line: string): string {
  return DOMPurify.sanitize(marked.parseInline(line, { async: false }), PURIFY)
}

/**
 * A title-less comment's first line is its subject and the rest is its body: `summary` is the
 * first line that says anything, minus its Markdown marker; `rest` is everything after that line.
 * A one-liner has an empty `rest` — it IS its header row, with nothing to fold.
 */
export function commentSplit(body: string): { summary: string; rest: string } {
  const lines = body.split('\n')
  const i = lines.findIndex((l) => l.trim() !== '')
  if (i === -1) return { summary: '', rest: '' }
  const summary = lines[i].replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s+)/, '').trim()
  return { summary, rest: lines.slice(i + 1).join('\n').replace(/^\n+/, '') }
}

/** The first line alone — the folded row's stand-in when a comment has no title. */
export const commentSummary = (body: string): string => commentSplit(body).summary
