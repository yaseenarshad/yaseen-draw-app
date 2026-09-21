/**
 * `useIndex` (GRO-2129): one `api.index(root)` fetch per root, debounced refetch on watch
 * events that can change the index (markdown add/change/unlink, unlinkDir, ready). The
 * bridge is mocked; the watcher is a fake `WatchSource` whose subscribers are captured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, IndexResponse, WatchEvent } from '@shared/types'
import type { WatchListener, WatchSource } from '../hooks/useWatch'
import { useIndex, type IndexState } from './useIndex'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { index: vi.fn() },
}))

import { api } from '../api'

const indexFn = vi.mocked(api.index)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (path: string): IndexRecord => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  folder: '',
  ext: 'md',
  size: 1,
  ctime: 1,
  mtime: 1,
  properties: {},
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
})

const response = (root: string, ...paths: string[]): IndexResponse => ({
  root,
  records: paths.map(rec),
  generatedAt: 1,
})

let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []
let state: IndexState

const watch: WatchSource = {
  subscribe: (l) => {
    listeners.push(l)
    return () => {
      listeners = listeners.filter((x) => x !== l)
    }
  },
}

function Probe({ vaultRoot }: { vaultRoot: string }) {
  state = useIndex(vaultRoot, watch)
  return null
}

function mount(vaultRoot = '/vault'): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

function rerender(vaultRoot: string): void {
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

/** Lets the mocked fetch promise resolve and React commit. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function emit(ev: WatchEvent): Promise<void> {
  await act(async () => {
    listeners.forEach((l) => l(ev))
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function pastDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  indexFn.mockResolvedValue(response('/vault', '/vault/a.md', '/vault/b.md'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useIndex', () => {
  it('is pending on mount, then ready with the fetched records', async () => {
    mount()
    expect(state.status).toBe('pending')
    expect(state.records).toEqual([])
    await flush()
    expect(indexFn).toHaveBeenCalledWith('/vault')
    expect(state.status).toBe('ready')
    expect(state.records.map((r) => r.path)).toEqual(['/vault/a.md', '/vault/b.md'])
    expect(state.error).toBeNull()
  })

  it('a failed fetch becomes status error with the message', async () => {
    indexFn.mockRejectedValue(new Error('bridge gone'))
    mount()
    await flush()
    expect(state.status).toBe('error')
    expect(state.error).toBe('bridge gone')
    expect(state.records).toEqual([])
  })

  it('markdown add/change/unlink events collapse into one debounced refetch', async () => {
    mount()
    await flush()
    indexFn.mockResolvedValue(response('/vault', '/vault/a.md', '/vault/b.md', '/vault/c.md'))
    await emit({ type: 'add', path: '/vault/c.md', mtime: 2 })
    await emit({ type: 'change', path: '/vault/a.md', mtime: 2 })
    await emit({ type: 'unlink', path: '/vault/b.md' })
    expect(indexFn).toHaveBeenCalledTimes(1) // still only the mount fetch
    await pastDebounce()
    expect(indexFn).toHaveBeenCalledTimes(2)
    expect(state.records.map((r) => r.path)).toEqual(['/vault/a.md', '/vault/b.md', '/vault/c.md'])
    expect(state.status).toBe('ready')
  })

  it('ignores events for non-markdown paths', async () => {
    mount()
    await flush()
    await emit({ type: 'change', path: '/vault/topics.txt', mtime: 2 })
    await emit({ type: 'add', path: '/vault/cover.png', mtime: 2 })
    await emit({ type: 'addDir', path: '/vault/new-dir' })
    await pastDebounce()
    expect(indexFn).toHaveBeenCalledTimes(1)
  })

  it('unlinkDir and ready refetch (a removed dir may have held notes; ready = missed events)', async () => {
    mount()
    await flush()
    await emit({ type: 'unlinkDir', path: '/vault/old' })
    await pastDebounce()
    expect(indexFn).toHaveBeenCalledTimes(2)
    await emit({ type: 'ready', root: '/vault' })
    await pastDebounce()
    expect(indexFn).toHaveBeenCalledTimes(3)
  })

  it('refresh() refetches immediately', async () => {
    mount()
    await flush()
    indexFn.mockResolvedValue(response('/vault', '/vault/z.md'))
    await act(async () => {
      state.refresh()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(indexFn).toHaveBeenCalledTimes(2)
    expect(state.records.map((r) => r.path)).toEqual(['/vault/z.md'])
  })

  it('a root change resets to pending and fetches the new root', async () => {
    mount('/vault')
    await flush()
    indexFn.mockResolvedValue(response('/other', '/other/x.md'))
    rerender('/other')
    expect(state.status).toBe('pending')
    expect(state.records).toEqual([])
    await flush()
    expect(indexFn).toHaveBeenLastCalledWith('/other')
    expect(state.records.map((r) => r.path)).toEqual(['/other/x.md'])
  })

  it('unmount cancels a pending debounced refetch', async () => {
    mount()
    await flush()
    await emit({ type: 'change', path: '/vault/a.md', mtime: 2 })
    act(() => root?.unmount())
    root = null
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(indexFn).toHaveBeenCalledTimes(1)
  })
})
