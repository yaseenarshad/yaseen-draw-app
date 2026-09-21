import { useCallback, useEffect, useRef, useState } from 'react'
import { isViewOnly } from '@shared/fileKind'
import type { WatchEvent } from '@shared/types'
import { api } from '../api'
import { buildViewOnlyCatalog, type ViewOnlyCatalog } from '../links/viewOnlyCatalog'
import type { WatchSource } from './useWatch'

export interface ViewOnlyCatalogState {
  status: 'pending' | 'ready' | 'error'
  catalog: ViewOnlyCatalog
  error: string | null
}

const REFRESH_DEBOUNCE_MS = 300

function touchesCatalog(event: WatchEvent): boolean {
  switch (event.type) {
    case 'ready':
    case 'addDir':
    case 'unlinkDir':
      return true
    case 'add':
    case 'unlink':
      return isViewOnly(event.path)
    default:
      return false
  }
}

/** Lightweight tree-derived view-only snapshot; no content or semantic index is read. */
export function useViewOnlyCatalog(root: string, watch: WatchSource): ViewOnlyCatalogState {
  const [state, setState] = useState<ViewOnlyCatalogState>(() => ({ status: 'pending', catalog: buildViewOnlyCatalog(root, []), error: null }))
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refresh = useCallback(() => {
    const current = ++generation.current
    api.tree(root).then(
      (response) => {
        if (current !== generation.current) return
        setState({ status: 'ready', catalog: buildViewOnlyCatalog(root, response.tree), error: null })
      },
      (error: unknown) => {
        if (current !== generation.current) return
        setState((previous) => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : String(error) }))
      },
    )
  }, [root])
  useEffect(() => {
    setState({ status: 'pending', catalog: buildViewOnlyCatalog(root, []), error: null })
    refresh()
    const unsubscribe = watch.subscribe((event) => {
      if (!touchesCatalog(event)) return
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        refresh()
      }, REFRESH_DEBOUNCE_MS)
    })
    return () => {
      generation.current++
      unsubscribe()
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }
  }, [root, watch, refresh])
  return state
}
