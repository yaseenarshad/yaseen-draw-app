import { useCallback, useEffect, useRef, useState } from 'react'
import { api, BridgeRequestError } from '../api'
import { Autosave, SaveConflict, type SaveStatus } from '../lib/autosave'
import { registerRenameContinuity } from '../lib/renameContinuity'

export interface AutosaveHandle {
  status: SaveStatus
  /** Disk mtime reported by a CONFLICT / watcher while the editor had unsaved changes; null when no conflict. */
  conflictMtime: number | null
  /**
   * Start autosaving; returns the Autosave controller. `getContent` returns the file's current
   * bytes and is re-read on every flush so nothing in flight is lost.
   */
  attach: (getContent: () => string, mtime: number) => Autosave
  /** Overwrite the on-disk version with the editor content. */
  keepMine: () => void
  /** Called after the editor content was replaced from disk; `getContent` returns the reloaded bytes. */
  markReloaded: (getContent: () => string, mtime: number) => void
  /** Report an external change detected by the watcher while dirty. */
  reportConflict: (diskMtime: number) => void
}

/** Owns the Autosave controller for one open file (`path`): debounce, flush on unmount and window close. */
export function useAutosave(path: string): AutosaveHandle {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflictMtime, setConflictMtime] = useState<number | null>(null)
  const ref = useRef<{ autosave: Autosave; getContent: () => string } | null>(null)
  /**
   * `path` was renamed away under this editor (Links E1, GRO-2194): a retired controller
   * never writes again — the unmount/close flushes become no-ops, so the buffer captured by
   * `carryEditorAcrossRename` cannot ALSO resurrect the old file on unmount.
   */
  const retiredRef = useRef(false)

  const attach = useCallback(
    (getContent: () => string, mtime: number) => {
      const autosave = new Autosave({
        content: getContent(),
        mtime,
        delayMs: 500,
        save: async (content, expectedMtime) => {
          try {
            return await api.writeFile({ path, content, expectedMtime })
          } catch (err) {
            if (err instanceof BridgeRequestError && err.mtime !== undefined) throw new SaveConflict(err.mtime)
            throw err
          }
        },
        onStatus: setStatus,
        onConflict: setConflictMtime,
      })
      ref.current = { autosave, getContent }
      setStatus('saved')
      setConflictMtime(null)
      return autosave
    },
    [path],
  )

  const flushNow = useCallback(() => {
    const s = ref.current
    if (s === null || retiredRef.current) return
    // A debounced editor may still hold the latest keystrokes; pull the live content so nothing is lost.
    s.autosave.update(s.getContent())
    void s.autosave.flush()
  }, [])

  useEffect(() => {
    // The close/quit handshake (GRO-2160): main holds the window open until this settles (5s cap in main).
    const offFlush = window.yaseenDraw.window.onFlush(async () => {
      const s = ref.current
      if (s === null || retiredRef.current) return
      s.autosave.update(s.getContent())
      await s.autosave.flush()
    })
    return () => {
      offFlush()
      flushNow()
      ref.current?.autosave.dispose()
      ref.current = null
    }
  }, [flushNow])

  // The rename-continuity handle (Links E1, GRO-2194): App's flows flush/capture/retire this
  // editor by PATH — see lib/renameContinuity.ts for the whole dirty-buffer carry design.
  useEffect(
    () =>
      registerRenameContinuity(path, {
        flush: async () => {
          const s = ref.current
          if (s === null || retiredRef.current) return
          s.autosave.update(s.getContent())
          await s.autosave.flush()
        },
        capture: () => {
          const s = ref.current
          if (s === null || retiredRef.current) return null
          const body = s.getContent()
          s.autosave.update(body) // a debounced editor may still hold the latest keystrokes
          return s.autosave.dirty ? { body } : null
        },
        retire: () => {
          retiredRef.current = true
          ref.current?.autosave.dispose()
        },
      }),
    [path],
  )

  // Retired check included (GRO-2272 `B1a-`): `adopt()` writes, so a retired editor must not
  // reach it. The scope pass judged this path near-unreachable — the conflict bar has to be
  // visible on an editor whose file was just renamed away or deleted, and it is unmounting
  // anyway — but "near-unreachable" is not a guarantee, and the cost of being wrong is a
  // resurrected file. One condition is cheaper than the argument.
  const keepMine = useCallback(() => {
    const s = ref.current
    if (s === null || retiredRef.current || conflictMtime === null) return
    setConflictMtime(null)
    void s.autosave.adopt(conflictMtime)
  }, [conflictMtime])

  const markReloaded = useCallback((getContent: () => string, mtime: number) => {
    ref.current?.autosave.reset(getContent(), mtime)
    setConflictMtime(null)
  }, [])

  return { status, conflictMtime, attach, keepMine, markReloaded, reportConflict: setConflictMtime }
}
