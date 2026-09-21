/**
 * Automatic link updates after an in-app rename (Links E1 GRO-2194 + E1b GRO-2241 —
 * decision E, GRO-2096: Obsidian's default, no prompt). Runs CLIENT-SIDE in the ORIGINATING
 * window, AFTER the rename succeeded, over PRE-rename snapshots (post-rename, the old name
 * no longer resolves, so the referencing set must be computed against the index/tree as
 * they were).
 *
 * Referencing set: records whose `links` or `embeds` resolve to the moved path, through THE
 * shared resolver (`resolverFor`, the one behind views and wikilink decorations). For a
 * FOLDER (`kind: 'dir'`) the
 * moved set is everything under the old prefix. Per file: `fs:read` → rewrite → `fs:write`
 * with `expectedMtime`; a CONFLICT re-reads once and retries, a second conflict skips the
 * file (someone is actively writing it — their unsaved changes win over our link fix; the
 * link shows as unresolved until fixed by hand).
 *
 * Body rewriting is a string-level scan with the shared regex semantics: only matches whose
 * `linkPageName` resolves to the old path are touched; fenced code blocks and inline code
 * spans are skipped via a LENGTH-PRESERVING mirror of the index's `stripCode` discipline
 * (`maskCode` — same fence/span rules, offsets intact so the splice edits the original
 * bytes). `|alias` and `#heading`/`#^block` suffixes are preserved; the link FORM is too:
 * a bare `[[B]]` becomes the new bare name, a pathed `[[Sub/B]]` the new root-relative path,
 * and an explicit `.md` extension stays explicit. `![[embeds]]` get the same treatment.
 * Frontmatter follows the index's link extraction: whole-value exact `[[…]]` strings only
 * (top-level and inside lists), rewritten through `setFrontmatterProperty` so everything
 * else in the block survives byte-for-byte.
 *
 * ONE key is walked deeper than that (YAZ-864): `folder_page_settings`, the single reserved key
 * with app-defined link semantics (Q1, YAZ-815). Its `views[].order` entries and
 * `columns.<name>.target` strings ARE links the index never extracted, so a folder-page rename
 * used to leave them dangling; they now rewrite exactly as a top-level entry does, through the
 * same `resolves` / `newTarget` pair, so their spelling rules cannot drift from anyone else's.
 * The key's own module owns both the key name and the list of link-bearing leaves
 * (`views/folderPageSettings.ts` `mapFolderPageSettingsLinks`) — this engine never re-parses it.
 * The referencing-set probe learned the same leaves, because a page whose ONLY reference lives
 * in there has no `links` entry to be found by: one construction, never two truths.
 *
 * E1b's bare-vs-pathed rules, LOCKED (decision E thread):
 *  - FOLDER rename: bare-name links keep resolving (names unchanged) — they stay
 *    BYTE-IDENTICAL; only PATHED targets rewrite, to the new root-relative path.
 *  - FILE move (and rename): a bare link stays bare only when the bare form still resolves
 *    to the moved file AFTERWARDS — decided through the resolver against a POST-move record
 *    set (the shallowest rule may hand the name to a duplicate); otherwise it escalates to
 *    the pathed form. A kept bare form is never spliced, so padding survives too.
 *  - ALIAS-form links (E2, GRO-2214): `[[CAC]]` pointing at a note through its frontmatter
 *    `aliases` is NEVER rewritten — the alias travels with the file, so it still resolves
 *    afterwards. The referencing-set probe therefore resolves BY NAME ONLY (`makeResolves`).
 */
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { isViewOnly } from '@shared/fileKind'
import type { IndexRecord } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { resolverFor } from '../views/engine'
import { folderPageSettingsLinks, mapFolderPageSettingsLinks } from '../views/folderPageSettings'
import { WIKILINK_RE } from '../editor/wikilink/wikilinkPlugin'
import { flushRenamedPath } from '../lib/renameContinuity'
import { basename, stripExt } from '../lib/paths'
import { buildViewOnlyCatalogFromEntries, type ViewOnlyCatalog } from './viewOnlyCatalog'

/** Does this raw link target point at the renamed file? (Wired to THE shared resolver.) */
export type ResolvesToOld = (target: string) => boolean

/** Raw target text → its replacement (form-preserving; see `renamedTarget`). */
export type NewTarget = (target: string) => string

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const CODE_SPAN_RE = /(`+)[\s\S]*?\1/g

/**
 * The index's `stripCode` (desktop/src/main/vaultIndex/scan.ts) mirrored LENGTH-PRESERVING:
 * every character inside a fenced block (``` / ~~~, fence lines included) or an inline code
 * span becomes a space, so match offsets over the mask address the original body directly.
 */
