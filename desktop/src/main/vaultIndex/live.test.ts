import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { IndexRecord } from '@shared/types'
import { TEST_RECORDS } from '../../../../client/src/views/testRecords'
import { makeViewsFixture } from '../fs/viewsFixture'
import { activeWatcherRoots, subscribe } from '../fs/watchers'
import { _evictAll, _setIdleMs, getIndex } from './index'
import { scanFile } from './scan'

// Passthrough spy: preserves index behavior while proving view-only watcher events never scan.
vi.mock('./scan', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./scan')>()
  return { ...mod, scanFile: vi.fn(mod.scanFile) }
})

const until = async (pred: () => Promise<boolean> | boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 25))
  }
}

const byName = (records: IndexRecord[], name: string) => records.find((r) => r.name === name)

const watcherReady = (root: string): Promise<void> =>
  new Promise((resolve) => {
    let off: (() => void) | null = null
    let fired = false
    off = subscribe(root, (ev) => {
      if (ev.type !== 'ready') return
      fired = true
      off?.()
      resolve()
    })
    if (fired) off()
  })

async function mutateAndWaitForFileEvent(root: string, type: 'add' | 'change' | 'unlink', file: string, mutate: () => Promise<void>): Promise<void> {
  let off = (): void => undefined
  const seen = new Promise<void>((resolve) => {
    off = subscribe(root, (ev) => {
      if (ev.type !== type || !('path' in ev) || ev.path !== file) return
      off()
      resolve()
    })
  })
  try {
    await mutate()
    await seen
  } finally {
    off()
  }
}

