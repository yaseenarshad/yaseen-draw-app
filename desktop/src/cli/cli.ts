/**
 * `yaseendocs` (YAZ-1617 🔒 D1, D4, D5): the door an agent uses to work with a page's comments from
 * the shell. Plain Node — this module and its entry never import `electron`; the packaged shim
 * runs it under `ELECTRON_RUN_AS_NODE=1` with the app's own binary (VS Code's `code` pattern).
 *
 * It writes through the SAME `shared/comments.ts` the block uses, guarded the same way as the
 * renderer's `transformFile` (YAZ-1472 🔒 D8): fresh bytes, `expectedMtime`, one retry on
 * CONFLICT. `readFile` / `writeFile` from `main/fs/file` are Electron-free and already do the
 * atomic tmp+rename and the mtime check, so nothing is reimplemented here.
 *
 * `HELP` IS the contract: it is the only documentation an agent reads (the Copy for Agent
 * handshake points at `--help` and names no verb), so its wording is UI copy.
 */
import { resolve } from 'node:path'
import {
  addComment,
  deleteComment,
  editComment,
  newCommentId,
  nowIso,
  readComments,
  threadsOf,
  type PageComment,
} from '@shared/comments'
import { BridgeFailure, requireMarkdownFile } from '../main/fs/fsUtils'
import { readFile, writeFile } from '../main/fs/file'

export interface Io {
  /** The whole of stdin, for `--body -`. */
  stdin(): Promise<string>
  stdout(text: string): void
  stderr(text: string): void
}

export const USAGE = `usage:
  yaseendocs comment  <page.md> --body <text | -> [--title <one line>] [--reply-to <comment>] [--by <name>]
  yaseendocs comments <page.md> [--json]
  yaseendocs edit     <page.md> <comment> --body <text | -> [--title <one line>]
  yaseendocs delete   <page.md> <comment>
  yaseendocs --help`

export const HELP = `yaseendocs — comments on a Yaseen Docs page, from the shell.

${USAGE}

A comment lives in the page's frontmatter under \`comments:\` — never in the body — and this
command writes it exactly as the app does (id, number, time stamp, order). \`--body -\` reads
the text from stdin, so a long or multi-line comment needs no shell quoting. \`comments\` prints
every thread (\`--json\` for the raw shape). Name a comment by its number as the app shows it —
#3, or #3.1 for a reply — or by its id; a reply to #3 shows as #3.1.

Who wrote it: \`comment\` records \`by: agent\` unless --by says otherwise; a person's comment,
left in the app, has no \`by\`. \`edit\` and \`delete\` work only on comments that carry a \`by\` —
a person's comment is edited or deleted in the app. Deleting a comment deletes its replies.

Exit codes: 0 done · 1 refused or failed (the reason is on stderr) · 2 usage.

Example:
  yaseendocs comment "/vault/Weekly review.md" --title "Numbers check" --body "The Q3 figure is off by one row."
  → #3 added to /vault/Weekly review.md
`

/** Every flag the contract names; anything else is refused, because `--help` IS the contract (🔒 D1) and a typo must not be absorbed. */
const FLAGS = new Set(['--body', '--title', '--reply-to', '--by'])
/** Flags that take no value. */
const SWITCHES = new Set(['--json', '--help', '-h'])

class Usage extends Error {}

function parse(argv: readonly string[]): { verb: string; args: string[]; flags: Map<string, string | true> } {
  const args: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('-') || a === '-') args.push(a)
    else if (SWITCHES.has(a)) flags.set(a, true)
    else if (!FLAGS.has(a)) throw new Usage(`unknown flag: ${a}`)
    else if (i + 1 < argv.length) flags.set(a, argv[++i])
    else throw new Usage(`${a} needs a value`)
  }
  const [verb = '', ...rest] = args
  return { verb, args: rest, flags }
}

/**
 * The renderer's `transformFile` on disk: read, transform, write against the mtime just read;
 * on CONFLICT read again and recompute ONCE. A second conflict throws. A no-op transform
 * writes nothing and returns the bytes as read.
 */
export async function transformOnDisk(path: string, transform: (content: string) => string): Promise<string> {
  let file = await readFile(path)
  let retried = false
  for (;;) {
    const content = transform(file.content)
    if (content === file.content) return content
    try {
      await writeFile({ path, content, expectedMtime: file.mtime })
      return content
    } catch (err) {
      if (!(err instanceof BridgeFailure) || err.code !== 'CONFLICT' || retried) throw err
      retried = true
      file = await readFile(path)
    }
  }
}

/** `#3` for a top-level comment, `#3.1` for a reply; the id when a hand-written entry has no number. */
export function label(comments: readonly PageComment[], c: PageComment): string {
  if (c.n === undefined) return c.id
  const parent = c.reply_to === undefined ? undefined : comments.find((p) => p.id === c.reply_to)
  return parent?.n === undefined ? `#${c.n}` : `#${parent.n}.${c.n}`
}

const firstLine = (c: PageComment): string => c.title ?? c.body.split('\n', 1)[0]

/**
 * The comment `ref` names: its id, or its number the way the app and the receipts show it —
 * `#3` / `3` (top level), `#3.1` / `3.1` (reply 1 of #3). An id wins when both could match. Found
 * by the SAME `label` the listing prints, so what an agent reads is what it can type.
 */
