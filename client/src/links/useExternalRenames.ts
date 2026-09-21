/**
 * External rename/move resilience (Links E1c, GRO-2242 — the locked ruling): ONE detector
 * (`renameDetector.ts`), TWO feeds, ONE passive app-level confirmation banner. Feeds:
 * (a) COLD-START — the first ready index snapshot for a root triggers one `api.coldDiff(root)`
 * read of the persistent cache's reconcile diff, trusted only on `cacheStatus === 'hit'`;
 * (b) WHILE-RUNNING — consecutive `useIndex` snapshots (WikilinkIndexBridge's `onSnapshot`)
 * diffed by (size, mtime). Every hypothesis is CONFIRM-FIRST: the banner asks "Looks like X
 * became Y — update N links?" and NOTHING happens until Update is clicked — never automatic,
 * never a dialog. N is the rewrite engine's own referencing-set count (`countLinkReferences`
 * over a synthesised pre-rename snapshot); N === 0 → no banner, nothing at all.
 *
 * Queueing: hypotheses stack oldest-first, one banner at a time. Dismiss drops the hypothesis
 * for THIS SESSION (a keyed dismissed set — the next refetch will re-detect the same pair and
 * must not re-offer it). Update marks the pair handled the same way, then (1) repairs the app
 * over `api.repairRename` — main runs the E1 store repair and pushes `file:renamed`, so tabs
 * and editors follow through the EXISTING downstream — and (2) rewrites the referencing notes
 * through the E1/E1b engine against fresh index/tree snapshots re-pathed to the pre-rename
 * view, surfacing the usual summary notice.
 *
 * In-app renames echo through the watcher as the same unlink+add pair, so App forwards every
 * `file:renamed` push into `suppress` — an exact pair for files, a prefix mapping for dirs
 * (a folder rename shows up as one pair PER moved note) — and those echoes never banner.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffFileStat, IndexRecord, TreeNode } from '@shared/types'
import { api } from '../api'
import { detectRenames, diffRecords, preRenameRecords, type RenameHypothesis } from './renameDetector'
import { countLinkReferences, renameNotice, updateLinksAfterRename } from './renameLinks'

export interface RenameBannerItem {
  oldPath: string
  newPath: string
  /** The rewrite engine's referencing-note count (always > 0 — N === 0 never banners). */
  count: number
}

export interface ExternalRenames {
  /** The hypothesis on show (oldest first), or null — App renders the banner from this. */
  banner: RenameBannerItem | null
  /** Feed one READY index snapshot (WikilinkIndexBridge calls this once per snapshot). */
  onSnapshot: (records: IndexRecord[]) => void
  /** An in-app rename happened (`file:renamed`): its watcher echo must never banner. */
  suppress: (oldPath: string, newPath: string, kind: 'file' | 'dir') => void
  /** Confirm the shown hypothesis: repair the app, rewrite the links, notify. */
  update: () => void
  /** Drop the shown hypothesis for this session (never re-offered). */
  dismiss: () => void
}

const pairKey = (oldPath: string, newPath: string) => `${oldPath}\u0000${newPath}`

