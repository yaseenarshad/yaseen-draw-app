/**
 * The sidebar's shared-board marks (YAZ-1799 D14, YAZ-1890): `path → { tone, title }` for every
 * board in this vault's shares.json. The title is the Share dialog's own status line; red
 * (`error`) when the last automatic update failed or the link is stale (its copy is gone from
 * Cloudflare). A rename or move re-keys the record in main, whose `share:changed` refetches here.
 *
 * The list is fetched on mount and on `share:changed`, WITHOUT the live check (`check: false`), so a
 * save costs no network call per share; only Settings asks the Worker. The local upload
 * scheduler's changes (a save waiting to upload) just re-derive.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ShareListEntry } from '@shared/types'
import { api } from '../api'
import type { ShareBadge } from '../sidebar/Tree'
import { isPending, onLiveShareChange } from './liveShare'
import { liveLine } from './ShareDialog'

export function useShareBadges(root: string): ReadonlyMap<string, ShareBadge> {
  const [rows, setRows] = useState<readonly ShareListEntry[]>([])
  const [localTick, setLocalTick] = useState(0)
  useEffect(() => {
    setRows([])
    // A harness (or an older preload) without the share bridge simply shows no marks.
    if (typeof window === 'undefined' || window.yaseenDraw?.share === undefined) return
    let live = true
    let seq = 0
    const refresh = async () => {
      const mine = ++seq
      try {
        const next = await api.share.list(root, false)
        if (live && mine === seq) setRows(next)
      } catch {
        // No marks is the honest fallback when the list cannot be read.
      }
    }
    void refresh()
    const offMain = api.share.onChanged(() => void refresh())
    const offLocal = onLiveShareChange(() => setLocalTick((t) => t + 1))
    return () => {
      live = false
      offMain()
      offLocal()
    }
  }, [root])

  return useMemo(() => {
    const now = Date.now()
    const badges = new Map<string, ShareBadge>()
    for (const row of rows) {
      const line = liveLine(row, isPending(row.path), now)
      // No "· 5 minutes ago" on a tooltip nothing re-renders; the dialog carries the time.
      badges.set(row.path, { tone: line.tone === 'error' ? 'error' : 'ok', title: `Shared · ${line.tone === 'ok' ? 'Up to date' : line.text}` })
    }
    return badges
  }, [rows, localTick])
}