export function maskCode(body: string): string {
  const lines = body.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i])
    if (fence === null) {
      if (m) fence = m[1]
    } else if (m && m[1][0] === fence[0] && m[1].length >= fence.length && lines[i].trim() === m[1]) {
      fence = null
    }
    if (fence !== null || m) lines[i] = ' '.repeat(lines[i].length)
  }
  return lines.join('\n').replace(CODE_SPAN_RE, (span) => ' '.repeat(span.length))
}

/**
 * `[[inner]]` → the rewritten inner, or null when this match is not the renamed file.
 * The target part (before the first `#` or `|`) is replaced; `#heading`/`#^block` and
 * `|alias` ride along untouched. Surrounding whitespace inside the target is dropped
 * (`[[ B ]]` → `[[C]]`), matching how the resolver reads it anyway — EXCEPT when the
 * target text would not change at all (E1b: a bare link kept across a move), where the
 * match is left untouched so the link stays byte-identical, padding included.
 */
export function rewriteInner(inner: string, resolves: ResolvesToOld, newTarget: NewTarget): string | null {
  const pipe = inner.indexOf('|')
  const head = pipe >= 0 ? inner.slice(0, pipe) : inner
  const alias = pipe >= 0 ? inner.slice(pipe) : ''
  const hash = head.indexOf('#')
  const target = (hash >= 0 ? head.slice(0, hash) : head).trim()
  const suffix = hash >= 0 ? head.slice(hash) : ''
  if (target === '' || !resolves(target)) return null
  const next = newTarget(target)
  if (next === target) return null
  return next + suffix + alias
}

/**
 * Form preservation for one matched target: bare stays bare (the new basename), pathed
 * stays pathed (the new ROOT-RELATIVE path), and an explicit vault extension stays explicit.
 * `newName` is the new file name WITH extension; `newRel` the new root-relative path WITH it.
 */
export function renamedTarget(target: string, opts: { newName: string; newRel: string }): string {
  const withExt = target.includes('/') ? opts.newRel : opts.newName
  return /\.(md|markdown)$/i.test(target) ? withExt : stripExt(withExt)
}

/** Body `[[links]]` and `![[embeds]]` outside code, spliced in place; the input when nothing matched. */
export function rewriteBodyLinks(body: string, resolves: ResolvesToOld, newTarget: NewTarget): string {
  const masked = maskCode(body)
  let out = ''
  let last = 0
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const replaced = rewriteInner(m[2], resolves, newTarget)
    if (replaced === null) continue
    const innerStart = m.index + m[1].length + 2 // after `[[` / `![[`
    out += body.slice(last, innerStart) + replaced
    last = innerStart + m[2].length
  }
  return out + body.slice(last)
}

const EXACT_WIKILINK_RE = /^\[\[([^[\]]+)\]\]$/

/** A frontmatter string that is exactly `[[…]]` → its rewrite, else undefined. */
function rewriteExactLink(value: string, resolves: ResolvesToOld, newTarget: NewTarget): string | undefined {
  const m = EXACT_WIKILINK_RE.exec(value.trim())
  if (m === null) return undefined
  const inner = rewriteInner(m[1], resolves, newTarget)
  return inner === null ? undefined : `[[${inner}]]`
}

/**
 * The same string's TARGET (`|alias` / `#heading` stripped), or null — what `rewriteInner`
 * decides on, exposed for the probe. The probe asks `resolves`, not "would this be rewritten":
 * a bare link that stays bare still makes its note part of the referencing set, exactly as a
 * top-level `links` entry does.
 */
function exactLinkTarget(value: string): string | null {
  const m = EXACT_WIKILINK_RE.exec(value.trim())
  if (m === null) return null
  const target = m[1].split('|')[0].split('#')[0].trim()
  return target === '' ? null : target
}

/**
 * One note's full rewrite: body scan + frontmatter whole-value links (through
 * `setFrontmatterProperty`, one key at a time) + the ONE reserved key's nested links
 * (YAZ-864 — see the module doc). Null when nothing changed — the caller never writes an
 * unchanged file, so a page carrying settings that reference nobody stays byte-identical.
 */
export function rewriteNoteLinks(content: string, resolves: ResolvesToOld, newTarget: NewTarget): string | null {
  const { frontmatter, body } = splitFrontmatter(content)
  let out = frontmatter + rewriteBodyLinks(body, resolves, newTarget)
  if (frontmatter !== '') {
    const { properties, error } = parseFrontmatter(frontmatter)
    if (error === undefined) {
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === 'string') {
          const next = rewriteExactLink(value, resolves, newTarget)
          if (next !== undefined) out = setFrontmatterProperty(out, key, next)
        } else if (Array.isArray(value)) {
          let changed = false
          const next = value.map((item) => {
            const r = typeof item === 'string' ? rewriteExactLink(item, resolves, newTarget) : undefined
            if (r !== undefined) changed = true
            return r ?? (item as unknown)
          })
          if (changed) out = setFrontmatterProperty(out, key, next)
        }
      }
      // The nested leaves go back as the WHOLE key — the one door's own write shape
      // (`writeFolderPageSettings`), so nothing about that block is serialised two ways.
      const settings = mapFolderPageSettingsLinks(properties, (link) => rewriteExactLink(link, resolves, newTarget))
      if (settings !== null) out = setFrontmatterProperty(out, settings.key, settings.value)
    }
  }
  return out === content ? null : out
}

