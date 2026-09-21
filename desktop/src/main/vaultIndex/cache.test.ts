import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MAX_FILE_BYTES, type IndexRecord } from '@shared/types'
import {
  CACHE_VERSION,
  _gcDone,
  _resetIndexCache,
  _setPersistDebounceMs,
  flushIndexCache,
  initIndexCache,
  loadIndexCache,
  schedulePersist,
} from './cache'
import { scanFile } from './scan'

const until = async (pred: () => Promise<boolean> | boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const record = (p: string, over: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.basename(p)
  return {
    path: p,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: '',
    ext: 'md',
    size: 10,
    ctime: 1000,
    mtime: 2000.5,
    properties: { status: 'idea', priority: 2, pillar: null },
    aliases: ['A short name'],
    tags: ['a', 'a/b'],
    links: ['B'],
    embeds: [],
    ...over,
  }
}

const asMap = (...records: IndexRecord[]) => new Map(records.map((r) => [r.path, r]))

/** The one cache file the dir holds (persist a root first). */
const cacheFileIn = async (dir: string): Promise<string> => {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  expect(files).toHaveLength(1)
  return path.join(dir, files[0])
}

describe('index cache: before initIndexCache', () => {
  it('load is a miss, schedulePersist is a no-op, flush resolves — nothing throws', async () => {
    _resetIndexCache()
    await expect(loadIndexCache('/vault')).resolves.toEqual({ records: null, status: 'miss' })
    schedulePersist('/vault', asMap(record('/vault/a.md')))
    await expect(flushIndexCache()).resolves.toBeUndefined()
  })
})

describe('index cache: write / load round trip', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-'))
    initIndexCache(path.join(dir, 'index-cache')) // exercises the lazy mkdir -p
  })
  afterEach(async () => {
    await flushIndexCache()
    _setPersistDebounceMs()
  })
  afterAll(async () => {
    _resetIndexCache()
    await rm(dir, { recursive: true, force: true })
  })

  it('a flushed persist round-trips the records; missing file for another root is a miss', async () => {
    const a = record('/vault/a.md')
    const b = record('/vault/sub/b.md', { folder: 'sub', mtime: 3000 })
    schedulePersist('/vault', asMap(a, b))
    await flushIndexCache()
    const load = await loadIndexCache('/vault')
    expect(load.status).toBe('hit')
    expect([...load.records!.entries()]).toEqual([...asMap(a, b).entries()])
    expect(await loadIndexCache('/other-vault')).toEqual({ records: null, status: 'miss' })
  })

  it('writes are atomic: after a flush the dir holds valid JSON and no tmp leftovers', async () => {
    schedulePersist('/vault', asMap(record('/vault/a.md')))
    await flushIndexCache()
    const cacheDir = path.join(dir, 'index-cache')
    expect((await readdir(cacheDir)).some((f) => f.includes('.tmp-'))).toBe(false)
    const parsed: unknown = JSON.parse(await readFile(await cacheFileIn(cacheDir), 'utf8'))
    expect(parsed).toMatchObject({ version: CACHE_VERSION, root: '/vault' })
  })

  it('debounce coalesces bursts per root: one trailing write with the latest records', async () => {
    _setPersistDebounceMs(60)
    const cacheDir = path.join(dir, 'index-cache')
    const stale = record('/burst/a.md', { size: 1 })
    const fresh = record('/burst/a.md', { size: 99 })
    schedulePersist('/burst', asMap(stale))
    await new Promise((r) => setTimeout(r, 30))
    schedulePersist('/burst', asMap(fresh)) // resets the 60 ms timer
    await new Promise((r) => setTimeout(r, 40)) // 70 ms after the first call: the reset timer has not fired
    expect((await loadIndexCache('/burst')).status).toBe('miss')
    await until(async () => (await loadIndexCache('/burst')).status === 'hit')
    expect((await loadIndexCache('/burst')).records!.get('/burst/a.md')?.size).toBe(99)
  })

  it('flushIndexCache writes pending roots at once (no debounce wait)', async () => {
    _setPersistDebounceMs(60_000)
    schedulePersist('/flush-me', asMap(record('/flush-me/a.md')))
    expect((await loadIndexCache('/flush-me')).status).toBe('miss')
    await flushIndexCache()
    expect((await loadIndexCache('/flush-me')).status).toBe('hit')
  })

  it('records with non-finite property values (YAML .inf/.nan) are excluded from the write', async () => {
    const ok = record('/nf/ok.md')
    const inf = record('/nf/inf.md', { properties: { n: Infinity } })
    const nested = record('/nf/nested.md', { properties: { list: [{ deep: NaN }] } })
    schedulePersist('/nf', asMap(ok, inf, nested))
    await flushIndexCache()
    const load = await loadIndexCache('/nf')
    expect(load.status).toBe('hit')
    expect([...load.records!.keys()]).toEqual(['/nf/ok.md'])
  })

  it('cyclic frontmatter (self-referential YAML alias) excludes that record; shared acyclic aliases persist', async () => {
    // `a: &x\n  b: *x` really parses to a cyclic object (yaml pkg) — JSON.stringify would throw.
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const shared = ['x'] // `a: &s [x]` + `b: *s`: shared but acyclic — stringify just duplicates it
    const ok = record('/cyc/ok.md', { properties: { a: shared, b: shared } })
    const bad = record('/cyc/bad.md', { properties: cyclic })
    schedulePersist('/cyc', asMap(ok, bad))
    await flushIndexCache()
    const load = await loadIndexCache('/cyc')
    expect(load.status).toBe('hit')
    expect([...load.records!.keys()]).toEqual(['/cyc/ok.md'])
    expect(load.records!.get('/cyc/ok.md')?.properties).toEqual({ a: ['x'], b: ['x'] })
  })

  it('per-root write chain: a flush issued before the previous one settles still lands last', async () => {
    _setPersistDebounceMs(60_000)
    schedulePersist('/order', asMap(record('/order/a.md', { size: 1 })))
    const first = flushIndexCache() // starts write 1 — deliberately not awaited yet
    schedulePersist('/order', asMap(record('/order/a.md', { size: 2 })))
    const second = flushIndexCache() // chains write 2 behind the in-flight write 1
    await Promise.all([first, second])
    expect((await loadIndexCache('/order')).records!.get('/order/a.md')?.size).toBe(2)
  })
})

