import type { SidebarLens } from '@shared/types'
import { basename } from '../lib/paths'

/** One tab-menu gesture, pinned to the lens selected when the user invoked it. */
export interface SidebarRevealRequest {
  id: number
  path: string
  lens: SidebarLens
}

export const SIDEBAR_REVEAL_MS = 3000

export const revealMissingMessage = (path: string, lens: SidebarLens): string =>
  `Can't show "${basename(path)}" in ${lens === 'favorites' ? 'Favorites' : 'Files'} — it is no longer there`

/** Flash every visible occurrence of `path`; the caller owns replacement/unmount cleanup. */
export function flashTreeRows(host: ParentNode, path: string): (() => void) | null {
  const rows = [...host.querySelectorAll<HTMLElement>('.tree__row[data-path]')]
    .filter((row) => row.dataset.path === path)
  if (rows.length === 0) return null

  for (const row of rows) row.classList.add('tree__row--revealed')
  rows[0]?.scrollIntoView?.({ block: 'nearest' })
  const clear = () => rows.forEach((row) => row.classList.remove('tree__row--revealed'))
  const timer = setTimeout(clear, SIDEBAR_REVEAL_MS)
  return () => {
    clearTimeout(timer)
    clear()
  }
}