export function useExternalRenames(root: string | null, notify: (message: string) => void): ExternalRenames {
  const [queue, setQueue] = useState<RenameBannerItem[]>([])
  /** Session-level: handled or dismissed pairs, never offered again (keys are absolute-path pairs, so they survive root switches). */
  const dismissed = useRef(new Set<string>())
  /** In-app DIR renames (`file:renamed` kind 'dir'): each moved note echoes as its own pair — suppress by prefix mapping. */
  const dirRenames = useRef<{ oldDir: string; newDir: string }[]>([])
  /** The previous ready snapshot (the while-running diff base); null = next snapshot is the first for this root. */
  const prev = useRef<IndexRecord[] | null>(null)
  /**
   * Unmatched removals/additions carried forward exactly ONE refetch generation (GRO-2197).
   * The watcher's `awaitWriteFinish` delays `add` ~200ms while `unlink` lands at once, so the
   * index passes through a window where a rename's removal is visible and its addition is not;
   * when a refetch fires inside that window, the pair is split across two consecutive diffs and
   * `detectRenames` would never see both halves. One generation of carry re-joins them; carrying
   * only the CURRENT generation's leftovers (never re-carrying) keeps it bounded.
   */
  const carry = useRef<{ removed: DiffFileStat[]; added: DiffFileStat[] }>({ removed: [], added: [] })
  const rootRef = useRef(root)

  // A root switch invalidates the snapshot chain, every queued hypothesis (their paths belong
  // to the old vault), the split-rename carry (same reason) and the dir-rename prefix rules —
  // those were only ever meant to swallow the OLD vault's watcher echoes, and leaving them
  // would keep dead rules in the per-hypothesis linear scan forever (GRO-2197). The dismissed
  // set stays — it is session-level by ruling, keyed by absolute paths.
  useEffect(() => {
    rootRef.current = root
    prev.current = null
    carry.current = { removed: [], added: [] }
    dirRenames.current = []
    setQueue([])
  }, [root])

  const isSuppressed = useCallback(
    (h: RenameHypothesis): boolean =>
      dismissed.current.has(pairKey(h.oldPath, h.newPath)) ||
      dirRenames.current.some(({ oldDir, newDir }) => h.oldPath.startsWith(`${oldDir}/`) && h.newPath === newDir + h.oldPath.slice(oldDir.length)),
    [],
  )

  /** Vet + enqueue: suppressed and already-queued pairs drop; N is computed here, N === 0 drops. */
  const offer = useCallback(
    (hypotheses: RenameHypothesis[], records: IndexRecord[], r: string) => {
      if (hypotheses.length === 0) return
      const additions: RenameBannerItem[] = []
      for (const h of hypotheses) {
        if (isSuppressed(h)) continue
        const count = countLinkReferences({ root: r, oldPath: h.oldPath, records: preRenameRecords(records, r, h.oldPath, h.newPath) })
        if (count === 0) continue // nothing to repair → no banner, nothing at all (locked)
        additions.push({ oldPath: h.oldPath, newPath: h.newPath, count })
      }
      if (additions.length === 0) return
      setQueue((q) => {
        const fresh = additions.filter((a) => !q.some((item) => item.oldPath === a.oldPath && item.newPath === a.newPath))
        return fresh.length === 0 ? q : [...q, ...fresh]
      })
    },
    [isSuppressed],
  )

  const onSnapshot = useCallback(
    (records: IndexRecord[]) => {
      if (root === null) return
      const before = prev.current
      prev.current = records
      if (before === null) {
        // Cold-start feed: the FIRST ready snapshot for this root reads the reconcile diff once.
        api
          .coldDiff(root)
          .then((diff) => {
            if (rootRef.current !== root) return // the vault changed while the read was in flight
            if (diff === null || diff.root !== root || diff.cacheStatus !== 'hit') return // the hit gate (locked)
            offer(detectRenames(diff.removed, diff.added), records, root)
          })
          .catch(() => undefined) // no diff, no banner — never an error surface
        return
      }
      // While-running feed: consecutive snapshots, joined by (size, mtime) — with last
      // generation's unmatched halves carried in (GRO-2197, see `carry`). A carried REMOVAL
      // whose path is present again in THIS snapshot was never a rename (a save that
      // momentarily vanished behind awaitWriteFinish) and drops; a carried ADDITION whose
      // path is gone again drops likewise — reality in the new snapshot always wins.
      const { removed, added } = diffRecords(before, records)
      const paths = new Set(records.map((r) => r.path))
      const carriedRemoved = carry.current.removed.filter((f) => !paths.has(f.path))
      const carriedAdded = carry.current.added.filter((f) => paths.has(f.path))
      const hypotheses = detectRenames([...carriedRemoved, ...removed], [...carriedAdded, ...added])
      offer(hypotheses, records, root)
      // Carry ONLY this generation's unmatched entries forward (never the already-carried
      // ones): exactly one generation of second chance, bounded memory.
      const matched = new Set(hypotheses.flatMap((h) => [h.oldPath, h.newPath]))
      carry.current = {
        removed: removed.filter((f) => !matched.has(f.path)),
        added: added.filter((f) => !matched.has(f.path)),
      }
    },
    [root, offer],
  )

  const suppress = useCallback(
    (oldPath: string, newPath: string, kind: 'file' | 'dir') => {
      if (kind === 'dir') dirRenames.current.push({ oldDir: oldPath, newDir: newPath })
      else dismissed.current.add(pairKey(oldPath, newPath))
      // An echo that raced its way into the queue drops too — confirmed in-app renames never banner.
      setQueue((q) => q.filter((item) => !isSuppressed({ oldPath: item.oldPath, newPath: item.newPath })))
    },
    [isSuppressed],
  )

  const dismiss = useCallback(() => {
    setQueue((q) => {
      const item = q[0]
      if (item === undefined) return q
      dismissed.current.add(pairKey(item.oldPath, item.newPath))
      return q.slice(1)
    })
  }, [])

  const update = useCallback(() => {
    const item = queue[0]
    const r = root
    if (item === undefined || r === null) return
    dismissed.current.add(pairKey(item.oldPath, item.newPath)) // handled: the next diff must not re-offer it
    setQueue((q) => (q[0] === item ? q.slice(1) : q.filter((x) => x !== item)))
    void (async () => {
      // (1) Repair the app: main validates the hypothesis (new path exists, old does not),
      // runs the E1 store repair and pushes file:renamed — tabs/editors follow downstream.
      try {
        await api.repairRename({ oldPath: item.oldPath, newPath: item.newPath })
      } catch (err) {
        // Stale hypothesis (the old path came back, the new one vanished, …): passive notice, never a dialog.
        notify(`Can't update links: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      // (2) Rewrite the referencing notes through the E1/E1b engine, against FRESH snapshots
      // re-pathed to the pre-rename view (the engine's referencing set needs the index as it was).
      let records: IndexRecord[] = []
      try {
        records = (await api.index(r)).records
      } catch {
        records = [] // no index snapshot → the repair stands, links stay as they are
      }
      const summary = await updateLinksAfterRename({
        root: r,
        oldPath: item.oldPath,
        newPath: item.newPath,
        kind: 'file', // the detector only pairs markdown FILES
        records: preRenameRecords(records, r, item.oldPath, item.newPath),
      })
      // The user explicitly asked — always answer (unlike the in-app flow's silent no-op case).
      notify(renameNotice(summary))
    })()
  }, [queue, root, notify])

  return { banner: queue[0] ?? null, onSnapshot, suppress, update, dismiss }
}
