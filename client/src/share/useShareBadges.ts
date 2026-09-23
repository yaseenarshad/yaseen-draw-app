/**
 * The sidebar's shared-board marks (YAZ-1799): `path → { tone, title }` for every board in this
 * vault's shares.json. Red (`error`) when the last automatic update failed or the link is stale
 * (its copy is gone from Cloudflare); the title is the same status line the Share dialog shows.
 * Refreshed on every `share:changed` push and on the local upload scheduler's changes.
 */
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ShareBadge } from '../sidebar/Tree'
import { isPending, onLiveShareChange } from './liveShare'
import { liveLine } from './ShareDialog'

const EMPTY: ReadonlyMap<string, ShareBadge> = new Map()

export function useShareBadges(root: string): ReadonlyMap<string, ShareBadge> {
  const [badges, setBadges] = useState<ReadonlyMap<string, ShareBadge>>(EMPTY)
  useEffect(() => {
    // A harness (or an older preload) without the share bridge simply shows no marks.
    if (typeof window === 'undefined' || window.yaseenDraw?.share === undefined) return
    let live = true
    let seq = 0
    const refresh = async () => {
      const mine = ++seq
      try {
        const rows = await api.share.list(root)
        if (!live || mine !== seq) return
        const now = Date.now()
        const next = new Map<string, ShareBadge>()
        for (const row of rows) {
          const line = liveLine(row, isPending(row.path), now)
          const stale = row.live === 'missing' && line.tone !== 'busy'
          const access = row.allowDownload ? 'anyone with the link can view and download' : 'anyone with the link can view'
          next.set(row.path, {
            tone: line.tone === 'error' || stale ? 'error' : 'ok',
            title: stale ? `Shared — but the link is stale (its copy is gone from Cloudflare). Save the board to restore it.` : `Shared: ${access}. ${line.text}`,
          })
        }
        setBadges(next)
      } catch {
        // No marks is the honest fallback when the list cannot be read.
      }
    }
    void refresh()
    const offMain = api.share.onChanged(() => void refresh())
    const offLocal = onLiveShareChange(() => void refresh())
    return () => {
      live = false
      offMain()
      offLocal()
    }
  }, [root])
  return badges
}
