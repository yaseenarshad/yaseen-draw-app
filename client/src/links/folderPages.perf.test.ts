/**
 * Folder pages (YAZ-827): the build budget. `folderPagesLookup` rebuilds its whole map on every
 * index refresh and EVERY folder-page surface waits on it, so the map has to stay cheap forever —
 * half the bases engine's budget, 25 ms for 1,000 pages. Runs in the `perf` project (YAZ-740).
 *
 * The snapshot is a realistic spread, not a best case: a nested Home → topics tree of 16 folder
 * pages, most notes carrying 1-3 parents through mixed spellings (cased, piped), some waiting
 * on dangling or unflagged targets, some uncategorised, and a sprinkle of malformed entries — every
 * leg of the click rule gets walked. Generation is deterministic (`i % n`, never `Math.random`).
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { stripBrackets } from '../views/expr'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { folderPagesLookup } from './folderPages'

const PAGES = 1000
/** Home plus 15 topics — the tree a real vault grows, wide at the top and a few levels deep. */
const TOPICS = [
  'Home',
  'Projects',
  'Areas',
  'Clients',
  'Engineering',
  'Health',
  'Finance',
  'Reading',
  'Meetings',
  'Recipes',
  'Travel',
  'Writing',
  'Music',
  'Garden',
  'Archive',
  'Someday',
]

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1024 + path.length,
    ctime: 1_700_000_000_000,
    mtime: 1_750_000_000_000,
    properties,
    aliases: [],
    tags: ['note'],
    links: [],
    embeds: [],
  }
}

/** Basename → path, keyed like `makeResolver` (`views/engine.ts`) — the unit tests' `resolverOver`. */
const resolverOver = (records: readonly IndexRecord[]): ResolveLink => {
  const byBase = new Map(records.map((r) => [r.basename.toLowerCase(), r.path]))
  return (target) => byBase.get(stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()) ?? null
}

const topicPath = (t: number): string => (t === 0 ? '/vault/Home.md' : `/vault/Topics/${TOPICS[t]}.md`)

/** The three spellings a real note reaches a folder page by, cycled deterministically. */
const spell = (i: number, topic: number): string => {
  const name = TOPICS[topic]
  if (i % 3 === 1) return `[[${name.toLowerCase()}]]`
  if (i % 3 === 2) return `[[${name}|${name} notes]]`
  return `[[${name}]]`
}

/**
 * The 16 folder pages, nested: topic `t` names topic `floor((t - 1) / 2)` as its parent, so Home
 * holds two topics, each of those holds two more, four levels down. Folder pages are ordinary
 * records that also carry members — exactly the shape that makes the build do double work.
 */
function folderPageRecord(t: number): IndexRecord {
  const properties: Record<string, unknown> = { folder_page: true, title: TOPICS[t] }
  if (t > 0) properties.folder_pages = [spell(t, Math.floor((t - 1) / 2))]
  return rec(topicPath(t), properties)
}

/**
 * One ordinary note. `i % 7` sets the shape — uncategorised, one/two/three parents, or an
 * entry still waiting on a dangling or unflagged target — and the rarer moduli sprinkle in the
 * malformed entries the click rule has to drop quietly (bare names, prose, numbers, null, a
 * mapping, and the scalar-instead-of-list the indexer tolerates).
 */
function noteRecord(i: number): IndexRecord {
  const path = `/vault/Notes/${TOPICS[i % TOPICS.length]}/Note ${i}.md`
  const properties: Record<string, unknown> = { title: `Note ${i}`, status: i % 3 ? 'todo' : 'done' }
  const shape = i % 7
  const entries: unknown[] = []
  if (shape === 1 || shape === 2) entries.push(spell(i, i % TOPICS.length))
  if (shape === 3 || shape === 4) entries.push(spell(i, i % TOPICS.length), spell(i + 1, (i * 3) % TOPICS.length))
  if (shape === 5) {
    entries.push(spell(i, i % TOPICS.length), spell(i + 1, (i * 3) % TOPICS.length), spell(i + 2, (i * 5) % TOPICS.length))
  }
  if (shape === 6) entries.push(i % 14 === 6 ? `[[Missing ${i}]]` : `[[Note ${i - 1}]]`) // dangling / unflagged
  // shape === 0 leaves `entries` empty: the note declares nothing and lands in uncategorized().
  if (i % 23 === 0) entries.push(TOPICS[i % TOPICS.length], `see [[${TOPICS[i % TOPICS.length]}]] later`)
  if (i % 53 === 0) entries.push(i, null, { parent: spell(i, 0) })
  if (entries.length === 0) return rec(path, properties)
  // A scalar `folder_pages` is one entry, not nothing — a shape the real vault produces.
  properties.folder_pages = entries.length === 1 && i % 37 === 0 ? entries[0] : entries
  return rec(path, properties)
}

const snapshot = (): IndexRecord[] => {
  const records: IndexRecord[] = []
  for (let t = 0; t < TOPICS.length; t++) records.push(folderPageRecord(t))
  // One near-miss flag: `"true"` is a string, so this page is NOT a folder page and anything
  // naming it stays unparented — the strict-flag leg, measured rather than assumed.
  records.push(rec('/vault/Topics/Inbox.md', { folder_page: 'true' }))
  for (let i = records.length; i < PAGES; i++) records.push(noteRecord(i))
  return records
}

describe('folderPagesLookup perf (YAZ-827)', () => {
  it('builds the whole map for 1,000 pages under 25 ms', () => {
    const records = snapshot()
    expect(records).toHaveLength(PAGES)
    const resolve = resolverOver(records)
    // A NEW array each time or the WeakMap memo makes every run after the first free.
    folderPagesLookup(records.slice(), resolve) // warm-up (JIT)
    const fresh = records.slice() // sliced OUTSIDE the clock: only the build is timed
    const t0 = performance.now()
    const lookup = folderPagesLookup(fresh, resolve)
    const ms = performance.now() - t0

    // Sanity, so the fixture cannot quietly rot into a trivial one: every folder page really
    // holds members, and the uncategorized set is a real slice of the vault rather than all of it.
    const folderPages = records.filter((r) => lookup.isFolderPage(r))
    expect(folderPages).toHaveLength(TOPICS.length)
    for (const page of folderPages) expect(lookup.pagesIn(page.path).length).toBeGreaterThan(0)
    const loose = lookup.uncategorized().length
    expect(loose).toBeGreaterThan(PAGES / 10)
    expect(loose).toBeLessThan(PAGES / 2)

    // eslint-disable-next-line no-console
    console.log(`folderPages perf: ${PAGES} pages built in ${ms.toFixed(1)} ms (${loose} uncategorized)`)
    // Runs in the `perf` project, alone on an idle pool (YAZ-740), so this is a real budget:
    // ~1 ms measured, 25 ms allowed — half the bases engine's 50 ms, because every surface waits
    // on this map and it rebuilds on every index refresh.
    expect(ms).toBeLessThan(25)
  })
})
