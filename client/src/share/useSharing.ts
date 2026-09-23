import { useCallback, useEffect, useState } from 'react'
import type { ShareListEntry, ShareStatus } from '@shared/types'
import { api } from '../api'
import { errorText } from './shareText'
import { onLiveShareChange } from './liveShare'

/**
 * Settings › Sharing's data (YAZ-1799 D7), App's like Settings › Storage's: read ONLY while
 * Settings is open (`open`), so a closed dialog asks main nothing. Main's status and this vault's
 * shared boards, refetched on every `share:changed`; a local save waiting to upload (`liveShare`)
 * just re-renders, so the list's status line reads "Waiting to upload changes…" at once.
 *
 * `status` and `rows` are null until the first answer. `rows` stays null with no vault open.
 */
export interface SharingState {
  root: string | null
  status: ShareStatus | null
  rows: ShareListEntry[] | null
  /** The shared-boards list could not be read. */
  listError: string | null
  /** When the rows were last read or a local save changed — the status lines' "now". */
  now: number
  refresh: () => void
}

export function useSharing(root: string | null, open: boolean): SharingState {
  const [status, setStatus] = useState<ShareStatus | null>(null)
  const [rows, setRows] = useState<ShareListEntry[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(() => {
    api.share.status().then(setStatus, () => setStatus(null))
    if (root === null) return setRows(null)
    api.share.list(root).then(
      (list) => {
        setRows(list)
        setListError(null)
        setNow(Date.now())
      },
      (err) => {
        setRows([])
        setListError(errorText(err))
      },
    )
  }, [root])

  useEffect(() => {
    if (!open) return
    refresh()
    const offMain = api.share.onChanged(refresh)
    const offLocal = onLiveShareChange(() => setNow(Date.now()))
    return () => {
      offMain()
      offLocal()
    }
  }, [open, refresh])

  return { root, status, rows, listError, now, refresh }
}