describe('getIndex: cold scan', () => {
  let root: string
  let cleanup: () => Promise<void>
  beforeAll(async () => ({ root, cleanup } = await makeViewsFixture()))
  afterAll(async () => {
    _evictAll()
    await cleanup()
  })

  it('indexes the 8 fixture notes, sorted by path; pngs and dot-dirs are not records', async () => {
    const t0 = performance.now()
    const res = await getIndex(root)
    console.log(`cold scan of the bases fixture: ${(performance.now() - t0).toFixed(1)} ms`)
    expect(res.root).toBe(root)
    expect(res.generatedAt).toBeGreaterThan(0)
    expect(res.records).toHaveLength(8)
    expect(res.records.map((r) => r.path)).toEqual([...res.records.map((r) => r.path)].sort())
    expect(res.records.every((r) => r.ext === 'md')).toBe(true)
    expect(res.records.some((r) => r.name.endsWith('.png'))).toBe(false)
    // `.yaseendraw/` (vault-local config, GRO-2188) never becomes an index record (GRO-2117 note).
    expect(res.records.some((r) => r.path.includes('/.trash/') || r.path.includes('/.obsidian/') || r.path.includes('/.yaseendraw/'))).toBe(false)
  })

  it('matches the fixture spec facts', async () => {
    const { records } = await getIndex(root)
    const hasTag = (tag: string) => records.filter((r) => r.tags.some((t) => t === tag || t.startsWith(`${tag}/`)))
    expect(hasTag('agentic')).toHaveLength(2)
    expect(hasTag('attribution')).toHaveLength(1)
    expect(hasTag('ads')).toHaveLength(0)
    expect(records.filter((r) => r.links.includes('Agentic Agency'))).toHaveLength(2)
    expect(records.filter((r) => r.folder.includes('Creator Economy'))).toHaveLength(2)
    expect(byName(records, 'Tech & Silicon Valley.md')?.frontmatterError).toMatch(/\S/)
    expect(byName(records, 'VSL-v1.md')?.properties).toEqual({ status: 'published', pillar: null })
  })

  it('deep-equals TEST_RECORDS once path and stat fields are normalised', async () => {
    const { records } = await getIndex(root)
    const normalised = records.map((r) => ({ ...r, path: '/vault' + r.path.slice(root.length), size: 0, ctime: 0, mtime: 0 }))
    expect(normalised).toEqual(TEST_RECORDS)
  })

  it('serves the cache on later calls and shares one scan between concurrent first calls', async () => {
    _evictAll()
    expect(activeWatcherRoots()).not.toContain(root)
    const [a, b] = await Promise.all([getIndex(root), getIndex(root)])
    expect(a.records[0]).toBe(b.records[0])
    const c = await getIndex(root)
    expect(c.records[0]).toBe(a.records[0])
    expect(c.generatedAt).toBeGreaterThanOrEqual(a.generatedAt)
    expect(activeWatcherRoots()).toContain(root)
  })

  it('bad roots fail with an BridgeFailure', async () => {
    await expect(getIndex(path.join(root, 'nope'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getIndex(path.join(root, 'VSL-v1.md'))).rejects.toMatchObject({ code: 'NOT_A_DIRECTORY' })
  })
})

describe('getIndex: incremental updates from the watcher', () => {
  let root: string
  let cleanup: () => Promise<void>
  beforeAll(async () => {
    ;({ root, cleanup } = await makeViewsFixture())
    await getIndex(root)
  })
  afterAll(async () => {
    _evictAll()
    await cleanup()
  })

  it('never scans or indexes supported text/PDF/image add, change, or unlink events', async () => {
    await watcherReady(root)
    const baseline = (await getIndex(root)).records.map((record) => record.path)
    for (const [name, first, second] of [
      ['view-only.json', '{"version":1}', '{"version":2,"changed":true}'],
      ['view-only.pdf', '%PDF-1.7\nfirst', '%PDF-1.7\nsecond revision'],
      ['view-only.png', 'png-first', 'png-second'],
      ['view-only.WEBP', 'webp-first', 'webp-second'],
    ] as const) {
      const file = path.join(root, name)
      vi.mocked(scanFile).mockClear()

      await mutateAndWaitForFileEvent(root, 'add', file, () => writeFile(file, first))
      expect(scanFile).not.toHaveBeenCalled()
      expect((await getIndex(root)).records.map((record) => record.path)).toEqual(baseline)

      await mutateAndWaitForFileEvent(root, 'change', file, () => writeFile(file, second))
      expect(scanFile).not.toHaveBeenCalled()
      expect((await getIndex(root)).records.map((record) => record.path)).toEqual(baseline)

      await mutateAndWaitForFileEvent(root, 'unlink', file, () => rm(file))
      expect(scanFile).not.toHaveBeenCalled()
      expect((await getIndex(root)).records.map((record) => record.path)).toEqual(baseline)
    }
  })

  it('a changed note is re-scanned in place', async () => {
    const file = path.join(root, 'VSL-v1.md')
    await writeFile(file, '---\nstatus: done\ntags: [vsl]\n---\n\nUpdated #fresh\n')
    await until(async () => byName((await getIndex(root)).records, 'VSL-v1.md')?.properties.status === 'done')
    const r = byName((await getIndex(root)).records, 'VSL-v1.md')
    expect(r?.tags).toEqual(['vsl', 'fresh'])
    expect((await getIndex(root)).records).toHaveLength(8)
  })

  it('a new note appears; a non-vault file does not', async () => {
    await writeFile(path.join(root, 'Content Pillars', 'New Note.md'), '# New\n#new [[VSL-v1]]\n')
    await writeFile(path.join(root, 'Content Pillars', 'Other.base'), 'views: []\n') // a non-vault extension since YAZ-844
    await until(async () => byName((await getIndex(root)).records, 'New Note.md') !== undefined)
    const r = byName((await getIndex(root)).records, 'New Note.md')
    expect(r).toMatchObject({ folder: 'Content Pillars', tags: ['new'], links: ['VSL-v1'] })
    expect((await getIndex(root)).records).toHaveLength(9)
  })

  it('a deleted note disappears', async () => {
    await rm(path.join(root, 'Content Pillars', 'New Note.md'))
    await until(async () => byName((await getIndex(root)).records, 'New Note.md') === undefined)
    expect((await getIndex(root)).records).toHaveLength(8)
  })

  it('a deleted folder takes its records with it', async () => {
    await rm(path.join(root, 'Content Pillars', '2. Creator Economy'), { recursive: true })
    await until(async () => (await getIndex(root)).records.length === 6)
    expect((await getIndex(root)).records.some((r) => r.folder.includes('Creator Economy'))).toBe(false)
  })

  it('a note in a new folder appears', async () => {
    const dir = path.join(root, 'Fresh')
    await mkdir(dir)
    await writeFile(path.join(dir, 'In Fresh.md'), 'hello\n')
    await until(async () => byName((await getIndex(root)).records, 'In Fresh.md') !== undefined)
    expect(byName((await getIndex(root)).records, 'In Fresh.md')?.folder).toBe('Fresh')
  })
})

// TOMBSTONE (⚡ YAZ-815): a `getIndex: .obsidian/types.json` describe stood here — the per-call
// read, its non-string filtering and its missing/malformed fallbacks. The read is gone: this index
// no longer opens anything inside `.obsidian`, and `IndexResponse` carries no `types`.

describe('getIndex: idle eviction', () => {
  let root: string
  let cleanup: () => Promise<void>
  beforeAll(async () => ({ root, cleanup } = await makeViewsFixture()))
  afterAll(async () => {
    _setIdleMs()
    _evictAll()
    await cleanup()
  })

  it('unsubscribes the watcher and drops the map after the idle period; the next call rescans', async () => {
    _setIdleMs(100)
    await getIndex(root)
    expect(activeWatcherRoots()).toContain(root)
    await until(() => !activeWatcherRoots().includes(root), 2000)
    await writeFile(path.join(root, 'After.md'), 'x\n')
    const { records } = await getIndex(root)
    expect(byName(records, 'After.md')).toBeDefined()
    expect(activeWatcherRoots()).toContain(root)
  })

  it('_evictAll drops every root', () => {
    _evictAll()
    expect(activeWatcherRoots()).toEqual([])
  })
})
