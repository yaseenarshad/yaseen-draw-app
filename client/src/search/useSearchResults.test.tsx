/**
 * The search bar's index feed (YAZ-803): one `api.index` read per root, refetched on the same
 * structural watch events the sidebar tree refreshes on, ranked per keystroke. The failure case
 * matters most — search degrades to "no rows", never to an error surface.
 *
 * Since F1 finding 1 (YAZ-808) the feed is LAZY: an untouched bar reads no index and subscribes
 * to nothing — the always-on feed is WikilinkIndexBridge's — and the first non-empty query
 * latches it on for good. Both halves are asserted here, subscription included.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, WatchEvent } from '@shared/types'
import type { WatchSource } from '../hooks/useWatch'
import { useSearchResults } from './useSearchResults'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (basename: string, folder = ''): IndexRecord => ({
  path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`,
  name: `${basename}.md`,
  basename,
  folder,
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

function installBridge(records: IndexRecord[]) {
  const bridge = { index: vi.fn(async (root: string) => ({ root, records, generatedAt: 1 })) }
  Object.defineProperty(window, 'yaseenDraw', { value: bridge, configurable: true, writable: true })
  return bridge
}

let reactRoot: Root | null = null
let container: HTMLElement | null = null
/** The rendered rows' labels — the hook's whole output, flattened for assertions. */
const labels = () => (container?.textContent === '' ? [] : (container?.textContent ?? '').split('|').filter((s) => s !== ''))

/** The Sidebar's own `dirs` (🔒 D1, YAZ-1491): folder rows need no index read at all. */
const NO_DIRS: readonly string[] = []

function Harness({ watch, query, dirs = NO_DIRS }: { watch: WatchSource; query: string; dirs?: readonly string[] }) {
  const results = useSearchResults('/v', watch, query, dirs)
  return <>{results.map((r) => `${r.kind === 'dir' ? '📁' : ''}${r.label}|`)}</>
}

async function mount(records: IndexRecord[], query: string, tweak?: (bridge: ReturnType<typeof installBridge>) => void, dirs: readonly string[] = NO_DIRS) {
  const bridge = installBridge(records)
  tweak?.(bridge) // before the first render: the mount read is the one that can fail
  // A real fan-out watch (useWatch's shape), so "did search subscribe at all?" is answerable.
  const listeners: ((ev: WatchEvent) => void)[] = []
  const subscribe = vi.fn((l: (ev: WatchEvent) => void) => {
    listeners.push(l)
    return () => listeners.splice(listeners.indexOf(l), 1)
  })
  const watch: WatchSource = { subscribe }
  container = document.createElement('div')
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  await act(async () => reactRoot?.render(<StrictMode><Harness watch={watch} query={query} dirs={dirs} /></StrictMode>))
  const rerender = async (q: string) => act(async () => reactRoot?.render(<StrictMode><Harness watch={watch} query={q} dirs={dirs} /></StrictMode>))
  const fire = async (ev: WatchEvent) => act(async () => [...listeners].forEach((l) => l(ev)))
  return { bridge, rerender, fire, subscribe }
}

afterEach(() => {
  act(() => reactRoot?.unmount())
  reactRoot = null
  container?.remove()
  container = null
  delete (window as unknown as Record<string, unknown>).yaseenDraw
  vi.restoreAllMocks()
})

describe('useSearchResults (YAZ-803)', () => {
  it('reads the index for a query it already has and ranks it against that query', async () => {
    const { bridge } = await mount([rec('Meeting notes'), rec('Other')], 'meet')
    expect(bridge.index).toHaveBeenCalledWith('/v')
    expect(labels()).toEqual(['Meeting notes'])
  })

  it('an untouched bar reads NO index and subscribes to NOTHING; the first non-empty query does both (YAZ-808)', async () => {
    const { bridge, subscribe, rerender } = await mount([rec('Alpha')], '')
    expect(bridge.index).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    await rerender('   ') // whitespace is still no query
    expect(bridge.index).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    await rerender('a')
    expect(bridge.index).toHaveBeenCalledWith('/v')
    expect(subscribe).toHaveBeenCalled()
    expect(labels()).toEqual(['Alpha'])
  })

  it('the feed stays once activated: clearing the query refetches nothing, and a structural event still lands', async () => {
    const { bridge, rerender, fire } = await mount([rec('Alpha')], '')
    await rerender('a')
    bridge.index.mockClear()
    await rerender('') // back to no query: the records stay, nothing is refetched
    expect(bridge.index).not.toHaveBeenCalled()
    bridge.index.mockResolvedValue({ root: '/v', records: [rec('Alpha'), rec('Anchor')], generatedAt: 2 })
    await fire({ type: 'add', path: '/v/Anchor.md', mtime: 1 }) // still subscribed while the bar is empty
    await rerender('a')
    expect(labels()).toEqual(['Alpha', 'Anchor'])
  })

  it('a structural watch event refetches the index; the new snapshot is searchable', async () => {
    const { bridge, fire } = await mount([rec('Alpha')], 'a')
    bridge.index.mockResolvedValue({ root: '/v', records: [rec('Alpha'), rec('Anchor')], generatedAt: 2 })
    await fire({ type: 'add', path: '/v/Anchor.md', mtime: 1 })
    expect(labels()).toEqual(['Alpha', 'Anchor'])
  })

  it('a plain `change` event refetches nothing — a body edit cannot change a title', async () => {
    const { bridge, fire } = await mount([rec('Alpha')], 'a')
    bridge.index.mockClear()
    await fire({ type: 'change', path: '/v/Alpha.md', mtime: 2 })
    expect(bridge.index).not.toHaveBeenCalled()
  })

  it('an empty or whitespace query yields no rows at all (the shared matcher would match everything)', async () => {
    const { rerender } = await mount([rec('Alpha'), rec('Beta')], '')
    expect(labels()).toEqual([])
    await rerender('   ')
    expect(labels()).toEqual([])
    await rerender('a')
    expect(labels()).toEqual(['Alpha', 'Beta'])
  })

  it('the tree\'s folders are rows too, ahead of a same-rank note (🔒 D1, YAZ-1491)', async () => {
    await mount([rec('Archive'), rec('Archived plan')], 'archive', undefined, ['/v/Archive', '/v/Archive/Old'])
    // Exact bucket: the folder sits above the note; prefix bucket: the note; `Old` never matches.
    expect(labels()).toEqual(['📁Archive', 'Archive', 'Archived plan'])
  })

  it('folder rows survive an unreadable index — they come from the tree, not the feed', async () => {
    await mount([rec('Alpha')], 'arch', (b) => b.index.mockRejectedValue(new Error('no index')), ['/v/Archive'])
    expect(labels()).toEqual(['📁Archive'])
  })

  it('an unreadable index leaves search empty rather than throwing or surfacing anything', async () => {
    const { fire } = await mount([rec('Alpha')], 'a', (b) => b.index.mockRejectedValue(new Error('no index')))
    expect(labels()).toEqual([])
    await fire({ type: 'add', path: '/v/Beta.md', mtime: 1 }) // …and a refetch that fails again is just as quiet
    expect(labels()).toEqual([])
  })
})
