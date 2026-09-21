/**
 * External rename/move detection (Links E1c, GRO-2242 — the locked ruling): ONE hypothesis
 * detector, TWO feeds. (a) Cold-start: the persistent index cache's reconcile diff
 * (`api.coldDiff`, trustworthy only when `cacheStatus === 'hit'` — `removed` carries CACHED
 * stats, `added` on-disk stats). (b) While-running: consecutive index snapshots —
 * `diffRecords` turns a refetch pair into the same removed/added shape. Either feed produces
 * PASSIVE hypotheses only — NEVER an automatic rewrite: the app-level banner
 * (`useExternalRenames`) asks first, always.
 *
 * Guard rails, firm (the GRO-2242 ruling):
 *  - markdown files only (both feeds are markdown-only already; pinned here anyway);
 *  - join key = EXACT (size, mtime) equality — macOS rename/move preserves both;
 *  - zero-byte files skip (size 0 matches every empty file);
 *  - only UNAMBIGUOUS 1:1 pairs: a (size, mtime) signature carried by several removed or
 *    several added files skips entirely — no guessing;
 *  - equal basenames (a pure move) are still a valid hypothesis: pathed links may need
 *    rewriting (the E1b engine already handles bare-stays / pathed-rewrites).
 */
import { fileKind } from '@shared/fileKind'
import type { DiffFileStat, IndexRecord } from '@shared/types'
import { basename, stripExt } from '../lib/paths'

/** One detected external rename/move: `oldPath` vanished while `newPath` appeared, stats equal. */
export interface RenameHypothesis {
  oldPath: string
  newPath: string
}

const sig = (f: DiffFileStat) => `${f.size}\u0000${f.mtime}`

/** Markdown, non-empty — the only files a hypothesis may involve. */
const eligible = (f: DiffFileStat) => f.size > 0 && fileKind(f.path) === 'markdown'

function bySignature(list: readonly DiffFileStat[]): Map<string, DiffFileStat[]> {
  const out = new Map<string, DiffFileStat[]>()
  for (const f of list) {
    if (!eligible(f)) continue
    const k = sig(f)
    const bucket = out.get(k)
    if (bucket === undefined) out.set(k, [f])
    else bucket.push(f)
  }
  return out
}

/** The ONE detector both feeds go through; sorted by oldPath for a deterministic queue order. */
export function detectRenames(removed: readonly DiffFileStat[], added: readonly DiffFileStat[]): RenameHypothesis[] {
  const removedBySig = bySignature(removed)
  const addedBySig = bySignature(added)
  const out: RenameHypothesis[] = []
  for (const [k, olds] of removedBySig) {
    const news = addedBySig.get(k)
    if (news === undefined) continue
    if (olds.length !== 1 || news.length !== 1) continue // ambiguous signature: skip entirely
    out.push({ oldPath: olds[0].path, newPath: news[0].path })
  }
  return out.sort((a, b) => (a.oldPath < b.oldPath ? -1 : a.oldPath > b.oldPath ? 1 : 0))
}

/**
 * The while-running feed: one `useIndex` refetch pair reshaped into the cold diff's
 * removed/added form — `removed` carries the PREVIOUS snapshot's stats (the last-known
 * identity, the cold diff's "cached" role) and `added` the new snapshot's on-disk stats.
 */
export function diffRecords(prev: readonly IndexRecord[], next: readonly IndexRecord[]): { removed: DiffFileStat[]; added: DiffFileStat[] } {
  const prevPaths = new Set(prev.map((r) => r.path))
  const nextPaths = new Set(next.map((r) => r.path))
  const toStat = ({ path, size, mtime }: IndexRecord): DiffFileStat => ({ path, size, mtime })
  return {
    removed: prev.filter((r) => !nextPaths.has(r.path)).map(toStat),
    added: next.filter((r) => !prevPaths.has(r.path)).map(toStat),
  }
}

/**
 * The rewrite engine wants PRE-rename snapshots ("the referencing set must be computed against
 * the index as it was" — renameLinks.ts), but an EXTERNAL rename is only ever detected after
 * the index healed: the current snapshot already holds the NEW path. This synthesises the
 * pre-rename view by re-pathing the moved record back to the old path (path/name/basename/
 * folder recomputed; links/embeds untouched — a rename never changes content), the exact
 * inverse of the engine's own post-move mapping. A stale/bogus hypothesis — no record at
 * `newPath`, or one already living at `oldPath` — returns the input unchanged (the reference
 * count then lands on 0 and nothing is offered).
 */
export function preRenameRecords(records: readonly IndexRecord[], root: string, oldPath: string, newPath: string): IndexRecord[] {
  if (records.some((r) => r.path === oldPath) || !records.some((r) => r.path === newPath)) return [...records]
  const oldName = basename(oldPath)
  const oldRel = oldPath.startsWith(`${root}/`) ? oldPath.slice(root.length + 1) : oldPath
  const folder = oldRel.includes('/') ? oldRel.slice(0, oldRel.lastIndexOf('/')) : ''
  return records.map((r) => (r.path === newPath ? { ...r, path: oldPath, name: oldName, basename: stripExt(oldName), folder } : r))
}
