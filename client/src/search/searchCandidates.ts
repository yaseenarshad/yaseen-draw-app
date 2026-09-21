/**
 * Title search candidates (YAZ-802): the rows the search box matches a query against, ranked by
 * the ONE matcher (`search/matchCandidates.ts`). 🔒 D3 on YAZ-739: the query matches the file's
 * NAME only — `folder` rides along as the row's display label and is never matched. Amended by
 * 🔒 D2 on YAZ-1491: a file STILL never matches on its folder; the folder itself is one row,
 * matched by its own name through the same matcher, in the same flat list. Both feeds are the
 * tree the Sidebar already holds (🔒 D1) — no second read of the vault.
 */
import type { TreeNode } from '@shared/types'
import { stripExt } from '../lib/paths'
import { matchCandidates } from './matchCandidates'

/** One search row: what the query matches, what it reads as, what activating it targets. */
export interface SearchCandidate {
  /** What activating the row does (🔒 D3, YAZ-1491): a `dir` row REVEALS itself in Files; a `file` row OPENS. */
  kind: 'file' | 'dir'
  /** The text the query matches: the file's name (a drawing without its extension) or the folder's name. */
  name: string
  /** `name.toLowerCase()`, precomputed so the ranking scan (GRO-2197) allocates nothing per keystroke. */
  lower: string
  /** Row text — the same name. */
  label: string
  /** Absolute path — the open (or reveal) action's target. */
  path: string
  /** Root-relative folder for the row's secondary label ('' at the vault root). */
  folder: string
}

/** Result cap for title search — a scrollable result list, not the `[[` picker's MAX_SUGGESTIONS popup. */
export const SEARCH_CAP = 50

/**
 * One row per FILE in the loaded tree, in tree order — the same feed the folder rows come from
 * (🔒 D1, YAZ-1491), so search costs no second read of the vault. A drawing matches and reads
 * under its name without the extension, exactly as the tree and the tab strip spell it.
 */
export function searchCandidates(root: string, files: readonly TreeNode[]): SearchCandidate[] {
  const prefix = `${root.replace(/\/+$/, '')}/`
  return files.map((file) => {
    const rel = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path
    const cut = rel.lastIndexOf('/')
    const name = stripExt(file.name)
    return { kind: 'file', name, lower: name.toLowerCase(), label: name, path: file.path, folder: cut === -1 ? '' : rel.slice(0, cut) }
  })
}

/**
 * One row per folder in the loaded tree (🔒 D1, YAZ-1491): matched by its own name, labelled by
 * its parent. `dirs` are ABSOLUTE paths in tree order (`allDirs`, treeState.ts), so a folder's
 * row sits above its children's — and, spliced ahead of `searchCandidates`, above any note that
 * ties with it in a rank bucket. `folder` is root-relative, `/` separated, `''` directly under
 * the root.
 */
export function folderCandidates(root: string, dirs: readonly string[]): SearchCandidate[] {
  const prefix = `${root.replace(/\/+$/, '')}/`
  return dirs.map((dir) => {
    const rel = dir.startsWith(prefix) ? dir.slice(prefix.length) : dir
    const cut = rel.lastIndexOf('/')
    const name = rel.slice(cut + 1)
    return { kind: 'dir', name, lower: name.toLowerCase(), label: name, path: dir, folder: cut === -1 ? '' : rel.slice(0, cut) }
  })
}

/** Rows matching `query`, ranked exact → prefix → substring by the shared matcher, capped at SEARCH_CAP. */
export function searchTitles(candidates: readonly SearchCandidate[], query: string): SearchCandidate[] {
  return matchCandidates(candidates, query, SEARCH_CAP)
}
