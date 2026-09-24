/**
 * The search bar's results (YAZ-803, rebuilt for the catalog in YAZ-1814): the tree the Sidebar
 * already holds, ranked per keystroke by `searchTitles`. No debounce — the scan is synchronous
 * over title-scale data.
 *
 * LAZY, AND LATCHED: the catalog is not built until the first non-empty query of this mount, and
 * is then rebuilt with every tree the watcher brings in. Lazy because a vault is opened far more
 * often than it is searched; latched because the SECOND query must not pay for the walk again.
 */
import { useMemo, useRef } from 'react'
import type { TreeNode } from '@shared/types'
import { EMPTY_CATALOG, buildBoardCatalog, searchTitles, type SearchCandidate } from './searchCandidates'

export function useSearchResults(root: string, query: string, tree: readonly TreeNode[] | null): SearchCandidate[] {
  const typed = query.trim() !== ''
  // The latch. Written during render on purpose: it only ever goes false → true, and it must be
  // true on the render that FIRST sees a query — an effect would show one empty frame of results.
  // Idempotent, so StrictMode's double render answers the same thing twice.
  const latched = useRef(false)
  const live = latched.current || typed
  latched.current = live

  const catalog = useMemo(() => (live && tree !== null ? buildBoardCatalog(root, tree) : EMPTY_CATALOG), [live, root, tree])
  // An empty query matches EVERYTHING through the shared matcher (`indexOf('')` is 0), so the
  // no-query case is answered here rather than by the ranker.
  return useMemo(() => (typed ? searchTitles(catalog, query) : []), [catalog, query, typed])
}