/** Does this note reference the renamed file AT ALL — index links/embeds, or a nested settings leaf? */
function makeReferences(resolves: ResolvesToOld): (record: IndexRecord) => boolean {
  return (record) =>
    [...record.links, ...record.embeds].some(resolves) ||
    folderPageSettingsLinks(record.properties).some((link) => {
      const target = exactLinkTarget(link)
      return target !== null && resolves(target)
    })
}

export interface RenameRewriteSummary {
  /** Files whose links were rewritten on disk. */
  updated: number
  /** Files left alone after a repeated write conflict (or an unreadable/unwritable file). */
  skipped: number
}

/** The ONE passive summary notice — shown only when the rename touched (or spared) anything. */
export function renameNotice({ updated, skipped }: RenameRewriteSummary): string {
  const head = `Updated links in ${updated} note${updated === 1 ? '' : 's'}`
  return skipped > 0 ? `${head}; ${skipped} skipped (unsaved changes)` : head
}

export interface UpdateLinksOptions {
  root: string
  oldPath: string
  newPath: string
  /** `dir` for a folder rename/move (E1b, GRO-2241): everything under `oldPath/` moved. Defaults to `file`. */
  kind?: 'file' | 'dir'
  /** The PRE-rename index snapshot (fetched before `fs:rename` — see the module doc). */
  records: readonly IndexRecord[]
  /** Separate PRE-rename text/PDF catalog; these targets never enter `records`. */
  viewOnlyCatalog?: ViewOnlyCatalog | null
}

/**
 * The referencing-set predicate shared by the rewrite and the E1c dry-run count — ONE
 * construction, so both agree on WHICH notes reference the old path.
 *
 * They do NOT always agree on how many get WRITTEN, and the F- audit (GRO-2197) pinned the gap
 * honestly rather than papering over it: `countLinkReferences` counts every note whose links
 * RESOLVE to the old path, while `rewriteInner` writes nothing for a bare link that stays bare
 * (it returns null). In a pure MOVE — which `renameDetector.ts` deliberately admits as a valid
 * hypothesis — every bare link stays bare, so the banner can offer "update N links?" and the
 * summary then read "Updated links in 0 notes". Closing that needs N to become form-aware
 * (share `newTarget`, not just `resolves`), which is a behaviour change, not a finishing-pass
 * fix — deferred with the rest of the E1c queue work.
 */
function makeResolves({ root, oldPath, kind, records, viewOnlyCatalog }: { root: string; oldPath: string; kind: 'file' | 'dir'; records: readonly IndexRecord[]; viewOnlyCatalog?: ViewOnlyCatalog | null }): {
  resolves: ResolvesToOld
  resolveTargetPath: (t: string) => string | null
} {
  // NAME-ONLY resolution (E2, GRO-2214): an alias-form link (`[[CAC]]`) does resolve to the
  // moved file through the shared resolver, but it must stay BYTE-IDENTICAL — the alias lives
  // in that file's own frontmatter and travels with it, so it keeps pointing there. Building
  // the probe without the alias map keeps the dry-run count and the rewrite agreeing on that.
  const resolver = resolverFor(records, root, { aliases: false })
  const prefix = `${oldPath}/`
  const isMoved = kind === 'dir' ? (p: string) => p.startsWith(prefix) : (p: string) => p === oldPath
  const targetPaths = new Map<string, string | null>()
  const resolveTargetPath = (t: string): string | null => {
    const hit = targetPaths.get(t)
    if (hit !== undefined) return hit
    // An explicit recognized non-Markdown extension belongs exclusively to the lightweight
    // catalog. It must never acquire a semantic record/resolver fallback on a miss.
    const resolved = isViewOnly(t) ? viewOnlyCatalog?.resolve(t) ?? null : resolver(t)?.record.path ?? null
    targetPaths.set(t, resolved)
    return resolved
  }
  const resolves: ResolvesToOld = (target) => {
    // LOCKED (E1b): across a FOLDER rename, bare-name links keep resolving (names are
    // unchanged) and stay byte-identical — only PATHED targets rewrite in dir mode.
    if (kind === 'dir' && !target.includes('/')) return false
    const hit = resolveTargetPath(target)
    return hit !== null && isMoved(hit)
  }
  return { resolves, resolveTargetPath }
}

