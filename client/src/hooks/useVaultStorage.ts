import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShrinkResult, VaultStorageStats } from '@shared/types'
import { api } from '../api'
import { dirtyPaths } from '../lib/renameContinuity'

/**
 * Settings › Storage's data (YAZ-1801 D1, 🔒 D13): measured ONLY while Settings is open — the page
 * is a report you open, not a live gauge, and a measure walks the whole vault and parses every
 * board. So the triggers are: the page opening (it calls `refresh`), a sync pass FINISHING while
 * Settings is open (App passes `settingsOpen ? syncState : null`, so a closed dialog sees null),
 * and a shrink. A vault change clears the numbers and measures nothing by itself.
 *
 * `refresh` is coalesced: while a measure runs, any number of triggers queue ONE more after it.
 *
 * `stats` is null until the first answer (the page shows "Measuring…"), and keeps the last answer
 * while a refresh runs so the page does not flash empty. A failed measure keeps the last answer
 * too; with none, `failed` is true and the page says so — the next refresh (page open) retries.
 *
 * `shrink` passes THIS window's dirty tabs as the skip list (`dirtyPaths`), keeps the result as
 * `lastShrink` for the page's result line, and refreshes the numbers after.
 */
export interface VaultStorageState {
  stats: VaultStorageStats | null
  /** The last measure failed and there is no earlier answer to show. */
  failed: boolean
  refresh: () => void
  shrink: () => Promise<ShrinkResult>
  /** The last shrink's answer on this root — the page's result line, kept after the group's numbers drop to zero. */
  lastShrink: ShrinkResult | null
}

export function useVaultStorage(root: string | null, syncState: string | null): VaultStorageState {
  const [stats, setStats] = useState<VaultStorageStats | null>(null)
  const [failed, setFailed] = useState(false)
  const [lastShrink, setLastShrink] = useState<ShrinkResult | null>(null)
  /** Bumped per root, so a measure of the previous root can neither land nor chain. */
  const generation = useRef(0)
  const inFlight = useRef(false)
  const rerun = useRef(false)

  // COALESCED: a trigger while a measure runs (the page opening and a sync pass finishing, say)
  // marks ONE re-run after it — never a second walk of the vault alongside the first.
  const refresh = useCallback(() => {
    if (root === null) return
    if (inFlight.current) {
      rerun.current = true
      return
    }
    const gen = generation.current
    const measure = () => {
      inFlight.current = true
      setFailed(false)
      api.storage
        .stats(root)
        .then(
          (res) => {
            if (gen === generation.current) setStats(res)
          },
          () => {
            if (gen === generation.current) setFailed(true)
          },
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

  // A new root starts from nothing — and measures nothing until the page asks (D13).
  useEffect(() => {
    setStats(null)
    setFailed(false)
    setLastShrink(null)
    inFlight.current = false
    rerun.current = false
    return () => {
      generation.current++
    }
  }, [root])

  // A pass that FINISHED (was `syncing`, now synced / attention / off) may have moved the git
  // numbers. Only a transition out of `syncing` counts: Settings opening turns null into the
  // current state, which is not a pass, and the page's own open already measures.
  const previous = useRef(syncState)
  useEffect(() => {
    const was = previous.current
    previous.current = syncState
    if (was === 'syncing' && (syncState === 'synced' || syncState === 'attention' || syncState === 'off')) refresh()
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

  return { stats, failed: failed && stats === null, refresh, shrink, lastShrink }
}
