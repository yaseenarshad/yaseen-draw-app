/**
 * The E1c hypothesis pipeline (GRO-2242): both feeds into the queue, the cacheStatus gate,
 * the N > 0 rule, dismissal/suppression semantics and the Update flow (repair + rewrite +
 * notice) — all through the REAL api/detector/engine modules over a stubbed bridge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ColdStartDiffResponse, IndexRecord } from '@shared/types'
import { useExternalRenames, type ExternalRenames } from './useExternalRenames'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function rec(path: string, over: Partial<IndexRecord> = {}): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const basename = name.replace(/\.(md|markdown)$/i, '')
  const rel = path.startsWith('/v/') ? path.slice('/v/'.length) : path
  const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  return { path, name, basename, folder, ext: 'md', size: 7, ctime: 1, mtime: 100, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
}

const hitDiff = (over: Partial<ColdStartDiffResponse> = {}): ColdStartDiffResponse => ({
  root: '/v',
  scannedAt: 1,
  cacheStatus: 'hit',
  added: [{ path: '/v/B2.md', size: 7, mtime: 100 }],
  removed: [{ path: '/v/B.md', size: 7, mtime: 100 }],
  changed: [],
  ...over,
})

/** The bridge slice this pipeline touches (api.coldDiff/index/tree/readFile/writeFile/file.repairRename). */
function installBridge() {
  const files: Record<string, { content: string; mtime: number }> = {}
  const bridge = {
    coldDiff: vi.fn(async (): Promise<ColdStartDiffResponse | null> => null),
    index: vi.fn(async (root: string) => ({ root, records: [] as IndexRecord[], generatedAt: 1 })),
    tree: vi.fn(async (root: string) => ({ root, tree: [], generatedAt: 1 })),
    readFile: vi.fn(async (path: string) => {
      const f = files[path]
      if (f === undefined) return Promise.reject({ code: 'NOT_FOUND', message: 'path does not exist', path })
      return { path, content: f.content, mtime: f.mtime, size: f.content.length }
    }),
    writeFile: vi.fn(async ({ path, content }: { path: string; content: string }) => {
      files[path] = { content, mtime: (files[path]?.mtime ?? 0) + 1 }
      return { path, mtime: files[path].mtime, size: content.length }
    }),
    file: {
      repairRename: vi.fn(async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => ({ oldPath, newPath, kind: 'file' as const })),
    },
  }
  Object.defineProperty(window, 'yaseenDraw', { value: bridge, configurable: true, writable: true })
  return { bridge, files }
}

const captured: { ext: ExternalRenames | null } = { ext: null }
const notices: string[] = []

function Harness({ root }: { root: string | null }) {
  const ext = useExternalRenames(root, (m) => notices.push(m))
  captured.ext = ext
  return ext.banner === null ? null : <div data-banner>{`${ext.banner.oldPath}|${ext.banner.newPath}|${ext.banner.count}`}</div>
}

let reactRoot: Root | null = null
let container: HTMLElement | null = null

async function mount(root: string | null = '/v') {
  const b = installBridge()
  container = document.createElement('div')
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  act(() => reactRoot?.render(<StrictMode><Harness root={root} /></StrictMode>))
  await act(async () => {})
  return { ...b, el: container }
}

const banner = () => container?.querySelector('[data-banner]')?.textContent ?? null
const snapshot = async (records: IndexRecord[]) => {
  act(() => captured.ext?.onSnapshot(records))
  await act(async () => {}) // settle the cold-diff read (first snapshot) / queue updates
}

afterEach(() => {
  act(() => reactRoot?.unmount())
  reactRoot = null
  container?.remove()
  container = null
  captured.ext = null
  notices.length = 0
  delete (window as unknown as Record<string, unknown>).yaseenDraw
  vi.restoreAllMocks()
})

/** A.md references B; B2.md is the externally renamed B (post-rename snapshot). */
const postRename = [rec('/v/A.md', { links: ['B'], size: 20, mtime: 5 }), rec('/v/B2.md')]