describe('index cache: a failed write logs and never rejects; the chain recovers', () => {
  let base: string
  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-fail-'))
  })
  afterAll(async () => {
    _resetIndexCache()
    await rm(base, { recursive: true, force: true })
  })

  it('a FILE occupying the cache-dir path fails the write (logged, flush resolves); removing it heals the next persist', async () => {
    const blocked = path.join(base, 'blocked')
    await writeFile(blocked, 'occupies the dir path') // mkdir -p will now fail
    _resetIndexCache()
    initIndexCache(blocked)
    await _gcDone() // readdir on a file → caught, silent no-op
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      schedulePersist('/heal', asMap(record('/heal/a.md')))
      await expect(flushIndexCache()).resolves.toBeUndefined() // never rejects
      expect(error).toHaveBeenCalledTimes(1)
      expect((await loadIndexCache('/heal')).status).toBe('miss')
      await rm(blocked) // obstruction gone — the chain must not stay poisoned
      schedulePersist('/heal', asMap(record('/heal/a.md')))
      await flushIndexCache()
      expect(error).toHaveBeenCalledTimes(1) // no second failure
      expect((await loadIndexCache('/heal')).status).toBe('hit')
    } finally {
      error.mockRestore()
    }
  })
})

describe('index cache: a bad file never throws, only degrades', () => {
  let dir: string
  let file: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-bad-'))
    initIndexCache(dir)
    schedulePersist('/vault', asMap(record('/vault/a.md')))
    await flushIndexCache()
    file = await cacheFileIn(dir)
  })
  afterAll(async () => {
    _resetIndexCache()
    await rm(dir, { recursive: true, force: true })
  })

  it('unparsable JSON → corrupt', async () => {
    await writeFile(file, 'not json {{{')
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'corrupt' })
  })

  it('non-object payloads → corrupt', async () => {
    for (const body of ['[]', '"str"', 'null', `{"version":${CACHE_VERSION},"root":"/vault","records":{}}`]) {
      await writeFile(file, body)
      expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'corrupt' })
    }
  })

  it('a malformed record element poisons the whole file → corrupt', async () => {
    await writeFile(file, JSON.stringify({ version: CACHE_VERSION, root: '/vault', records: [record('/vault/a.md'), { path: 5 }] }))
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'corrupt' })
    await writeFile(file, JSON.stringify({ version: CACHE_VERSION, root: '/vault', records: [{ ...record('/vault/a.md'), tags: 'oops' }] }))
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'corrupt' })
  })

  it('another version → version-mismatch', async () => {
    await writeFile(file, JSON.stringify({ version: CACHE_VERSION + 1, root: '/vault', records: [] }))
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'version-mismatch' })
  })

  it("another root's payload at this filename → miss (not this vault's cache)", async () => {
    await writeFile(file, JSON.stringify({ version: CACHE_VERSION, root: '/elsewhere', records: [] }))
    expect(await loadIndexCache('/vault')).toEqual({ records: null, status: 'miss' })
  })
})

