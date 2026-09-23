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

describe('useVaultStorage — one measure at a time', () => {
  it('triggers while a measure runs queue exactly one re-run after it', async () => {
    root = createRoot(document.createElement('div'))
    render('/v', null)
    expect(statsFn).toHaveBeenCalledOnce()
    // A pass finishes, another starts and finishes, and the page opens — all mid-measure.
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

  it("a root change measures the new root at once and drops the old root's answer and re-run", async () => {
    root = createRoot(document.createElement('div'))
    render('/a', null)
    state.refresh()
    render('/b', null)
    expect(statsFn.mock.calls).toEqual([['/a'], ['/b']])

    await answer(0, measured('/a', 1))
    expect(state.stats).toBeNull()
    expect(statsFn).toHaveBeenCalledTimes(2)
    await answer(1, measured('/b', 1))
    expect(state.stats).toEqual(measured('/b', 1))
    expect(statsFn).toHaveBeenCalledTimes(2)
  })
})
