import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShrinkResult, VaultStorageStats } from '@shared/types'
import { api } from '../api'
import { dirtyPaths } from '../lib/renameContinuity'

/**
 * Settings › Storage's data (YAZ-1801 D1): one `storage.stats(root)` per reason to believe the
 * numbers moved — the root changed, the page opened (it calls `refresh`), a sync pass finished (a
 * commit grows the history), or a shrink ran. Opening Settings itself is NOT one: the page's own
 * open is, and both at once measured twice. Stats walk the whole vault and parse every board, so
 * they are NOT refreshed on every watcher event; the page is a report you open, not a live gauge.
 *
 * `refresh` is coalesced: while a measure runs, any number of triggers queue ONE more after it.
 *
 * `stats` is null while the first answer is in flight (the page shows "Measuring…"), and keeps
 * the last answer while a refresh runs so the page does not flash empty. A failed read keeps the
 * last answer too: a size report is not worth an error state.
 *
 * `shrink` passes THIS window's dirty tabs as the skip list (`dirtyPaths`), keeps the result as
 * `lastShrink` for the page's result line, and refreshes the numbers after.
 */
export interface VaultStorageState {
  stats: VaultStorageStats | null
  refresh: () => void
  shrink: () => Promise<ShrinkResult>
  /** The last shrink's answer on this root — the page's result line, kept after the group's numbers drop to zero. */
  lastShrink: ShrinkResult | null
}

export function useVaultStorage(root: string | null, syncState: string | null): VaultStorageState {
  const [stats, setStats] = useState<VaultStorageStats | null>(null)
  const [lastShrink, setLastShrink] = useState<ShrinkResult | null>(null)
  /** Bumped per root, so a measure of the previous root can neither land nor chain. */
  const generation = useRef(0)
  const inFlight = useRef(false)
  const rerun = useRef(false)

  // COALESCED: a trigger while a measure runs (the root's first measure and a sync pass finishing,
  // say) marks ONE re-run after it — never a second walk of the vault alongside the first.
  const refresh = useCallback(() => {
    if (root === null) return
    if (inFlight.current) {
      rerun.current = true
      return
    }
    const gen = generation.current
    const measure = () => {
      inFlight.current = true
      api.storage
        .stats(root)
        .then(
          (res) => {
            if (gen === generation.current) setStats(res)
          },
          () => undefined,
        )
        .finally(() => {
          if (gen !== generation.current) return
          inFlight.current = false
          if (rerun.current) {
            rerun.current = false
            measure()
          }
        })
    }
    measure()
  }, [root])

  // A new root starts from nothing; its first numbers are fetched at once.
  useEffect(() => {
    setStats(null)
    setLastShrink(null)
    inFlight.current = false
    rerun.current = false
    refresh()
    return () => {
      generation.current++
    }
  }, [refresh])

  // Every FINISHED pass (synced / attention / off) may have moved the git numbers. `syncing` is a
  // pass in flight (measured after, not mid-commit) and `pending` is an edit burst waiting out
  // its debounce — nothing in `.git` moved yet, and re-walking a heavy vault on every first
  // keystroke would be the wrong trade.
  useEffect(() => {
    if (syncState === 'synced' || syncState === 'attention' || syncState === 'off') refresh()
  }, [syncState, refresh])

  const shrink = useCallback(async (): Promise<ShrinkResult> => {
    if (root === null) return { shrunk: 0, skipped: 0, bytesMoved: 0 }
    try {
      const result = await api.storage.shrink(root, dirtyPaths())
      setLastShrink(result)
      return result
    } finally {
      refresh()
    }
  }, [root, refresh])

  return { stats, refresh, shrink, lastShrink }
}
