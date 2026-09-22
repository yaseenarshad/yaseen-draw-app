import { useCallback, useEffect, useRef, useState } from 'react'
import type { GithubSyncStatus } from '@shared/types'
import { api } from '../api'

/**
 * Per-vault GitHub sync as the UI sees it (YAZ-1081 3A): one `github.status(root)` fetch per
 * root, live-replaced by `github:status` broadcasts for that root: one bridge object per root,
 * pushed on every transition. App owns ONE of these, and both the chip and the settings section
 * read it.
 *
 * The engine is the source of truth for every state INCLUDING its failures: `syncNow` and
 * `setEnabled` answer with the same status the push carries, so a rejected call sets nothing
 * and the last known status stands. Nothing here throws at the caller — a chip is not a place
 * to surface a bridge error, and an engine that hit a real problem says so as `attention`.
 */

export interface GithubSyncState {
  /** null until the first fetch resolves; a vault with sync off is `state: 'off'`, never null. */
  status: GithubSyncStatus | null
  /** Fire-and-forget manual pass (the chip's click); the status push updates the UI. */
  syncNow: () => void
  /** The per-vault switch (D4); same fire-and-forget posture as `syncNow`. */
  setEnabled: (enabled: boolean) => void
}

/**
 * `root` is nullable because App owns ONE of these and hooks
 * cannot be conditional, so a window with no vault open must make no bridge call at all. A null
 * root has a null status and inert actions.
 */
export function useGithubSync(root: string | null): GithubSyncState {
  const [status, setStatus] = useState<GithubSyncStatus | null>(null)
  // Bumped on unmount/root change AND on every broadcast: only a still-fresh call may commit.
  const generation = useRef(0)

  useEffect(() => {
    const gen = ++generation.current
    setStatus(null)
    if (root === null) return
    api.github.status(root).then(
      (res) => {
        if (gen !== generation.current) return
        setStatus(res)
      },
      () => {
        // Keep the last status (none, on a first fetch): the engine broadcasts its own
        // attention states, so a failed read is not something to invent a state for.
      },
    )
    const unsubscribe = api.github.onStatus((res) => {
      if (res.root !== root) return
      generation.current++ // a broadcast is always fresher than any in-flight call
      setStatus(res)
    })
    return () => {
      generation.current++
      unsubscribe()
    }
  }, [root])

  // The resolved status of a mutation commits too, guarded the same way. The broadcast usually
  // beats it; both land on the same object, so whichever arrives second is a no-op re-render.
  const commit = useCallback((gen: number, res: GithubSyncStatus) => {
    if (gen !== generation.current) return
    setStatus(res)
  }, [])

  const syncNow = useCallback(() => {
    if (root === null) return
    const gen = generation.current
    api.github.syncNow(root).then(
      (res) => commit(gen, res),
      () => undefined,
    )
  }, [root, commit])

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (root === null) return
      const gen = generation.current
      api.github.setEnabled(root, enabled).then(
        (res) => commit(gen, res),
        () => undefined,
      )
    },
    [root, commit],
  )

  return { status, syncNow, setEnabled }
}
