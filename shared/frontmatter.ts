import { type Document, isMap, parse, parseDocument } from 'yaml'

/**
 * Frontmatter handling rule (locked in GRO-1961):
 * Crepe/remark does not understand a leading YAML `---` block — it would render
 * it as a thematic break + paragraph and re-serialise it lossy. So the client
 * strips the leading frontmatter block BEFORE loading markdown into Crepe and
 * re-prepends it byte-identically on save (`frontmatter + body`).
 *
 * A frontmatter block is: file starts with `---\n` (or `---\r\n`), followed by
 * any lines (possibly none — `---\n---\n` is the empty block a delete of the
 * last key leaves behind, GRO-2216), terminated by a line that is exactly
 * `---` (or `...`).
 *
 * Shared with the main process's Bases index (GRO-2127), which parses the block via `parseFrontmatter`.
 */
export interface SplitMarkdown {
  /** The raw frontmatter block including both `---` fences and trailing newline; '' if none. */
  frontmatter: string
  /** Everything after the frontmatter block. */
  body: string
}

const FM_RE = /^(---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/

export function splitFrontmatter(markdown: string): SplitMarkdown {
  const m = FM_RE.exec(markdown)
  if (!m) return { frontmatter: '', body: markdown }
  const frontmatter = m[1]
  return { frontmatter, body: markdown.slice(frontmatter.length) }
}

const OPEN_FENCE_RE = /^---[ \t]*\r?\n/
const CLOSE_FENCE_RE = /(?:^|\r?\n)(?:---|\.\.\.)[ \t]*(?:\r?\n)?$/

/**
 * Parses a `splitFrontmatter().frontmatter` block (fences included) with yaml's default core
 * schema, so dates stay strings and only the 1.2 core scalars (null/bool/int/float) are typed.
 * Non-map documents and YAML errors yield `{}` plus a one-line `error` (GRO-2127).
 */
/**
 * The raw INTERIOR of a `splitFrontmatter().frontmatter` block: the fences and the terminator
 * come off, every other byte — comments, key order, quoting, blank lines — stays exactly as the
 * file has it. The inverse of `replaceFrontmatter` (⚡ YAZ-883) and the one place the fence
 * regexes are applied, so the parser and the raw panel can never disagree about where a block
 * ends. Note the trailing newline goes with the terminator: `---\na: 1\n---\n` → `a: 1`.
 */
export function frontmatterInterior(frontmatter: string): string {
  return frontmatter.replace(OPEN_FENCE_RE, '').replace(CLOSE_FENCE_RE, '')
}

export function parseFrontmatter(frontmatter: string): { properties: Record<string, unknown>; error?: string } {
  const yaml = frontmatterInterior(frontmatter)
  let value: unknown
  try {
    value = parse(yaml, { prettyErrors: false })
  } catch (err) {
    return { properties: {}, error: err instanceof Error ? err.message : String(err) }
  }
  if (value === null || value === undefined) return { properties: {} }
  if (typeof value !== 'object' || Array.isArray(value)) return { properties: {}, error: 'frontmatter is not a map' }
  return { properties: value as Record<string, unknown> }
}

/** Thrown instead of writing when a note's frontmatter is not valid YAML, or is not a map (GRO-2141). */
export class FrontmatterWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrontmatterWriteError'
  }
}

/** Captures the closing fence so `...` survives a rewrite. */
const TERMINATOR_RE = /(?:^|\r?\n)(---|\.\.\.)[ \t]*(?:\r?\n)?$/

/** Same options as `serializeViews`: no folding, no `[ 1, 2 ]` padding. */
const YAML_OUT = { lineWidth: 0, flowCollectionPadding: false } as const

/**
 * Set (or delete, when `value === undefined`) ONE frontmatter key in a whole file's
 * content, touching nothing else: comments, key order, quoting style and the body
 * are preserved byte-for-byte (GRO-2141, ruling D4).
 *
 * Values go in as YAML natively (strings, numbers, booleans, null, arrays, plain objects);
 * a `Date` is out of scope — callers pass ISO strings.
 */
