/**
 * Folder pages (YAZ-825): the lookup over an index snapshot. Each case pins ONE locked rule —
 * the click rule (exactly a wikilink, resolved, flagged), dedupe, the strict `folder_page: true`
 * flag, and the carve-out-free uncategorized set. Resolution is handed IN, so the resolver used
 * here is a basename map keyed exactly like the real one (`makeResolver`, `views/engine.ts`).
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { stripBrackets } from '../views/expr'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { belongsToBasenames, folderPagesLookup, guardedChildren, isFolderPage } from './folderPages'

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

/** A page carrying the flag. */
const folder = (path: string, properties: Record<string, unknown> = {}): IndexRecord =>
  rec(path, { folder_page: true, ...properties })

/** The frontmatter a note declares its parents with. */
const belongs = (...entries: unknown[]): Record<string, unknown> => ({ folder_pages: entries })

/** Basename → path, keyed like `makeResolver`: `stripBrackets`, `#`/`|` tail dropped, trimmed, lowered. */
const resolverOver = (records: readonly IndexRecord[]): ResolveLink => {
  const byBase = new Map(records.map((r) => [r.basename.toLowerCase(), r.path]))
  return (target) => byBase.get(stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()) ?? null
}

const lookupOver = (records: readonly IndexRecord[]) => folderPagesLookup(records, resolverOver(records))

const METRICS = '/vault/Metrics.md'

describe('the click rule (YAZ-825): exactly a wikilink, resolved, flagged', () => {
  it('counts an entry only when it is a string that is EXACTLY a wikilink after trim', () => {
    const records = [
      rec('/vault/Bare.md', belongs('Metrics')),
      rec('/vault/Exact.md', belongs('[[Metrics]]')),
      rec('/vault/NotAString.md', belongs(42, null)),
      rec('/vault/Padded.md', belongs('  [[Metrics]]  ')),
      rec('/vault/Prose.md', belongs('see [[Metrics]] now')),
      folder(METRICS),
    ]
    expect(lookupOver(records).pagesIn(METRICS).map((r) => r.path)).toEqual(['/vault/Exact.md', '/vault/Padded.md'])
  })

  it('counts through the resolver: a lower-cased spelling and a piped one both land on the page', () => {
    const records = [
      rec('/vault/Cased.md', belongs('[[metrics]]')),
      rec('/vault/Piped.md', belongs('[[Metrics|nice name]]')),
      folder(METRICS),
    ]
    expect(lookupOver(records).pagesIn(METRICS).map((r) => r.path)).toEqual(['/vault/Cased.md', '/vault/Piped.md'])
  })

  it('two spellings of ONE page count once', () => {
    const records = [rec('/vault/A.md', belongs('[[metrics]]', '[[Metrics]]', '[[Metrics|again]]')), folder(METRICS)]
    const lookup = lookupOver(records)
    expect(lookup.pagesIn(METRICS).map((r) => r.path)).toEqual(['/vault/A.md'])
    expect(lookup.folderPagesOf('/vault/A.md')).toEqual([METRICS])
  })

  it('an entry resolving to nothing, or to a page WITHOUT the flag, counts as nothing', () => {
    const records = [
      rec('/vault/Dangling.md', belongs('[[Missing]]')),
      rec('/vault/Member.md', belongs('[[Metrics]]')),
      rec('/vault/Plain.md'),
      rec('/vault/Unflagged.md', belongs('[[Plain]]')),
      folder(METRICS),
    ]
    const lookup = lookupOver(records)
    expect(lookup.folderPagesOf('/vault/Dangling.md')).toEqual([])
    expect(lookup.folderPagesOf('/vault/Unflagged.md')).toEqual([])
    expect(lookup.pagesIn('/vault/Plain.md')).toEqual([])
    expect(lookup.folderPagesOf('/vault/Member.md')).toEqual([METRICS])
  })

  it('the same entry counts once the target gains the flag in a NEW snapshot', () => {
    const before = [rec('/vault/A.md', belongs('[[Metrics]]')), rec(METRICS)]
    expect(lookupOver(before).folderPagesOf('/vault/A.md')).toEqual([])
    const after = [rec('/vault/A.md', belongs('[[Metrics]]')), folder(METRICS)]
    expect(lookupOver(after).folderPagesOf('/vault/A.md')).toEqual([METRICS])
    expect(lookupOver(after).pagesIn(METRICS).map((r) => r.path)).toEqual(['/vault/A.md'])
  })
})

