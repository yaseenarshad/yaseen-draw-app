/**
 * The ⌘K CATALOG (YAZ-1814): the flat list of rows the search box matches a query against, ranked
 * by the ONE matcher (`search/matchCandidates.ts`).
 *
 * There is no index any more — the markdown vault index went with the markdown layer (YAZ-1808) —
 * so the catalog is derived from the tree the Sidebar already holds, which IS `fs:tree` and is
 * kept fresh by the structural watcher (the docs-app `viewOnlyCatalog` pattern: one cheap walk of
 * a tree somebody else is already refreshing, never a second read of the vault).
 *
 * What is in it (🔒 2H, YAZ-1814):
 * - one row per `.excalidraw` FILE, named the way the tree and the tab strip spell it — without
 *   the extension — carrying its absolute path and its root-relative folder as the row's label;
 * - one row per FOLDER, matched by its own name (🔒 D2, YAZ-1491), labelled by ITS parent.
 * A file never matches on its folder (🔒 D3, YAZ-739): the folder is its own row instead.
 *
 * What is NOT in it: a file of no supported kind (a `.png` dropped in the vault lists in the tree
 * and opens in the OS app, but it is not a document this app can search for), and the image store
 * `assets/` — which is already absent from `fs:tree` (🔒 D3, YAZ-1775), so the catalog inherits
 * that rule rather than re-deciding it. A folder the user called `assets` inside a subfolder is
 * theirs, shows in the tree, and is searchable, exactly as the tree rule says.
 */
import type { TreeNode } from '@shared/types'
import { isDrawing } from '@shared/fileKind'
import { stripExt } from '../lib/paths'
import { matchCandidates } from './matchCandidates'

/** One search row: what the query matches, what it reads as, what activating it targets. */
export interface SearchCandidate {
  /** What activating the row does (🔒 D3, YAZ-1491): a `dir` row REVEALS itself in Files; a `file` row OPENS. */
  kind: 'file' | 'dir'
  /** The text the query matches: the drawing's name without its extension, or the folder's name. */
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

/** Result cap for title search — a scrollable result list, not the 8-row popup `MAX_SUGGESTIONS` serves. */
export const SEARCH_CAP = 50

/** The empty catalog, shared — the lazy feed hands this back until the first query (`useSearchResults`). */
export const EMPTY_CATALOG: readonly SearchCandidate[] = []

/** One row, its `folder` read off the path relative to `prefix` (the root with exactly one trailing slash). */
function row(kind: SearchCandidate['kind'], prefix: string, path: string, name: string): SearchCandidate {
  const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path
  const cut = rel.lastIndexOf('/')
  return { kind, name, lower: name.toLowerCase(), label: name, path, folder: cut === -1 ? '' : rel.slice(0, cut) }
}

/**
 * The whole catalog in ONE walk of the tree: every folder (outer before inner, tree order) ahead of
 * every drawing (tree order). Folders lead so that a folder sits above a drawing it ties with in a
 * rank bucket — the reveal is the cheaper mistake (🔒 D1, YAZ-1491).
 */
export function buildDrawingCatalog(root: string, tree: readonly TreeNode[]): SearchCandidate[] {
  const prefix = `${root.replace(/\/+$/, '')}/`
  const folders: SearchCandidate[] = []
  const drawings: SearchCandidate[] = []
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'dir') {
        folders.push(row('dir', prefix, node.path, node.name))
        walk(node.children)
      } else if (isDrawing(node.name)) {
        drawings.push(row('file', prefix, node.path, stripExt(node.name)))
      }
    }
  }
  walk(tree)
  return [...folders, ...drawings]
}

/** Rows matching `query`, ranked exact → prefix → substring by the shared matcher, capped at SEARCH_CAP. */
export function searchTitles(candidates: readonly SearchCandidate[], query: string): SearchCandidate[] {
  return matchCandidates(candidates, query, SEARCH_CAP)
}