export function setFrontmatterProperty(content: string, key: string, value: unknown): string {
  const { frontmatter, body } = splitFrontmatter(content)

  if (frontmatter === '') {
    if (value === undefined) return content
    const doc = parseDocument('')
    doc.setIn([key], value)
    return `---\n${doc.toString(YAML_OUT)}---\n${body}`
  }

  const eol = frontmatter.includes('\r\n') ? '\r\n' : '\n'
  const terminator = TERMINATOR_RE.exec(frontmatter)?.[1] ?? '---'
  const trailingEol = /\r?\n$/.test(frontmatter) ? eol : ''

  const doc = parseDocument(frontmatter.replace(OPEN_FENCE_RE, '').replace(CLOSE_FENCE_RE, ''))
  const err = doc.errors[0]
  if (err) throw new FrontmatterWriteError(`frontmatter is not valid YAML: ${err.message}`)
  if (doc.contents !== null && !isMap(doc.contents)) throw new FrontmatterWriteError('frontmatter is not a map')

  if (value === undefined) {
    if (!doc.hasIn([key])) return content
    doc.deleteIn([key])
  } else {
    doc.setIn([key], value)
  }

  const yaml = serializeInner(doc)
  return `---${eol}${eol === '\r\n' ? yaml.replace(/\n/g, '\r\n') : yaml}${terminator}${trailingEol}${body}`
}

/**
 * Replace a note's WHOLE frontmatter interior with the user's literal text (⚡ YAZ-883, the raw
 * properties panel). The text goes back VERBATIM — never parsed and re-serialised — so comments,
 * key order and quoting styles survive exactly as typed; validation is the CALLER's job
 * (`parseFrontmatter` on the result), because a block that will not parse would corrupt the index.
 *
 * The FRAME is the file's, not the text's: the opening fence, the terminator style (`---` or
 * `...`) and the line endings around them are carried over, and the body is untouched. A page with
 * no block grows one at the top; empty text removes the block entirely. One trailing newline is
 * supplied when the text lacks it, never a second when it has one — so an unchanged interior
 * round-trips to the identical string and the caller can skip the write.
 */
export function replaceFrontmatter(content: string, yamlText: string): string {
  const { frontmatter, body } = splitFrontmatter(content)
  if (yamlText === '') return body

  const eol = frontmatter.includes('\r\n') ? '\r\n' : '\n'
  const terminator = TERMINATOR_RE.exec(frontmatter)?.[1] ?? '---'
  // A block the file ends on without a newline keeps that shape; a fresh block always gets one.
  const trailingEol = frontmatter === '' || /\r?\n$/.test(frontmatter) ? eol : ''
  const interior = /\r?\n$/.test(yamlText) ? yamlText : `${yamlText}${eol}`
  return `---${eol}${interior}${terminator}${trailingEol}${body}`
}

/** An emptied map serialises as `{}`; we want the block to just be empty instead. */
function serializeInner(doc: Document): string {
  if (isMap(doc.contents) && doc.contents.items.length === 0) return ''
  return doc.toString(YAML_OUT)
}

/**
 * A whole frontmatter block built from scratch (5D seeds, new-entity scaffolds — GRO-2144,
 * Bible B GRO-2202): fences included, `{}` → ''. Values serialize through the same Document
 * API and options as `setFrontmatterProperty`; `null` prints Obsidian-style empty (`key:`),
 * not `key: null` — the shape a scaffold wants for empty scalar properties.
 */
export function buildFrontmatter(properties: Record<string, unknown>): string {
  const entries = Object.entries(properties)
  if (entries.length === 0) return ''
  const doc = parseDocument('')
  for (const [key, value] of entries) doc.setIn([key], value)
  return `---\n${doc.toString({ ...YAML_OUT, nullStr: '' })}---\n`
}
