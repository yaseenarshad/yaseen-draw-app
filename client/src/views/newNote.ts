import { buildFrontmatter } from '@shared/frontmatter'
import { api } from '../api'
import type { ViewSet, ViewDef, FilterNode } from './viewSchema'
import { type Expr, compile } from './expr'

/**
 * The toolbar's "New" (5D, GRO-2144): a note pre-filled so it satisfies the current view.
 * `deriveSeed` is pure over the filter ASTs (def + view): equality filters `note.x == <literal>`
 * seed `x` with the literal's YAML type, `file.hasTag("t")` seeds `tags: [t]`, and a single
 * `file.inFolder("…")` names the root-relative target folder. Only and-reachable rules count —
 * seeding an `or`/`not` branch would not (or would anti-) satisfy the view. Non-equality rules
 * are ignored by design (locked kickoff decision on the issue).
 */

export interface NewNoteSeed {
  /** Bare frontmatter keys → raw YAML values. */
  properties: Record<string, unknown>
  /** Root-relative folder named by the single `file.inFolder` rule; null → the folder page's own folder. */
  folder: string | null
}

const SCOPE_IDENTS = new Set(['note', 'file', 'formula', 'this'])

/** Bare frontmatter key of a `note.x` / `note["x"]` / bare-`x` accessor; null for anything else. */
function noteKeyOf(e: Expr): string | null {
  if (e.type === 'member' && e.object.type === 'ident' && e.object.name === 'note') return e.name
  if (e.type === 'index' && e.object.type === 'ident' && e.object.name === 'note' && e.index.type === 'str') return e.index.value
  if (e.type === 'ident' && !SCOPE_IDENTS.has(e.name)) return e.name
  return null
}

/** The YAML value of a literal operand (string / number / boolean, negatives included); undefined otherwise. */
function literalOf(e: Expr): string | number | boolean | undefined {
  if (e.type === 'str' || e.type === 'num' || e.type === 'bool') return e.value
  if (e.type === 'unary' && e.op === '-' && e.operand.type === 'num') return -e.operand.value
  return undefined
}

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '')

/** And-reachable leaf expressions of a filter tree (`or`/`not` subtrees skipped entirely). Shared with 5E's pinned-type detection (`relation.ts`). */
export function andLeaves(node: FilterNode | undefined, out: string[]): void {
  if (node === undefined || node === null) return
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if ('and' in node && Array.isArray(node.and)) for (const child of node.and) andLeaves(child, out)
}

/** Seed properties + target folder for one view (see module doc). */
export function deriveSeed(def: ViewSet, view: ViewDef): NewNoteSeed {
  const leaves: string[] = []
  andLeaves(def.filters, leaves)
  andLeaves(view.filters, leaves)

  const properties: Record<string, unknown> = {}
  const tags: string[] = []
  const folders: string[] = []

  for (const src of leaves) {
    const e = compile(src).expr
    if (e === undefined) continue
    if (e.type === 'binary' && e.op === '==') {
      const key = noteKeyOf(e.left)
      const value = literalOf(e.right)
      if (key !== null && value !== undefined) properties[key] = value
    } else if (e.type === 'method' && e.object.type === 'ident' && e.object.name === 'file' && e.args.length === 1 && e.args[0].type === 'str') {
      if (e.name === 'hasTag') tags.push(e.args[0].value)
      else if (e.name === 'inFolder') folders.push(trimSlashes(e.args[0].value))
    }
  }

  if (tags.length > 0) {
    const existing = properties.tags
    if (Array.isArray(existing)) properties.tags = [...existing, ...tags.filter((t) => !existing.includes(t))]
    else if (existing === undefined) properties.tags = tags
  }

  return { properties, folder: folders.length === 1 ? folders[0] : null }
}

/** First free name in the locked scheme: `base`, `base 2`, `base 3`… (`taken` = basenames in the folder). */
export function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** The scheme over its default base — what a page with no typed name is called. */
export function untitledName(taken: ReadonlySet<string>): string {
  return freeName('Untitled', taken)
}

// TOMBSTONE (YAZ-846): `targetFolder(seedFolder, root, thisFile)` stood here — the plain 5D
// placement rule (the `inFolder` seed under the root, else the page's own folder, else the root).
// Its one caller was `ViewsPane`'s `createFromSeed`, and inside a folder page placement is
// OVERRIDDEN by the settings' `folder` (🔒 Q5/Q6): `FolderPageContents.createMember` parks the
// page and `untitledName` names it. `NewNoteSeed.folder` is still DERIVED — it is what the
// filter says — it simply has nobody left to obey it.

/** One frontmatter block carrying the seed, no body; '' for an empty seed (null values print `key:`). */
export function seedContent(properties: Record<string, unknown>): string {
  return buildFrontmatter(properties)
}

/**
 * Create the note over the bridge in ONE atomic call: `CreateFileRequest.content` (Bible B,
 * GRO-2202) keeps the `wx` never-overwrite guarantee without a create-then-write race. `body`
 * lands after the frontmatter block (template bodies, R3). Failures propagate; the caller
 * opens nothing.
 */
export async function createNewNote(path: string, properties: Record<string, unknown>, body = ''): Promise<void> {
  await api.createFile({ path, content: seedContent(properties) + body })
}
