/**
 * The CMD+F channel (YAZ-968): the one object the find bar and the find engine share.
 *
 * `drawingFeed.ts`'s host-created holder idiom, given something to hold. The host makes ONE per
 * editor mount and hands it to `createCrepe` (the engine binds itself at view creation, unbinds on
 * destroy) and to the bar (YAZ-969), which subscribes and calls the commands. The channel owns only
 * what the bar reads — open / query / total / activeIndex — and forwards every command to the bound
 * engine; while unbound (no editor yet, or one already destroyed) the commands are no-ops.
 *
 * `close()` keeps the query so the next CMD+F can offer it again, but the engine has dropped its
 * matches by then — which is why the counter goes back to 0 / −1 and reopening re-runs the search.
 */

export interface FindSnapshot {
  open: boolean
  /** The typed query; kept across a close so the bar can reopen on it. */
  query: string
  total: number
  /** Index of the active match, −1 when there are none. */
  activeIndex: number
}

/** What every engine command answers with; the channel copies it straight into the snapshot. */
export interface FindResult {
  total: number
  activeIndex: number
}

/** The engine behind the commands: the find plugin binds one per editor view. */
export interface FindController {
  search(query: string): FindResult
  /** One match forward (1) or back (−1), wrapping at both ends. */
  step(delta: 1 | -1): FindResult
  /** Land on the active match: restore the search's folds, clear the highlights, focus the doc. */
  close(): void
}

export interface FindChannel {
  open(): void
  close(): void
  setQuery(query: string): void
  next(): void
  prev(): void
  getState(): FindSnapshot
  subscribe(listener: () => void): () => void
  /** Engine side: bind at view creation, call the returned unbind on destroy. */
  bind(controller: FindController): () => void
  /** Engine side: the live count after a change the bar did not ask for — an edit to the document. */
  sync(result: FindResult): void
}

const NO_MATCHES: FindResult = { total: 0, activeIndex: -1 }

export function createFindChannel(): FindChannel {
  let controller: FindController | null = null
  let snapshot: FindSnapshot = { open: false, query: '', ...NO_MATCHES }
  const listeners = new Set<() => void>()

  const set = (next: FindSnapshot): void => {
    if (
      next.open === snapshot.open &&
      next.query === snapshot.query &&
      next.total === snapshot.total &&
      next.activeIndex === snapshot.activeIndex
    )
      return
    snapshot = next
    listeners.forEach((listener) => listener())
  }
  const setQuery = (query: string): void => {
    if (!snapshot.open) return
    set({ open: true, query, ...(controller?.search(query) ?? NO_MATCHES) })
  }
  const step = (delta: 1 | -1): void => {
    if (!snapshot.open) return
    set({ ...snapshot, ...(controller?.step(delta) ?? NO_MATCHES) })
  }

  return {
    open() {
      if (snapshot.open) return
      set({ ...snapshot, open: true })
      if (snapshot.query !== '') setQuery(snapshot.query)
    },
    close() {
      if (!snapshot.open) return
      // Closed first, then landed: the bar is gone before the engine takes the focus back, and the
      // engine's own transactions no longer reach `sync`.
      set({ ...snapshot, open: false, ...NO_MATCHES })
      controller?.close()
    },
    setQuery,
    next: () => step(1),
    prev: () => step(-1),
    sync(result) {
      if (snapshot.open) set({ ...snapshot, ...result })
    },
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    bind(next) {
      controller = next
      return () => {
        if (controller === next) controller = null
      }
    },
  }
}