describe('useExternalRenames — the cold-start feed (GRO-2242)', () => {
  it('first ready snapshot + a HIT diff with an unambiguous pair and N > 0 → the banner shows, N from the engine', async () => {
    const { bridge } = await mount()
    bridge.coldDiff.mockResolvedValue(hitDiff())
    await snapshot(postRename)
    expect(bridge.coldDiff).toHaveBeenCalledWith('/v')
    expect(banner()).toBe('/v/B.md|/v/B2.md|1')
  })

  it('the cacheStatus gate is absolute: a non-hit diff never banners, whatever its lists claim', async () => {
    const { bridge } = await mount()
    bridge.coldDiff.mockResolvedValue(hitDiff({ cacheStatus: 'miss' }))
    await snapshot(postRename)
    expect(banner()).toBeNull()
  })

  it('N === 0 → no banner at all (nothing references the vanished path)', async () => {
    const { bridge } = await mount()
    bridge.coldDiff.mockResolvedValue(hitDiff())
    await snapshot([rec('/v/A.md', { links: ['Other'] }), rec('/v/B2.md')])
    expect(banner()).toBeNull()
  })

  it('the cold diff is read ONCE per root, on the first snapshot only', async () => {
    const { bridge } = await mount()
    await snapshot(postRename)
    await snapshot(postRename)
    expect(bridge.coldDiff).toHaveBeenCalledTimes(1)
  })
})

describe('useExternalRenames — the while-running feed', () => {
  const preRename = [rec('/v/A.md', { links: ['B'], size: 20, mtime: 5 }), rec('/v/B.md')]

  it('a record vanishing while another appears with matching (size, mtime) across consecutive snapshots → banner', async () => {
    await mount()
    await snapshot(preRename)
    expect(banner()).toBeNull()
    await snapshot(postRename)
    expect(banner()).toBe('/v/B.md|/v/B2.md|1')
  })

  it('a plain delete + an unrelated create never pair (stats differ)', async () => {
    await mount()
    await snapshot(preRename)
    await snapshot([rec('/v/A.md', { links: ['B'], size: 20, mtime: 5 }), rec('/v/New.md', { size: 3, mtime: 999 })])
    expect(banner()).toBeNull()
  })

  it('Dismiss drops the hypothesis for the session: the SAME pair re-detected later never re-offers', async () => {
    await mount()
    await snapshot(preRename)
    await snapshot(postRename)
    expect(banner()).not.toBeNull()
    act(() => captured.ext?.dismiss())
    expect(banner()).toBeNull()
    // The file flips back and renames again — the exact pair is dismissed for good.
    await snapshot(preRename)
    await snapshot(postRename)
    expect(banner()).toBeNull()
  })

  it('suppress (an in-app FILE rename echo) keeps the pair out of the queue', async () => {
    await mount()
    await snapshot(preRename)
    act(() => captured.ext?.suppress('/v/B.md', '/v/B2.md', 'file'))
    await snapshot(postRename)
    expect(banner()).toBeNull()
  })

  it('suppress (an in-app DIR rename) covers every moved note by prefix mapping', async () => {
    await mount()
    await snapshot([rec('/v/A.md', { links: ['Docs/N'], size: 20, mtime: 5 }), rec('/v/Docs/N.md')])
    act(() => captured.ext?.suppress('/v/Docs', '/v/Notes', 'dir'))
    await snapshot([rec('/v/A.md', { links: ['Docs/N'], size: 20, mtime: 5 }), rec('/v/Notes/N.md')])
    expect(banner()).toBeNull()
  })

  it('hypotheses queue oldest-first, one banner at a time; Dismiss advances to the next', async () => {
    await mount()
    await snapshot([rec('/v/A.md', { links: ['B', 'C'], size: 20, mtime: 5 }), rec('/v/B.md', { mtime: 100 }), rec('/v/C.md', { mtime: 200 })])
    await snapshot([rec('/v/A.md', { links: ['B', 'C'], size: 20, mtime: 5 }), rec('/v/B2.md', { mtime: 100 }), rec('/v/C2.md', { mtime: 200 })])
    expect(banner()).toBe('/v/B.md|/v/B2.md|1')
    act(() => captured.ext?.dismiss())
    expect(banner()).toBe('/v/C.md|/v/C2.md|1')
  })

  it('a rename SPLIT across two snapshots (unlink seen a generation before the add) still banners (GRO-2197)', async () => {
    // awaitWriteFinish delays the watcher's `add` while `unlink` lands at once, so a refetch
    // can catch the index mid-rename: one diff sees only the removal, the next only the
    // addition. The one-generation carry re-joins the halves.
    await mount()
    await snapshot(preRename)
    await snapshot([rec('/v/A.md', { links: ['B'], size: 20, mtime: 5 })]) // B vanished, B2 not indexed yet
    expect(banner()).toBeNull()
    await snapshot(postRename) // B2 appears with B's exact (size, mtime)
    expect(banner()).toBe('/v/B.md|/v/B2.md|1')
  })

  it('a carried removal whose path comes BACK in the next snapshot never banners (a save, not a rename)', async () => {
    await mount()
    await snapshot(preRename)
    await snapshot([rec('/v/A.md', { links: ['B'], size: 20, mtime: 5 })]) // B momentarily gone mid-write
    await snapshot(preRename) // …and back at the same path: drop the carried removal
    expect(banner()).toBeNull()
  })

  it('the carry lasts exactly ONE generation: a removal older than that never pairs', async () => {
    await mount()
    await snapshot(preRename)
    await snapshot([rec('/v/A.md', { links: ['B'], size: 20, mtime: 5 })]) // gen 1: B removed (carried)
    await snapshot([rec('/v/A.md', { links: ['B'], size: 20, mtime: 5 })]) // gen 2: nothing — carry expires
    await snapshot(postRename) // gen 3: B2 appears, but the removal is two generations old
    expect(banner()).toBeNull()
  })

  it('a root switch clears the queue and the snapshot chain', async () => {
    await mount()
    await snapshot(preRename)
    await snapshot(postRename)
    expect(banner()).not.toBeNull()
    act(() => reactRoot?.render(<StrictMode><Harness root="/w" /></StrictMode>))
    await act(async () => {})
    expect(banner()).toBeNull()
  })
})

