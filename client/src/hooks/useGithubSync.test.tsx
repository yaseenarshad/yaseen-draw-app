/**
 * `useGithubSync` (YAZ-1081 3A): one `github.status(root)` fetch per root, live-replaced by
 * `github:status` broadcasts for that root.
 * Public surface is exactly `{ status, syncNow, setEnabled }`. The bridge (`api.github`) is
 * mocked; the onStatus listeners are captured so tests can push broadcasts.
 *
 * The load-bearing claim: the ENGINE owns every state, including its failures. A rejected call
 * sets nothing and leaves the last status standing, because the engine broadcasts its own
 * `attention` — a chip must never invent one from a bridge hiccup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GithubSyncStatus } from '@shared/types'
import { useGithubSync, type GithubSyncState } from './useGithubSync'

let listeners: Array<(s: GithubSyncStatus) => void> = []
const offSpy = vi.fn()

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    github: {
      status: vi.fn(),
      syncNow: vi.fn(),
      setEnabled: vi.fn(),
      onStatus: vi.fn((l: (s: GithubSyncStatus) => void) => {
        listeners.push(l)
        return offSpy
      }),
    },
  },
}))

import { api } from '../api'

const statusFn = vi.mocked(api.github.status)
const syncNowFn = vi.mocked(api.github.syncNow)
const setEnabledFn = vi.mocked(api.github.setEnabled)


const status = (root: string, extra: Partial<GithubSyncStatus> = {}): GithubSyncStatus => ({ root, state: 'off', ...extra })

let root: Root | null = null
let container: HTMLElement | null = null
let state: GithubSyncState

function Probe({ vaultRoot }: { vaultRoot: string | null }) {
  state = useGithubSync(vaultRoot)
  return null
}

function mount(vaultRoot: string | null = '/vault'): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

function rerender(vaultRoot: string | null): void {
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

/** Lets the mocked promises resolve and React commit. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function broadcast(s: GithubSyncStatus): void {
  act(() => listeners.forEach((l) => l(s)))
}

beforeEach(() => {
  statusFn.mockResolvedValue(status('/vault'))
  syncNowFn.mockResolvedValue(status('/vault', { state: 'synced' }))
  setEnabledFn.mockResolvedValue(status('/vault', { state: 'synced' }))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  vi.clearAllMocks()
})

describe('useGithubSync', () => {
  it('is null on mount, then carries the fetched status — a vault with sync off is `off`, never null', async () => {
    mount()
    expect(state.status).toBeNull()
    await flush()
    expect(statusFn).toHaveBeenCalledWith('/vault')
    expect(state.status).toEqual({ root: '/vault', state: 'off' })
  })

  it('makes no bridge call at all for a null root', async () => {
    mount(null)
    await flush()
    expect(statusFn).not.toHaveBeenCalled()
    expect(state.status).toBeNull()
    state.syncNow()
    state.setEnabled(true)
    expect(syncNowFn).not.toHaveBeenCalled()
    expect(setEnabledFn).not.toHaveBeenCalled()
  })

  it('a broadcast for this root replaces the status live; other roots are ignored', async () => {
    mount()
    await flush()
    broadcast(status('/elsewhere', { state: 'attention', attention: 'auth' }))
    expect(state.status?.state).toBe('off')
    broadcast(status('/vault', { state: 'syncing' }))
    expect(state.status?.state).toBe('syncing')
  })

  it('a broadcast landing before a slow initial fetch wins over it', async () => {
    let resolve!: (s: GithubSyncStatus) => void
    statusFn.mockReturnValue(new Promise<GithubSyncStatus>((r) => (resolve = r)))
    mount()
    broadcast(status('/vault', { state: 'synced' }))
    expect(state.status?.state).toBe('synced')
    resolve(status('/vault', { state: 'off' })) // the stale fetch must not overwrite it
    await flush()
    expect(state.status?.state).toBe('synced')
  })

  it('a failed fetch keeps the last status rather than inventing one — the engine owns attention', async () => {
    mount()
    await flush()
    broadcast(status('/vault', { state: 'synced' }))
    statusFn.mockRejectedValue(new Error('bridge gone'))
    syncNowFn.mockRejectedValue(new Error('bridge gone'))
    state.syncNow()
    await flush()
    expect(state.status?.state).toBe('synced')
  })

  it('syncNow calls the bridge for this root and commits the resolved status', async () => {
    mount()
    await flush()
    syncNowFn.mockResolvedValue(status('/vault', { state: 'syncing' }))
    act(() => state.syncNow())
    await flush()
    expect(syncNowFn).toHaveBeenCalledWith('/vault')
    expect(state.status?.state).toBe('syncing')
  })

  it('setEnabled passes the boolean through and commits the outcome the engine answers with', async () => {
    mount()
    await flush()
    setEnabledFn.mockResolvedValue(status('/vault', { state: 'attention', attention: 'no-identity' }))
    act(() => state.setEnabled(true))
    await flush()
    expect(setEnabledFn).toHaveBeenCalledWith('/vault', true)
    expect(state.status?.attention).toBe('no-identity')

    setEnabledFn.mockResolvedValue(status('/vault', { state: 'off' }))
    act(() => state.setEnabled(false))
    await flush()
    expect(setEnabledFn).toHaveBeenLastCalledWith('/vault', false)
    expect(state.status?.state).toBe('off')
  })

  it("a broadcast that beats a mutation's own resolution is not overwritten by it", async () => {
    mount()
    await flush()
    let resolve!: (s: GithubSyncStatus) => void
    syncNowFn.mockReturnValue(new Promise<GithubSyncStatus>((r) => (resolve = r)))
    act(() => state.syncNow())
    broadcast(status('/vault', { state: 'attention', attention: 'conflict' }))
    resolve(status('/vault', { state: 'syncing' })) // stale by the time it lands
    await flush()
    expect(state.status?.attention).toBe('conflict')
  })

  it('a root change resets to null and fetches the new root', async () => {
    mount('/vault')
    await flush()
    statusFn.mockResolvedValue(status('/other', { state: 'pending' }))
    rerender('/other')
    expect(state.status).toBeNull()
    await flush()
    expect(statusFn).toHaveBeenLastCalledWith('/other')
    expect(state.status?.state).toBe('pending')
  })

  it('unmount unsubscribes from onStatus', async () => {
    mount()
    await flush()
    act(() => root?.unmount())
    root = null
    expect(offSpy).toHaveBeenCalled()
  })
})
