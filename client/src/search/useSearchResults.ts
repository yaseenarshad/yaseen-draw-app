/**
 * The search bar's results (YAZ-803): the tree the Sidebar already holds, ranked per keystroke by
 * `searchTitles`. No debounce — the ranking scan is synchronous over title-scale data. Since
 * YAZ-1491 the list carries the tree's FOLDERS as well as its files (🔒 D1): one feed, no extra
 * read, folders spliced in FIRST so a folder sits above a file it ties with (tree order).
 */
import { useMemo } from 'react'
import type { TreeNode } from '@shared/types'
import { folderCandidates, searchCandidates, searchTitles, type SearchCandidate } from './searchCandidates'

export function useSearchResults(root: string, query: string, dirs: readonly string[], files: readonly TreeNode[]): SearchCandidate[] {
  const folderRows = useMemo(() => folderCandidates(root, dirs), [root, dirs])
  const fileRows = useMemo(() => searchCandidates(root, files), [root, files])
  const candidates = useMemo(() => [...folderRows, ...fileRows], [folderRows, fileRows])
  // An empty query matches EVERYTHING through the shared matcher (`indexOf('')` is 0), so the
  // no-query case is answered here rather than by the ranker.
  return useMemo(() => (query.trim() === '' ? [] : searchTitles(candidates, query)), [candidates, query])
}
