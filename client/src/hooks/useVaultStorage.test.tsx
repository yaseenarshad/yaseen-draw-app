/**
 * `useVaultStorage` (YAZ-1801): measures are COALESCED — a trigger while one runs (the root's own
 * first measure and a sync pass finishing, say) queues ONE re-run after it, never a second walk
 * alongside it; and a root change starts its own measure at once, ignoring the old root's answer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { VaultStorageStats } from '@shared/types'
import { useVaultStorage, type VaultStorageState } from './useVaultStorage'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { storage: { stats: vi.fn(), shrink: vi.fn() } },
}))

import { api } from '../api'

const statsFn = vi.mocked(api.storage.stats)

/** Each call's answer, resolved by hand. */
const answers: Array<(s: VaultStorageStats) => void> = []
statsFn.mockImplementation(() => new Promise((resolve) => answers.push(resolve)))
const measured = (root: string, count: number) => ({ root, boards: { bytes: 0, count } }) as VaultStorageStats

let root: Root | null = null
let state: VaultStorageState

function Probe({ vault, sync }: { vault: string; sync: string | null }) {
  state = useVaultStorage(vault, sync)
  return null
}
const render = (vault: string, sync: string | null) => act(() => root?.render(<Probe vault={vault} sync={sync} />))
const answer = (i: number, s: VaultStorageStats) => act(async () => answers[i](s))

afterEach(() => {
  act(() => root?.unmount())
  root = null
  answers.length = 0
  statsFn.mockClear()
})

describe('useVaultStorage — one measure at a time, only when asked (🔒 D13)', () => {
  it('a vault opening measures nothing by itself; the page asking does', () => {
    root = createRoot(document.createElement('div'))
    render('/v', null)
    expect(statsFn).not.toHaveBeenCalled()
    state.refresh()
    expect(statsFn).toHaveBeenCalledOnce()
  })

  it('triggers while a measure runs queue exactly one re-run after it', async () => {
    root = createRoot(document.createElement('div'))
    render('/v', 'synced')
    state.refresh()
    expect(statsFn).toHaveBeenCalledOnce()
    // A pass runs and finishes, another does, and the page asks again — all mid-measure.
    render('/v', 'syncing')
    render('/v', 'synced')
    render('/v', 'syncing')
    render('/v', 'attention')
    state.refresh()
    expect(statsFn).toHaveBeenCalledOnce()

    await answer(0, measured('/v', 1))
    expect(state.stats).toEqual(measured('/v', 1))
    expect(statsFn).toHaveBeenCalledTimes(2)
    await answer(1, measured('/v', 2))
    expect(state.stats).toEqual(measured('/v', 2))
    expect(statsFn).toHaveBeenCalledTimes(2)
  })

  it('only a pass FINISHING measures: Settings opening (null → synced) and a pass starting do not', async () => {
    root = createRoot(document.createElement('div'))
    render('/v', null)
    render('/v', 'synced')
    render('/v', 'pending')
    render('/v', 'syncing')
    expect(statsFn).not.toHaveBeenCalled()
    render('/v', 'synced')
    expect(statsFn).toHaveBeenCalledOnce()
  })

  it("a root change clears the numbers and the shrink result, measures nothing, and drops the old root's answer", async () => {
    root = createRoot(document.createElement('div'))
    render('/a', null)
    state.refresh()
    await answer(0, measured('/a', 1))
    vi.mocked(api.storage.shrink).mockResolvedValueOnce({ shrunk: 1, skipped: 0, bytesMoved: 5 })
    await act(async () => void (await state.shrink()))
    expect(state.lastShrink).toEqual({ shrunk: 1, skipped: 0, bytesMoved: 5 })
    expect(statsFn).toHaveBeenCalledTimes(2) // the shrink's own refresh, still in flight

    render('/b', null)
    expect(state.stats).toBeNull()
    expect(state.lastShrink).toBeNull()
    await answer(1, measured('/a', 2))
    expect(state.stats).toBeNull()
    expect(statsFn).toHaveBeenCalledTimes(2)
  })

  it('a failed first measure is `failed` (not measuring forever); the next refresh retries', async () => {
    root = createRoot(document.createElement('div'))
    render('/v', null)
    statsFn.mockImplementationOnce(() => Promise.reject(new Error('worker gone')))
    state.refresh()
    await act(async () => undefined)
    expect(state).toMatchObject({ stats: null, failed: true })
    state.refresh()
    await answer(0, measured('/v', 1))
    expect(state).toMatchObject({ stats: measured('/v', 1), failed: false })
  })
})