describe('index cache: CACHE_VERSION pin (GRO-2230)', () => {
  // THE RULE this test enforces: a cached snapshot written under old semantics must never be read
  // as if it had new semantics. Any change to IndexRecord's shape or to the scanner's extraction
  // behaviour must bump CACHE_VERSION so every old snapshot degrades to one full rescan.
  const BUMP_MSG =
    'The cached snapshot shape or the scanner extraction semantics changed. ' +
    'Bump CACHE_VERSION in vaultIndex/cache.ts and re-pin FINGERPRINT in this test — ' +
    'discard IS the migration (a version mismatch costs one full rescan, never a converter).'

  /** Exercises every extraction rule the cache would freeze: frontmatter parsing, the `comments` drop, tag/link/embed extraction, code stripping, URL skipping. */
  const CANONICAL_NOTE = [
    '---',
    'title: Canonical',
    'count: 3',
    'list: [x, y]',
    "tags: [alpha, '#beta']",
    'link: "[[Ref|shown]]"',
    "aliases: [Canon, ' Spaced Alias ', '[[Not A Link]]']",
    'comments:',
    '  - id: c0ffee00',
    '    at: 2026-09-11T18:22:31Z',
    '    body: "[[Not A Link Either]] — a comment is the note, not a property"',
    '---',
    '',
    'Inline #gamma and #tag/nested here, plus https://example.test/#not-a-tag',
    'Body [[Note One|alias]] then [[Note Two#heading]] then ![[img.png]]',
    '`#code and [[in-code]]` stay out',
    '```',
    '#fenced-out and [[fenced-link]]',
    '```',
    '',
  ].join('\n')

  const FINGERPRINT = {
    cacheVersion: 3,
    maxFileBytes: 10 * 1024 * 1024,
    /** Sorted union of the keys a valid record and a frontmatter-error record carry. */
    recordKeys: ['aliases', 'basename', 'ctime', 'embeds', 'ext', 'folder', 'frontmatterError', 'links', 'mtime', 'name', 'path', 'properties', 'size', 'tags'],
    extraction: {
      properties: {
        title: 'Canonical',
        count: 3,
        list: ['x', 'y'],
        tags: ['alpha', '#beta'],
        link: '[[Ref|shown]]',
        aliases: ['Canon', ' Spaced Alias ', '[[Not A Link]]'],
        // No `comments`: the note's own comment stream is dropped at scan time (YAZ-1472, 🔒 D5).
      },
      aliases: ['Canon', 'Spaced Alias', '[[Not A Link]]'],
      tags: ['alpha', 'beta', 'gamma', 'tag/nested'],
      // `[[Not A Link]]` sits under `aliases`, so it is a NAME, never an outgoing link (GRO-2214).
      links: ['Ref', 'Note One', 'Note Two'],
      embeds: ['img.png'],
    },
  }

  it('the snapshot shape + extraction semantics fingerprint matches CACHE_VERSION', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mdapp-cache-version-pin-'))
    try {
      const canonical = path.join(root, 'canonical.md')
      const broken = path.join(root, 'broken.md')
      await writeFile(canonical, CANONICAL_NOTE)
      await writeFile(broken, '---\nstatus: [unclosed\n---\nBody after broken frontmatter.\n')
      const record = await scanFile(root, canonical)
      const errored = await scanFile(root, broken)
      expect(errored.frontmatterError, BUMP_MSG).toBeDefined()
      const actual = {
        cacheVersion: CACHE_VERSION,
        maxFileBytes: MAX_FILE_BYTES,
        recordKeys: [...new Set([...Object.keys(record), ...Object.keys(errored)])].sort(),
        extraction: { properties: record.properties, aliases: record.aliases, tags: record.tags, links: record.links, embeds: record.embeds },
      }
      expect(actual, BUMP_MSG).toEqual(FINGERPRINT)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('index cache: init-time GC (GRO-2230)', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-gc-'))
  })
  afterAll(async () => {
    _resetIndexCache()
    await rm(dir, { recursive: true, force: true })
  })

  it('re-init deletes files older than the TTL (tmp leftovers included); a swept root is a plain miss; fresh files survive', async () => {
    _resetIndexCache()
    initIndexCache(dir)
    await _gcDone()
    // A real stale cache: persist a root, then backdate its file and a fake crashed-write leftover.
    schedulePersist('/gc/stale', asMap(record('/gc/stale/a.md')))
    await flushIndexCache()
    const staleFile = await cacheFileIn(dir)
    const tmpLeftover = `${staleFile}.tmp-deadbeef`
    await writeFile(tmpLeftover, 'half a write')
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000)
    await utimes(staleFile, old, old)
    await utimes(tmpLeftover, old, old)
    // A fresh cache that must survive the sweep.
    schedulePersist('/gc/fresh', asMap(record('/gc/fresh/a.md')))
    await flushIndexCache()
    expect((await readdir(dir)).length).toBe(3)
    initIndexCache(dir) // relaunch: the init sweep runs again
    await _gcDone()
    expect((await readdir(dir)).filter((f) => f.endsWith('.json'))).toHaveLength(1)
    expect((await readdir(dir)).some((f) => f.includes('.tmp-'))).toBe(false)
    expect((await loadIndexCache('/gc/stale')).status).toBe('miss') // self-healing: just one full rescan
    expect((await loadIndexCache('/gc/fresh')).status).toBe('hit')
  })

  it('a cache dir that does not exist yet (first launch) makes the sweep a silent no-op', async () => {
    _resetIndexCache()
    initIndexCache(path.join(dir, 'never-created'))
    await expect(_gcDone()).resolves.toBeUndefined()
  })
})