/**
 * DRY-RUN (E1c, GRO-2242): how many notes the rewrite WOULD touch — the exact referencing-set
 * filter `updateLinksAfterRename` runs (records whose `links`/`embeds` resolve to the moved
 * path through the same shared-resolver `resolves`), with no reads and no writes. This is the
 * banner's N; N === 0 → no banner, nothing happens at all (the locked ruling). For an external
 * rename pass a PRE-rename snapshot (`preRenameRecords` synthesises one).
 */
export function countLinkReferences({ root, oldPath, kind = 'file', records, viewOnlyCatalog }: { root: string; oldPath: string; kind?: 'file' | 'dir'; records: readonly IndexRecord[]; viewOnlyCatalog?: ViewOnlyCatalog | null }): number {
  const { resolves } = makeResolves({ root, oldPath, kind, records, viewOnlyCatalog })
  return records.filter(makeReferences(resolves)).length
}

/** Rewrite every referencing note on disk; see the module doc for the whole discipline. */
export async function updateLinksAfterRename({ root, oldPath, newPath, kind = 'file', records, viewOnlyCatalog }: UpdateLinksOptions): Promise<RenameRewriteSummary> {
  const prefix = `${oldPath}/`
  const mapMoved = kind === 'dir' ? (p: string) => (p.startsWith(prefix) ? newPath + p.slice(oldPath.length) : p) : (p: string) => (p === oldPath ? newPath : p)
  const relOf = (p: string) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)
  const { resolves, resolveTargetPath } = makeResolves({ root, oldPath, kind, records, viewOnlyCatalog })
  // File mode: whether a bare form still wins AFTER the move is decided by RESOLUTION, not
  // text — the post-move record set (the moved record re-pathed) answers it (shallowest rule).
  const newName = basename(newPath)
  const newRel = relOf(newPath)
  const postRecords =
    kind === 'file'
      ? records.map((r) =>
          r.path === oldPath
            ? { ...r, path: newPath, name: newName, basename: stripExt(newName), folder: newRel.includes('/') ? newRel.slice(0, newRel.lastIndexOf('/')) : '' }
            : r,
        )
      : records
  const postResolver = resolverFor(postRecords, root)
  const postViewOnlyCatalog = viewOnlyCatalog === null || viewOnlyCatalog === undefined
    ? null
    : buildViewOnlyCatalogFromEntries(root, viewOnlyCatalog.entries.map((entry) => {
        const path = mapMoved(entry.path)
        return path === entry.path ? entry : { ...entry, path, name: basename(path) }
      }))
  const newTarget: NewTarget = (target) => {
    const moved = mapMoved(resolveTargetPath(target) as string) // non-null: `resolves` vetted this target
    const movedName = basename(moved)
    const movedRel = relOf(moved)
    if (isViewOnly(target)) {
      // Keep the old form discipline: pathed remains pathed; bare remains bare only while the
      // post-move catalog still awards that basename to this file, otherwise disambiguate.
      if (target.includes('/')) return movedRel
      return postViewOnlyCatalog?.resolve(movedName) === moved ? movedName : movedRel
    }
    if (!target.includes('/')) {
      // Bare form (file mode only — dir mode filtered bare targets out above): keep it only
      // when the bare name still resolves to the moved file post-move; otherwise escalate
      // to the pathed form.
      const stillBare = postResolver(stripExt(movedName))?.record.path === moved
      if (!stillBare) return /\.(md|markdown)$/i.test(target) ? movedRel : stripExt(movedRel)
    }
    return renamedTarget(target, { newName: movedName, newRel: movedRel })
  }
  const references = makeReferences(resolves)
  const summary: RenameRewriteSummary = { updated: 0, skipped: 0 }
  for (const record of records) {
    if (!references(record)) continue
    // A self-link travels with the file: a moved note is read/written at its NEW path
    // (for a dir, every record under the old prefix relocated).
    const filePath = mapMoved(record.path)
    try {
      // An own-window dirty editor of the referencing note flushes FIRST, so the read below
      // sees its buffer and our write does not race it (the editor then auto-reloads clean).
      await flushRenamedPath(filePath)
      let file = await api.readFile(filePath)
      for (let attempt = 0; ; attempt++) {
        const next = rewriteNoteLinks(file.content, resolves, newTarget)
        if (next === null) break
        try {
          await api.writeFile({ path: filePath, content: next, expectedMtime: file.mtime })
          summary.updated++
          break
        } catch (err) {
          if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT' || attempt > 0) throw err
          file = await api.readFile(filePath) // raced another writer: re-read once, retry
        }
      }
    } catch {
      summary.skipped++
    }
  }
  return summary
}