describe('isFolderPage', () => {
  it('ONLY the boolean true declares a folder page', () => {
    expect(isFolderPage(rec('/vault/A.md', { folder_page: true }))).toBe(true)
    expect(isFolderPage(rec('/vault/A.md', { folder_page: 'true' }))).toBe(false)
    expect(isFolderPage(rec('/vault/A.md', { folder_page: 1 }))).toBe(false)
    expect(isFolderPage(rec('/vault/A.md', { folder_page: {} }))).toBe(false)
    expect(isFolderPage(rec('/vault/A.md'))).toBe(false)
  })

  it('the lookup answers the same question as the free function', () => {
    const records = [folder(METRICS), rec('/vault/A.md')]
    const lookup = lookupOver(records)
    expect(lookup.isFolderPage(records[0])).toBe(true)
    expect(lookup.isFolderPage(records[1])).toBe(false)
  })
})

describe('pagesIn / folderPagesOf', () => {
  it('lists the members path-sorted, whatever the input order', () => {
    const records = [
      rec('/vault/Zeta.md', belongs('[[Metrics]]')),
      rec('/vault/Alpha.md', belongs('[[Metrics]]')),
      folder(METRICS),
      rec('/vault/Sub/Mid.md', belongs('[[Metrics]]')),
    ]
    expect(lookupOver(records).pagesIn(METRICS).map((r) => r.path)).toEqual([
      '/vault/Alpha.md',
      '/vault/Sub/Mid.md',
      '/vault/Zeta.md',
    ])
  })

  it('an unknown path, or a page that is not a folder page, holds nobody', () => {
    const records = [rec('/vault/A.md', belongs('[[Metrics]]')), folder(METRICS)]
    const lookup = lookupOver(records)
    expect(lookup.pagesIn('/vault/Nowhere.md')).toEqual([])
    expect(lookup.pagesIn('/vault/A.md')).toEqual([])
  })

  it('folderPagesOf answers the resolved flagged targets, and only those', () => {
    const records = [
      rec('/vault/A.md', belongs('[[Metrics]]', '[[Missing]]', 'Costs', '[[Costs]]')),
      folder('/vault/Costs.md'),
      folder(METRICS),
    ]
    const lookup = lookupOver(records)
    expect(lookup.folderPagesOf('/vault/A.md')).toEqual([METRICS, '/vault/Costs.md'])
    expect(lookup.folderPagesOf('/vault/Nowhere.md')).toEqual([])
  })
})

describe('uncategorized', () => {
  it('holds every record with zero counting entries — folder pages included, no carve-outs', () => {
    const records = [
      rec('/vault/Alone.md'),
      rec('/vault/Member.md', belongs('[[Metrics]]')),
      folder(METRICS),
      folder('/vault/Nested.md', belongs('[[Metrics]]')),
      rec('/vault/Waiting.md', belongs('[[Missing]]', 'Metrics')),
    ]
    expect(lookupOver(records).uncategorized().map((r) => r.path)).toEqual([
      '/vault/Alone.md',
      METRICS,
      '/vault/Waiting.md',
    ])
  })
})

describe('caching', () => {
  it('memoizes per records-array IDENTITY: one snapshot, one lookup', () => {
    const records = [rec('/vault/A.md', belongs('[[Metrics]]')), folder(METRICS)]
    const resolve = resolverOver(records)
    expect(folderPagesLookup(records, resolve)).toBe(folderPagesLookup(records, resolve))
    const refetched = [...records] // same contents, NEW array: a fresh build (that IS the live update)
    expect(folderPagesLookup(refetched, resolve)).not.toBe(folderPagesLookup(records, resolve))
    expect(folderPagesLookup(refetched, resolve).pagesIn(METRICS).map((r) => r.path)).toEqual(['/vault/A.md'])
  })
})