export function find(comments: readonly PageComment[], ref: string): PageComment | undefined {
  const byId = comments.find((c) => c.id === ref)
  if (byId !== undefined) return byId
  const number = /^#?(\d+(?:\.\d+)?)$/.exec(ref)?.[1]
  return number === undefined ? undefined : comments.find((c) => label(comments, c) === `#${number}`)
}

/** One line per comment: label, stamp, writer, then the title or first line. Replies indented under their parent. */
function listing(comments: readonly PageComment[]): string {
  const line = (c: PageComment, indent: string) => `${indent}${label(comments, c)}  ${c.id}  ${c.at}  ${c.by === undefined ? '' : `(${c.by})  `}${firstLine(c)}`
  return threadsOf(comments)
    .flatMap(({ comment, replies }) => [line(comment, ''), ...replies.map((r) => line(r, '  '))])
    .join('\n')
}

/** A comment the caller may edit or delete: `ref` names one (id or number) and it carries a `by` (🔒 D4). Returns the parse it did, so callers label without parsing again. */
function agentOwned(content: string, ref: string, page: string): { comments: PageComment[]; target: PageComment } {
  const comments = readComments(content)
  const target = find(comments, ref)
  if (target === undefined) throw new Error(`no comment ${ref} on ${page}`)
  if (target.by === undefined || target.by.trim() === '') {
    throw new Error(`${label(comments, target)} was left by a person — edit or delete it in the app`)
  }
  return { comments, target }
}

async function bodyOf(flags: Map<string, string | true>, io: Io): Promise<string> {
  const body = flags.get('--body')
  if (typeof body !== 'string') throw new Usage('--body is required')
  return body === '-' ? io.stdin() : body
}

const str = (flags: Map<string, string | true>, name: string): string | undefined => {
  const v = flags.get(name)
  return typeof v === 'string' ? v : undefined
}

async function run(argv: readonly string[], io: Io): Promise<void> {
  const { verb, args, flags } = parse(argv)
  if (verb === '' || verb === 'help' || flags.has('--help') || flags.has('-h')) {
    io.stdout(HELP)
    return
  }
  const page = args[0] === undefined ? undefined : resolve(args[0])
  if (page === undefined) throw new Usage(`${verb} needs a page`)
  requireMarkdownFile(page) // a page is Markdown; every verb refuses anything else before any I/O

  switch (verb) {
    case 'comment': {
      const body = await bodyOf(flags, io)
      const id = newCommentId()
      const replyRef = str(flags, '--reply-to')
      const content = await transformOnDisk(page, (fresh) => {
        // The model keeps an unknown `reply_to` as given (the UI never passes one); the command REFUSES it, so a typo cannot orphan a reply.
        const parent = replyRef === undefined ? undefined : find(readComments(fresh), replyRef)
        if (replyRef !== undefined && parent === undefined) throw new Error(`no comment ${replyRef} on ${page}`)
        return addComment(fresh, body, { id, at: nowIso(), replyTo: parent?.id, title: str(flags, '--title'), by: str(flags, '--by')?.trim() || 'agent' })
      })
      const comments = readComments(content)
      const added = comments.find((c) => c.id === id)
      io.stdout(`${added === undefined ? id : label(comments, added)} added to ${page}\n`)
      return
    }
    case 'comments': {
      const comments = readComments((await readFile(page)).content)
      io.stdout(flags.has('--json') ? `${JSON.stringify(threadsOf(comments), null, 2)}\n` : comments.length === 0 ? `no comments on ${page}\n` : `${listing(comments)}\n`)
      return
    }
    case 'edit': {
      const ref = args[1]
      if (ref === undefined) throw new Usage('edit needs a comment (#3, #3.1, or its id)')
      const body = await bodyOf(flags, io)
      let name = ref
      await transformOnDisk(page, (fresh) => {
        const { comments, target } = agentOwned(fresh, ref, page)
        name = label(comments, target)
        return editComment(fresh, target.id, body, nowIso(), str(flags, '--title') ?? target.title ?? '')
      })
      io.stdout(`${name} edited\n`)
      return
    }
    case 'delete': {
      const ref = args[1]
      if (ref === undefined) throw new Usage('delete needs a comment (#3, #3.1, or its id)')
      let receipt = ref
      await transformOnDisk(page, (fresh) => {
        const { comments, target } = agentOwned(fresh, ref, page)
        const replies = comments.filter((c) => c.reply_to === target.id).length
        receipt = `${label(comments, target)} deleted${replies === 0 ? '' : ` (and ${replies} ${replies === 1 ? 'reply' : 'replies'})`}`
        return deleteComment(fresh, target.id)
      })
      io.stdout(`${receipt}\n`)
      return
    }
    default:
      throw new Usage(`unknown command: ${verb}`)
  }
}

/** The program: resolves to the exit code (0 done · 1 refused or failed · 2 usage). */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  try {
    await run(argv, io)
    return 0
  } catch (err) {
    if (err instanceof Usage) {
      io.stderr(`${err.message}\n${USAGE}\n`)
      return 2
    }
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
