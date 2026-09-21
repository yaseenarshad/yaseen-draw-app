import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeNode, TreeResponse, WatchEvent } from '@shared/types'
import { api } from '../api'
import type { WatchListener, WatchSource } from './useWatch'
import { useViewOnlyCatalog, type ViewOnlyCatalogState } from './useViewOnlyCatalog'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { tree: vi.fn() },
}))

const treeApi = vi.mocked(api.tree)
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const node = (path: string, kind: 'markdown' | 'text' | 'pdf' | 'image'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: 1, mtime: 1 })
const response = (...nodes: TreeNode[]): TreeResponse => ({ root: '/vault', tree: nodes, generatedAt: 1 })
let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []
let state: ViewOnlyCatalogState
const watch: WatchSource = {
  subscribe(listener) {
    listeners.push(listener)
    return () => { listeners = listeners.filter((candidate) => candidate !== listener) }
  },
}

function Probe() {
  state = useViewOnlyCatalog('/vault', watch)
  return null
}

function mount(): void {
  container = document.createElement('div')
  root = createRoot(container)
  act(() => root?.render(<Probe />))
}

async function flush(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

async function emit(event: WatchEvent): Promise<void> {
  await act(async () => {
    listeners.forEach((listener) => listener(event))
    await vi.advanceTimersByTimeAsync(300)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  treeApi.mockResolvedValue(response(node('/vault/data.json', 'text')))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container = null
  listeners = []
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe('useViewOnlyCatalog (YAZ-1310)', () => {
  it('loads api.tree once and exposes a ready view-only snapshot', async () => {
    mount()
    expect(state.status).toBe('pending')
    await flush()
    expect(treeApi).toHaveBeenCalledExactlyOnceWith('/vault')
    expect(state.status).toBe('ready')
    expect(state.catalog.entries.map((entry) => entry.path)).toEqual(['/vault/data.json'])
  })

  it('exposes raster images from the lightweight tree without semantic records', async () => {
    treeApi.mockResolvedValueOnce(response(node('/vault/photo.PNG', 'image')))
    mount()
    await flush()
    expect(state.catalog.entries).toEqual([{ path: '/vault/photo.PNG', name: 'photo.PNG', kind: 'image' }])
    expect(state.catalog.resolve('photo.png')).toBe('/vault/photo.PNG')
    expect(state.catalog.candidates.map((candidate) => candidate.insert)).toEqual(['photo.PNG'])
    expect('records' in state.catalog).toBe(false)
  })

  it('refreshes only for structural view-only or directory events, never content changes or Markdown/unknown files', async () => {
    mount()
    await flush()
    for (const event of [
      { type: 'change', path: '/vault/data.json', mtime: 2 },
      { type: 'change', path: '/vault/photo.png', mtime: 2 },
      { type: 'add', path: '/vault/Note.md', mtime: 2 },
      { type: 'unlink', path: '/vault/vector.svg' },
      { type: 'error', message: 'nope' },
    ] satisfies WatchEvent[]) await emit(event)
    expect(treeApi).toHaveBeenCalledTimes(1)

    treeApi.mockResolvedValueOnce(response(node('/vault/data.json', 'text'), node('/vault/cover.WEBP', 'image')))
    await emit({ type: 'add', path: '/vault/cover.WEBP', mtime: 2 })
    expect(treeApi).toHaveBeenCalledTimes(2)
    expect(state.catalog.resolve('cover.webp')).toBe('/vault/cover.WEBP')

    treeApi.mockResolvedValueOnce(response(node('/vault/data.json', 'text'), node('/vault/tool.PY', 'text')))
    await emit({ type: 'add', path: '/vault/tool.PY', mtime: 2 })
    expect(treeApi).toHaveBeenCalledTimes(3)
    expect(state.catalog.resolve('tool.py')).toBe('/vault/tool.PY')

    treeApi.mockResolvedValueOnce(response(node('/vault/data.json', 'text')))
    await emit({ type: 'unlinkDir', path: '/vault/old' })
    expect(treeApi).toHaveBeenCalledTimes(4)
  })

  it('keeps the last ready catalog when a structural refresh fails', async () => {
    mount()
    await flush()
    treeApi.mockRejectedValueOnce(new Error('offline'))
    await emit({ type: 'unlink', path: '/vault/data.json' })
    expect(state.status).toBe('error')
    expect(state.error).toBe('offline')
    expect(state.catalog.resolve('data.json')).toBe('/vault/data.json')
  })
})
