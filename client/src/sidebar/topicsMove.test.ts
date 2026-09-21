/**
 * The Topics drag engine (YAZ-990): what a drop may do, and the ONE write that moves a page.
 * Each case pins a locked rule from the YAZ-959 scope: targets are flagged folder pages only;
 * self, the current parent and the child's own descendants are refused (the `guardedChildren`
 * law keeps a pre-existing loop from hanging the descent); and the move is a SINGLE
 * `folder_pages` write — old parent filtered out through the click rule, new parent appended —
 * because two `applyBelonging` calls against one stale snapshot would clobber each other.
 * Harness is folderPages.test.ts's (`rec`/`folder`/`belongs`/resolver map); `writeProperty` is
 * mocked like outlineSync.test.ts so every write is observable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { stripBrackets } from '../views/expr'
import { folderPagesLookup } from '../links/folderPages'

vi.mock('../views/writeProperty', () => ({ writeProperty: vi.fn() }))
vi.mock('../views/folderPageColumns', () => ({ backfillFolderPageColumns: vi.fn() }))
import { writeProperty } from '../views/writeProperty'
import { backfillFolderPageColumns } from '../views/folderPageColumns'
import { canDrop, performMove } from './topicsMove'

const write = vi.mocked(writeProperty)
const backfill = vi.mocked(backfillFolderPageColumns)

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
const folder = (path: string, properties: Record<string, unknown> = {}): IndexRecord =>
  rec(path, { folder_page: true, ...properties })
const belongs = (...entries: unknown[]): Record<string, unknown> => ({ folder_pages: entries })

const resolverOver = (records: readonly IndexRecord[]): ResolveLink => {
  const byBase = new Map(records.map((r) => [r.basename.toLowerCase(), r.path]))
  return (target) => byBase.get(stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()) ?? null
}

beforeEach(() => {
  write.mockReset()
  write.mockResolvedValue({ mtime: 2 })
  backfill.mockReset()
  backfill.mockResolvedValue()
})

describe('canDrop: the locked target rules (D4)', () => {
  const curriculum = folder('/vault/Curriculum.md')
  const fundamentals = folder('/vault/Fundamentals.md', belongs('[[Curriculum]]'))
  const note = rec('/vault/Note.md', belongs('[[Fundamentals]]'))
  const plain = rec('/vault/Plain.md')
  const records = [curriculum, fundamentals, note, plain]
  const lookup = folderPagesLookup(records, resolverOver(records))

  it('a page may drop onto an unrelated folder page', () => {
    expect(canDrop(note, curriculum, lookup)).toEqual({ ok: true })
  })

  it('a folder page may drop onto a folder page — folders move through the same door', () => {
    const other = folder('/vault/Other.md')
    const rs = [...records, other]
    expect(canDrop(fundamentals, other, folderPagesLookup(rs, resolverOver(rs)))).toEqual({ ok: true })
  })

  it('an uncategorized page may drop onto any folder page', () => {
    expect(canDrop(plain, fundamentals, lookup)).toEqual({ ok: true })
  })

  it('a plain page is never a target', () => {
    expect(canDrop(note, plain, lookup)).toEqual({ ok: false, reason: 'not-a-folder-page' })
  })

  it('a row is never its own target', () => {
    expect(canDrop(curriculum, curriculum, lookup)).toEqual({ ok: false, reason: 'self' })
  })

  it('the current parent is refused — the move would be a no-op', () => {
    expect(canDrop(note, fundamentals, lookup)).toEqual({ ok: false, reason: 'already-parent' })
    expect(canDrop(fundamentals, curriculum, lookup)).toEqual({ ok: false, reason: 'already-parent' })
  })

  it('one of several parents is still already-parent', () => {
    const both = rec('/vault/Both.md', belongs('[[Curriculum]]', '[[Fundamentals]]'))
    const rs = [...records, both]
    expect(canDrop(both, curriculum, folderPagesLookup(rs, resolverOver(rs)))).toEqual({ ok: false, reason: 'already-parent' })
  })

  it('a folder page cannot drop into its own child', () => {
    expect(canDrop(curriculum, fundamentals, lookup)).toEqual({ ok: false, reason: 'would-cycle' })
  })

  it('a folder page cannot drop into a deeper descendant', () => {
    const leaf = folder('/vault/Leaf.md', belongs('[[Fundamentals]]'))
    const rs = [...records, leaf]
    expect(canDrop(curriculum, leaf, folderPagesLookup(rs, resolverOver(rs)))).toEqual({ ok: false, reason: 'would-cycle' })
  })

  it('a descendant reachable down two branches is still caught', () => {
    const left = folder('/vault/Left.md', belongs('[[Top]]'))
    const right = folder('/vault/Right.md', belongs('[[Top]]'))
    const top = folder('/vault/Top.md')
    const goal = folder('/vault/Goal.md', belongs('[[Left]]', '[[Right]]'))
    const rs = [top, left, right, goal]
    expect(canDrop(top, goal, folderPagesLookup(rs, resolverOver(rs)))).toEqual({ ok: false, reason: 'would-cycle' })
  })

  it('a pre-existing loop below the child ends the descent quietly instead of hanging it', () => {
    const a = folder('/vault/A.md')
    const b = folder('/vault/B.md', belongs('[[A]]', '[[C]]'))
    const c = folder('/vault/C.md', belongs('[[B]]'))
    const island = folder('/vault/Island.md')
    const rs = [a, b, c, island]
    expect(canDrop(a, island, folderPagesLookup(rs, resolverOver(rs)))).toEqual({ ok: true })
  })
})

describe('performMove: one membership write, then closed-target reconciliation', () => {
  const FROM = folder('/vault/From.md')
  const TO = { path: '/vault/To.md', name: 'To', columns: { score: { kind: 'number' as const }, tags: { kind: 'list' as const } } }
  const records = [FROM, folder(TO.path)]
  const resolve = resolverOver(records)

  it('swaps the old parent for the new in a single folder_pages write', async () => {
    const page = rec('/vault/Page.md', belongs('[[From]]'))
    await performMove(page, FROM, TO, resolve)
    expect(write.mock.calls).toEqual([['/vault/Page.md', 'folder_pages', ['[[To]]']]])
    expect(backfill).toHaveBeenCalledExactlyOnceWith([page], TO.columns)
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(backfill.mock.invocationCallOrder[0]!)
  })

  it('other parents and non-counting prose survive verbatim, in place', async () => {
    const page = rec('/vault/Page.md', belongs('[[Other]]', 'see [[From]] daily', '[[From]]'))
    await performMove(page, FROM, TO, resolve)
    expect(write.mock.calls).toEqual([['/vault/Page.md', 'folder_pages', ['[[Other]]', 'see [[From]] daily', '[[To]]']]])
  })

  it('an entry spelling the old parent differently is still the old parent — resolver, not string compare', async () => {
    const page = rec('/vault/Page.md', belongs('  [[from]]  '))
    await performMove(page, FROM, TO, resolve)
    expect(write.mock.calls).toEqual([['/vault/Page.md', 'folder_pages', ['[[To]]']]])
  })

  it('null source means out of Uncategorized: nothing filtered, one entry gained', async () => {
    await performMove(rec('/vault/Page.md'), null, TO, resolve)
    expect(write.mock.calls).toEqual([['/vault/Page.md', 'folder_pages', ['[[To]]']]])
  })

  it('a list already naming the target gains no duplicate', async () => {
    const page = rec('/vault/Page.md', belongs('[[From]]', '[[To]]'))
    await performMove(page, FROM, TO, resolve)
    expect(write.mock.calls).toEqual([['/vault/Page.md', 'folder_pages', ['[[To]]']]])
  })

  it('nothing to change writes nothing', async () => {
    const page = rec('/vault/Page.md', belongs('[[To]]'))
    await performMove(page, null, TO, resolve)
    expect(write).not.toHaveBeenCalled()
    expect(backfill).toHaveBeenCalledExactlyOnceWith([page], TO.columns)
  })

  it('the source outline loses the line that named the page — its own settings, one write after the card (YAZ-1364, 🔒 D4)', async () => {
    const from = folder('/vault/From.md', {
      folder_page_settings: { views: [{ type: 'outline', name: 'Outline', outline: '- [[Page]]\n    - kept child\n- [[Other]]' }, { type: 'table', name: 'Table' }] },
    })
    const page = rec('/vault/Page.md', belongs('[[From]]'))
    await performMove(page, from, TO, resolverOver([from, page, rec(TO.path), rec('/vault/Other.md')]))
    expect(write.mock.calls[0]).toEqual(['/vault/Page.md', 'folder_pages', ['[[To]]']])
    expect(write.mock.calls[1]?.[0]).toBe('/vault/From.md')
    expect(write.mock.calls[1]?.[1]).toBe('folder_page_settings')
    expect((write.mock.calls[1]?.[2] as { views: { outline?: string }[] }).views[0].outline).toBe('    - kept child\n- [[Other]]')
    expect(write.mock.calls).toHaveLength(2)
  })

  it('a source whose outline does not name the page — or has no outline — writes only the card', async () => {
    const silent = folder('/vault/From.md', { folder_page_settings: { views: [{ type: 'outline', name: 'Outline', outline: '- see [[Page]] in prose' }] } })
    await performMove(rec('/vault/Page.md', belongs('[[From]]')), silent, TO, resolverOver([silent, rec('/vault/Page.md'), rec(TO.path)]))
    expect(write.mock.calls).toHaveLength(1)
    write.mockClear()
    await performMove(rec('/vault/Page.md', belongs('[[From]]')), FROM, TO, resolve)
    expect(write.mock.calls).toHaveLength(1)
  })

  it('keeps the successful membership write and rejects when closed-target reconciliation fails', async () => {
    const page = rec('/vault/Page.md', belongs('[[From]]'))
    backfill.mockRejectedValueOnce(new Error('Could not initialize 1 column value: Page.score'))

    await expect(performMove(page, FROM, TO, resolve)).rejects.toThrow('Page.score')

    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/Page.md', 'folder_pages', ['[[To]]'])
    expect(backfill).toHaveBeenCalledExactlyOnceWith([page], TO.columns)
  })
})