describe('useExternalRenames — Update (confirm-first, the ONLY path to any rewrite)', () => {
  const preRename = [rec('/v/A.md', { links: ['B'], size: 20, mtime: 5 }), rec('/v/B.md')]

  it('Update repairs the app, rewrites the referencing note through the engine and shows the summary notice', async () => {
    const { bridge, files } = await mount()
    files['/v/A.md'] = { content: 'See [[B]] and [[B|Bee]].\n', mtime: 1 }
    bridge.index.mockResolvedValue({ root: '/v', records: postRename, generatedAt: 2 })
    await snapshot(preRename)
    await snapshot(postRename)
    expect(bridge.writeFile).not.toHaveBeenCalled() // NOTHING before the confirmation (locked)
    act(() => captured.ext?.update())
    await act(async () => {})
    expect(bridge.file.repairRename).toHaveBeenCalledWith({ oldPath: '/v/B.md', newPath: '/v/B2.md' })
    expect(files['/v/A.md'].content).toBe('See [[B2]] and [[B2|Bee]].\n')
    expect(notices).toEqual(['Updated links in 1 note'])
    expect(banner()).toBeNull()
    // The handled pair is never re-offered either.
    await snapshot(preRename)
    await snapshot(postRename)
    expect(banner()).toBeNull()
  })

  it('a stale hypothesis (repair refused by main) surfaces a passive notice and rewrites NOTHING', async () => {
    const { bridge, files } = await mount()
    files['/v/A.md'] = { content: 'See [[B]].\n', mtime: 1 }
    bridge.file.repairRename.mockRejectedValue({ code: 'BAD_REQUEST', message: 'the old path still exists on disk', path: '/v/B.md' })
    await snapshot(preRename)
    await snapshot(postRename)
    act(() => captured.ext?.update())
    await act(async () => {})
    expect(bridge.writeFile).not.toHaveBeenCalled()
    expect(files['/v/A.md'].content).toBe('See [[B]].\n')
    expect(notices).toEqual(["Can't update links: the old path still exists on disk"])
  })
})
