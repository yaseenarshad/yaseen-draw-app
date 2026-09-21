/**
 * BELONGING AUTO-SYNC (YAZ-902, 🔒 E1): the outline is free-form, and a line that is exactly one
 * resolving wikilink is a BELONGING. Pinned here: two spellings of one page count ONCE, text and
 * dangling links count for nothing, the diff is between the last-written document and the new one,
 * tagging is idempotent through the RESOLVER (never a string compare), and un-tagging removes
 * exactly the entries that counted — prose spelling the name and other folder pages survive.
 *
 * Resolution is handed IN, keyed exactly like the real resolver (`makeResolver`, `views/engine.ts`),
 * same as outlineDoc.test.ts; `writeProperty` is mocked like OutlineView.test.tsx so every write is
 * observable and no disk is touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { stripBrackets } from './expr'

vi.mock('./writeProperty', () => ({ writeProperty: vi.fn() }))

import { writeProperty } from './writeProperty'
import { applyBelonging, diffOutlineBelonging, outlineLinkTargets, type FolderPageBelonging } from './outlineSync'

const write = vi.mocked(writeProperty)

// ---------- the vault ----------

/** Basename AND alias → path: an alias resolves like a click, so it counts as the same page. */
const BY_KEY = new Map([
  ['cac', '/vault/CAC.md'],
  ['acquisition cost', '/vault/CAC.md'],
  ['churn', '/vault/Churn.md'],
  ['ltv', '/vault/LTV.md'],
  ['sub note', '/vault/Sub Note.md'],
  ['metrics', '/vault/Metrics.md'],
])