describe('robustness', () => {
  it('a scalar folder_pages counts as ONE entry (the indexer tolerance); a mapping declares nothing', () => {
    const records = [
      folder(METRICS),
      rec('/vault/Obj.md', { folder_pages: { parent: '[[Metrics]]' } }),
      rec('/vault/Str.md', { folder_pages: '[[Metrics]]' }),
    ]
    const lookup = lookupOver(records)
    expect(lookup.pagesIn(METRICS).map((r) => r.path)).toEqual(['/vault/Str.md'])
    expect(lookup.folderPagesOf('/vault/Str.md')).toEqual([METRICS])
    expect(lookup.uncategorized().map((r) => r.path)).toEqual([METRICS, '/vault/Obj.md'])
  })

  it('records holding neither key pass through the build untouched', () => {
    const records = [rec('/vault/A.md'), rec('/vault/B.md', { title: 'B' })]
    const lookup = lookupOver(records)
    expect(lookup.uncategorized()).toHaveLength(2)
    expect(lookup.folderPagesOf('/vault/A.md')).toEqual([])
    expect(lookup.pagesIn('/vault/B.md')).toEqual([])
  })
})

// TOMBSTONE (⚡ YAZ-814): a `walkFolderPage` describe stood here — the linear walk's own loop
// guard, ordering and depth. The function is gone (no surface ever called it), and the guard
// semantics it pinned live on in full: A↔B termination and the self-skip below, the
// diamond-under-both in `TopicsTree.test.tsx` and `OutlineView.test.tsx` — the two real descents.

describe('guardedChildren (⚡ D6 amendment): the one door to a descent', () => {
  it('hands back the members minus anyone on the ancestor path — path-scoped, not a visited set', () => {
    const records = [
      folder('/vault/Marketing.md', belongs('[[Metrics]]')),
      rec('/vault/CAC.md', belongs('[[Metrics]]')),
      folder(METRICS, belongs('[[Marketing]]')), // the loop: Metrics ↔ Marketing
    ]
    const lookup = lookupOver(records)
    expect(guardedChildren(lookup, METRICS, [METRICS]).map((r) => r.path)).toEqual(['/vault/CAC.md', '/vault/Marketing.md'])
    // Descending into Marketing: Metrics stands above, so the loop branch is simply not offered.
    expect(guardedChildren(lookup, '/vault/Marketing.md', [METRICS, '/vault/Marketing.md']).map((r) => r.path)).toEqual([])
    // A different path with no Metrics above sees it fine — the guard is the PATH, not history.
    expect(guardedChildren(lookup, '/vault/Marketing.md', ['/vault/Marketing.md']).map((r) => r.path)).toEqual([METRICS])
  })

  it('a page listing itself is never offered as its own child', () => {
    const records = [folder('/vault/Ouro.md', belongs('[[Ouro]]'))]
    expect(guardedChildren(lookupOver(records), '/vault/Ouro.md', ['/vault/Ouro.md'])).toEqual([])
  })
})

describe('belongsToBasenames (YAZ-831): the belongs-to picker', () => {
  it('narrows to the pages in the named folder page, resolved like a click', () => {
    const records = [
      rec('/vault/CAC.md', belongs('[[Metrics]]')),
      rec('/vault/LTV.md', belongs('[[metrics]]')),
      rec('/vault/Elsewhere.md'),
      folder(METRICS),
    ]
    expect(belongsToBasenames(records, resolverOver(records), '[[metrics]]')).toEqual(['CAC', 'LTV'])
  })

  it('falls back to ALL basenames when the target is unresolved, empty, or not a folder page', () => {
    const records = [rec('/vault/A.md'), folder(METRICS)]
    const resolve = resolverOver(records)
    const all = ['A', 'Metrics']
    expect(belongsToBasenames(records, resolve, '[[Missing]]')).toEqual(all)
    expect(belongsToBasenames(records, resolve, '[[Metrics]]')).toEqual(all) // flagged, holds nobody
    expect(belongsToBasenames(records, resolve, '[[A]]')).toEqual(all) // an ordinary page
  })
})
