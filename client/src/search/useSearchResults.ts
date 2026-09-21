/**
 * The search bar's results (YAZ-803): one index snapshot per root, kept current by the watcher,
 * ranked per keystroke by `searchTitles`. No debounce — the ranking scan is synchronous over
 * title-scale data (guarded by `searchCandidates.perf.test.ts`). Since YAZ-1491 the list also
 * carries the tree's FOLDERS (🔒 D1): `dirs` is the Sidebar's own `allDirs` memo — no second
 * feed, no extra read — spliced in FIRST so a folder sits above a note it ties with (tree order:
 * dirs before files).
 *
 * The feed is LAZY (F1 finding 1, YAZ-808). The ALWAYS-ON per-window index feed is
 * WikilinkIndexBridge's; search must not duplicate it in every window for a bar nobody typed
 * into, so it pays for its data only once someone searches.
 */
import { useEffect, useMemo, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { api } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { folderCandidates, searchCandidates, searchTitles, type SearchCandidate } from './searchCandidates'

export function useSearchResults(root: string, watch: WatchSource, query: string, dirs: readonly string[]): SearchCandidate[] {
  const [records, setRecords] = useState<readonly IndexRecord[]>([])
  // Latched by the first non-empty query and never unlatched: after that the snapshot stays warm
  // and watch-fresh for the rest of this component's life, so clearing the bar and typing again
  // costs nothing. Until then there is no fetch and no subscription at all.
  const [activated, setActivated] = useState(false)
  useEffect(() => {
    if (query.trim() !== '') setActivated(true)
  }, [query])

  useEffect(() => {
    if (!activated) return
    let cancelled = false
    const load = () => {
      // An unreadable index leaves search with no rows — quietly. Search is an accelerator, not a
      // view: a banner here would shout about something the tree below is already showing fine.
      api.index(root).then(
        (res) => {
          if (!cancelled) setRecords(res.records)
        },
        () => undefined,
      )
    }
    load()
    // Refresh on structural changes; `ready` also fires on every watch (re)subscription, covering missed events.
    const off = watch.subscribe((ev) => {
      if (ev.type !== 'change' && ev.type !== 'error') load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [root, watch, activated])

  const folderRows = useMemo(() => folderCandidates(root, dirs), [root, dirs])
  const noteRows = useMemo(() => searchCandidates(records), [records])
  const candidates = useMemo(() => [...folderRows, ...noteRows], [folderRows, noteRows])
  // An empty query matches EVERYTHING through the shared matcher (`indexOf('')` is 0), so the
  // no-query case is answered here rather than by the ranker.
  return useMemo(() => (query.trim() === '' ? [] : searchTitles(candidates, query)), [candidates, query])
}