/** Keyed like `makeResolver`: brackets stripped, any `#`/`|` tail dropped, trimmed, lowered. */
const resolve: ResolveLink = (target) =>
  BY_KEY.get(
    stripBrackets(target)
      .replace(/[#|].*$/, '')
      .trim()
      .toLowerCase(),
  ) ?? null

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: '',
    ext: 'md',
    size: 0,
    ctime: 0,
    mtime: 1,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const RECORDS: IndexRecord[] = [
  rec('/vault/CAC.md'),
  // Belongs somewhere else entirely: a tag must land BESIDE that, never on top of it.
  rec('/vault/Churn.md', { folder_pages: ['[[Other Hub]]'] }),
  rec('/vault/LTV.md', { folder_pages: ['[[Metrics]]'] }),
  // Already a member, spelled through an ALIAS — plus entries that never counted for anybody.
  rec('/vault/Sub Note.md', { folder_pages: ['[[acquisition cost]]', '[[metrics|the hub]]', 'Metrics', 'see [[Metrics]] below'] }),
  rec('/vault/Metrics.md', { folder_page: true }),
]

/** The folder page a belonging write is about — what YAZ-903's view holds in hand. */
const METRICS: FolderPageBelonging = { path: '/vault/Metrics.md', name: 'Metrics', records: RECORDS, resolve }

beforeEach(() => {
  write.mockReset()
  write.mockResolvedValue({ mtime: 2 })
})

// ---------- the reading ----------

describe('outlineLinkTargets: the pages an outline document names', () => {
  it('counts a page ONCE however many lines spell it, and however they spell it', () => {
    expect([...outlineLinkTargets('- [[CAC]]\n- [[cac]]\n    - [[CAC|nice name]]\n- [[acquisition cost]]\n', resolve)]).toEqual([
      '/vault/CAC.md',
    ])
  })

  it('prose, a mid-line link, a bare name and a dangling link are TEXT and name nobody', () => {
    expect([...outlineLinkTargets('- see [[CAC]] here\n- CAC\n- [[Gone]]\n\nloose prose\n- [[LTV]]\n', resolve)]).toEqual([
      '/vault/LTV.md',
    ])
  })

  it('reads at every depth, in document order; an empty document names nobody', () => {
    expect([...outlineLinkTargets('- [[LTV]]\n        - [[Sub Note]]\n- [[CAC]]\n', resolve)]).toEqual([
      '/vault/LTV.md',
      '/vault/Sub Note.md',
      '/vault/CAC.md',
    ])
    expect([...outlineLinkTargets('', resolve)]).toEqual([])
  })
})

// ---------- the diff ----------

describe('diffOutlineBelonging: against the LAST-WRITTEN outline', () => {
  it('a link line that appeared tags; one that vanished un-tags', () => {
    expect(diffOutlineBelonging('- [[CAC]]\n', '- [[CAC]]\n- [[LTV]]\n', resolve)).toEqual({
      tag: ['/vault/LTV.md'],
      untag: [],
    })
    expect(diffOutlineBelonging('- [[CAC]]\n- [[LTV]]\n', '- [[CAC]]\n', resolve)).toEqual({
      tag: [],
      untag: ['/vault/LTV.md'],
    })
  })

  it('a reorder, a re-spelling, a new depth and edited prose change NOTHING', () => {
    const prev = '- [[CAC]]\n- [[LTV]]\n- notes\n'
    const next = '- [[ltv|nice name]]\n    - [[CAC#Heading]]\n- different notes\n- [[Gone]]\n'
    expect(diffOutlineBelonging(prev, next, resolve)).toEqual({ tag: [], untag: [] })
  })

  it('a link turned into prose un-tags, and prose turned into a link tags', () => {
    expect(diffOutlineBelonging('- [[CAC]]\n', '- see [[CAC]] later\n- [[LTV]]\n', resolve)).toEqual({
      tag: ['/vault/LTV.md'],
      untag: ['/vault/CAC.md'],
    })
  })

  it('an outline emptied of links un-tags everyone; an empty one filled tags everyone, in order', () => {
    expect(diffOutlineBelonging('- [[CAC]]\n- [[LTV]]\n', '', resolve)).toEqual({
      tag: [],
      untag: ['/vault/CAC.md', '/vault/LTV.md'],
    })
    expect(diffOutlineBelonging('', '- [[LTV]]\n- [[CAC]]\n', resolve)).toEqual({
      tag: ['/vault/LTV.md', '/vault/CAC.md'],
      untag: [],
    })
  })
})

// ---------- the writes ----------

describe('applyBelonging tag: one key on the MEMBER, appended', () => {
  it('appends [[folder page]] and keeps every entry that was there', async () => {
    await applyBelonging(['/vault/Churn.md'], METRICS, 'tag')
    expect(write.mock.calls).toEqual([['/vault/Churn.md', 'folder_pages', ['[[Other Hub]]', '[[Metrics]]']]])
  })

  it('starts the list when the page has no folder_pages at all', async () => {
    await applyBelonging(['/vault/CAC.md'], METRICS, 'tag')
    expect(write.mock.calls).toEqual([['/vault/CAC.md', 'folder_pages', ['[[Metrics]]']]])
  })

  it('is idempotent, and idempotent through the RESOLVER: an alias spelling is already a belonging', async () => {
    await applyBelonging(['/vault/LTV.md', '/vault/Sub Note.md'], METRICS, 'tag')
    expect(write).not.toHaveBeenCalled()
  })

  it('writes once per path, and skips a path that is not in the snapshot', async () => {
    await applyBelonging(['/vault/CAC.md', '/vault/Ghost.md', '/vault/Churn.md'], METRICS, 'tag')
    expect(write.mock.calls.map((call) => call[0])).toEqual(['/vault/CAC.md', '/vault/Churn.md'])
  })
})

describe('applyBelonging untag: exactly the entries that counted', () => {
  it('removes the entry that resolves here and leaves prose, bare names and other folder pages alone', async () => {
    await applyBelonging(['/vault/Sub Note.md'], METRICS, 'untag')
    expect(write.mock.calls).toEqual([
      ['/vault/Sub Note.md', 'folder_pages', ['[[acquisition cost]]', 'Metrics', 'see [[Metrics]] below']],
    ])
  })

  it('empties the list when this folder page was the only entry', async () => {
    await applyBelonging(['/vault/LTV.md'], METRICS, 'untag')
    expect(write.mock.calls).toEqual([['/vault/LTV.md', 'folder_pages', []]])
  })

  it('writes nothing when no entry counted for this folder page', async () => {
    await applyBelonging(['/vault/CAC.md'], METRICS, 'untag')
    expect(write).not.toHaveBeenCalled()
  })

  it('propagates a write failure — the caller owns the banner', async () => {
    write.mockRejectedValueOnce(new Error('disk is full'))
    await expect(applyBelonging(['/vault/LTV.md'], METRICS, 'untag')).rejects.toThrow('disk is full')
  })
})
