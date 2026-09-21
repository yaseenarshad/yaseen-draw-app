/**
 * Delete column (YAZ-1513): the declaration goes, every view reference goes, the label goes — ONE
 * settings write through the host's door — and the key is stripped from every direct member that
 * carries it, byte-preserving everything else. Members without the key are never written; a note
 * whose frontmatter will not parse is reported, never rewritten; built-in keys are refused before
 * anything is touched. `transformFile` is stubbed over an in-memory disk so the strips are real
 * `setFrontmatterProperty` rewrites.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { FilterNode, ViewDef, ViewSet } from './viewSchema'

/** The in-memory vault the strips rewrite: path → content. */
const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }))
vi.mock('./writeProperty', () => ({
  transformFile: vi.fn(async (path: string, transform: (content: string) => string) => {
    const before = disk.get(path)
    if (before === undefined) throw new Error(`ENOENT: ${path}`)
    const after = transform(before)
    if (after !== before) disk.set(path, after)
    return { mtime: 1, content: after }
  }),
}))
import { transformFile } from './writeProperty'
import { deleteColumn, filterMentions, membersCarrying, pruneColumnFromViews, pruneColumnLabel, pruneFilter, undeletableReason, type DeleteColumnHost } from './deleteColumn'

const rec = (path: string, properties: Record<string, unknown>): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases: [], tags: [], links: [], embeds: [] }
}

const A = '/vault/a.md'
const B = '/vault/b.md'
const C = '/vault/c.md'
const BROKEN = '/vault/broken.md'

const TABLE: ViewDef = {
  type: 'table',
  name: 'T',
  order: ['file.name', 'note.status', 'note.owner'],
  frozenColumns: 3,
  sort: [{ property: 'note.status', direction: 'ASC' }, { property: 'file.name', direction: 'DESC' }],
  groupBy: { property: 'status' },
  summaries: { 'note.status': 'Count', 'note.owner': 'Count' },
  columnSize: { 'note.status': 120 },
}
const BOARD: ViewDef = { type: 'board', name: 'B', order: ['file.name', 'status'], groupBy: [{ property: 'note.status' }, { property: 'note.owner' }], cardStyle: { 'note.status': { bold: true } } }
const OUTLINE: ViewDef = { type: 'outline', name: 'O', order: ['[[a]]', '[[b]]'] }

beforeEach(() => {
  disk.clear()
  disk.set(A, '---\n# a comment\ntitle: A\nstatus: 2-Todo\nowner: "[[Sam]]"\n---\n\nbody a\n')
  disk.set(B, '---\ntitle: B\nowner: "[[Kim]]"\n---\n')
  disk.set(C, '---\nstatus: 1-Backlog\n---\nbody c\n')
  disk.set(BROKEN, '---\nstatus: [unclosed\n---\n')
  vi.mocked(transformFile).mockClear()
})

const host = (over: Partial<DeleteColumnHost> = {}): DeleteColumnHost => ({
  columns: { status: { kind: 'select', options: ['1-Backlog', '2-Todo'] }, owner: { kind: 'link' } },
  def: { views: [TABLE, BOARD, OUTLINE], properties: { status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } } } as ViewSet,
  members: [rec(A, { title: 'A', status: '2-Todo', owner: '[[Sam]]' }), rec(B, { title: 'B', owner: '[[Kim]]' }), rec(C, { status: '1-Backlog' })],
  writeSettings: vi.fn(async () => {}),
  ...over,
})

describe('undeletableReason: built-in keys are hidden, never deleted', () => {
  it('refuses file.*, formula.* and the reserved keys with the one tooltip; a plain note key may go', () => {
    for (const key of ['file.name', 'file.mtime', 'formula.score', 'note.folder_page', 'folder_pages', 'note.folder_pages', 'note.folder_page_settings', 'comments']) {
      expect(undeletableReason(key)).toBe('Built-in column — hide it instead')
    }
    expect(undeletableReason('note.status')).toBeNull()
    expect(undeletableReason('status')).toBeNull()
  })
})

describe('the pure pruners', () => {
  it('pruneColumnFromViews drops the key from order / sort / groupBy / summaries / columnSize / cardStyle, clamps frozenColumns, and leaves untouched views as the same object', () => {
    const [table, board, outline] = pruneColumnFromViews([TABLE, BOARD, OUTLINE], 'status')
    expect(table).toEqual({
      type: 'table',
      name: 'T',
      order: ['file.name', 'note.owner'],
      frozenColumns: 2,
      sort: [{ property: 'file.name', direction: 'DESC' }],
      summaries: { 'note.owner': 'Count' },
    })
    expect(board).toEqual({ type: 'board', name: 'B', order: ['file.name'], groupBy: [{ property: 'note.owner' }] })
    expect(outline).toBe(OUTLINE) // an outline's order is wikilinks: nothing there names a column
    // the inputs are never mutated
    expect(TABLE.order).toEqual(['file.name', 'note.status', 'note.owner'])
  })

  it('a single-object groupBy on the key deletes the key; an array groupBy keeps its array form', () => {
    expect(pruneColumnFromViews([{ type: 'table', name: 'T', groupBy: { property: 'note.x' } }], 'x')[0].groupBy).toBeUndefined()
    expect(pruneColumnFromViews([{ type: 'table', name: 'T', groupBy: [{ property: 'note.x' }, { property: 'note.y' }] }], 'x')[0].groupBy).toEqual([{ property: 'note.y' }])
  })

  it('prunes a cards `image` that names the key, and leaves one that names another', () => {
    expect(pruneColumnFromViews([{ type: 'cards', name: 'C', image: 'note.status' }], 'status')[0]).toEqual({ type: 'cards', name: 'C' })
    const other: ViewDef = { type: 'cards', name: 'C', image: 'note.cover' }
    expect(pruneColumnFromViews([other], 'status')[0]).toBe(other)
  })

  it('filterMentions: the identifier `note.<key>` or the bare key as a whole token, outside string literals', () => {
    expect(filterMentions('note.status == "idea"', 'status')).toBe(true)
    expect(filterMentions('status == "idea"', 'note.status')).toBe(true)
    expect(filterMentions('note.status_2 == 1', 'status')).toBe(false) // a longer identifier
    expect(filterMentions('note.substatus == 1', 'status')).toBe(false)
    expect(filterMentions('file.status == 1', 'status')).toBe(false) // another namespace
    expect(filterMentions('note.title == "status"', 'status')).toBe(false) // inside a string literal
    expect(filterMentions("note.title == 'note.status'", 'status')).toBe(false)
    expect(filterMentions('note.title == "a \\" status" && note.status', 'status')).toBe(true) // an escaped quote does not end the literal
  })

  it('pruneFilter: a leaf goes, a nested node loses only that leaf, an emptied node goes with it, other keys stay, the same node returns when untouched', () => {
    expect(pruneFilter('note.status == "x"', 'status')).toBeUndefined()
    const nested: FilterNode = { and: ['note.owner == "[[Sam]]"', { or: ['note.status == "a"', 'note.status == "b"'] }, { not: ['note.status == "c"'] }] }
    expect(pruneFilter(nested, 'status')).toEqual({ and: ['note.owner == "[[Sam]]"'] })
    const untouched: FilterNode = { and: ['note.owner == "[[Sam]]"', 'note.title == "status"'] }
    expect(pruneFilter(untouched, 'status')).toBe(untouched)
    // through the views: a fully pruned filter loses the key
    const [pruned] = pruneColumnFromViews([{ type: 'table', name: 'T', filters: { or: ['status == 1', 'note.status == 2'] } }], 'status')
    expect(pruned).toEqual({ type: 'table', name: 'T' })
    const [kept] = pruneColumnFromViews([{ type: 'table', name: 'T', filters: nested }], 'status')
    expect(kept.filters).toEqual({ and: ['note.owner == "[[Sam]]"'] })
  })

  it('pruneColumnLabel drops the entry under any spelling and deletes an emptied map', () => {
    expect(pruneColumnLabel({ status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } }, 'note.status')).toEqual({ 'note.owner': { displayName: 'Who' } })
    expect(pruneColumnLabel({ 'note.status': { displayName: 'Stage' } }, 'status')).toBeUndefined()
    expect(pruneColumnLabel(undefined, 'status')).toBeUndefined()
  })

  it('membersCarrying counts the direct members whose card holds the exact key', () => {
    expect(membersCarrying(host().members, 'note.status').map((m) => m.basename)).toEqual(['a', 'c'])
    expect(membersCarrying(host().members, 'owner').map((m) => m.basename)).toEqual(['a', 'b'])
  })
})

describe('deleteColumn', () => {
  it('writes the settings ONCE — declaration gone, references pruned, label gone — then strips the key from the carrying members, byte-preserving every other key', async () => {
    const h = host()
    await deleteColumn('note.status', h)
    expect(h.writeSettings).toHaveBeenCalledExactlyOnceWith(
      { owner: { kind: 'link' } },
      pruneColumnFromViews([TABLE, BOARD, OUTLINE], 'status'),
      { 'note.owner': { displayName: 'Who' } },
    )
    expect(disk.get(A)).toBe('---\n# a comment\ntitle: A\nowner: "[[Sam]]"\n---\n\nbody a\n')
    expect(disk.get(C)).toBe('---\n---\nbody c\n')
    // a member without the key is never even read
    expect(disk.get(B)).toBe('---\ntitle: B\nowner: "[[Kim]]"\n---\n')
    expect(vi.mocked(transformFile).mock.calls.map(([path]) => path)).toEqual([A, C])
  })

  it('settings land BEFORE the first strip — the source of truth first, so the presence invariant cannot re-add the key meanwhile', async () => {
    const order: string[] = []
    const h = host({ writeSettings: vi.fn(async () => void order.push('settings')) })
    vi.mocked(transformFile).mockImplementationOnce(async (path, transform) => {
      order.push('strip')
      disk.set(path, transform(disk.get(path)!))
      return { mtime: 1, content: disk.get(path)! }
    })
    await deleteColumn('status', h)
    expect(order[0]).toBe('settings')
    expect(order).toContain('strip')
  })

  it('a note whose frontmatter will not parse is reported, not written; the others still commit (no rollback)', async () => {
    const h = host({ members: [...host().members, rec(BROKEN, { status: 'x' })] })
    await expect(deleteColumn('status', h)).rejects.toThrow(/Could not remove "status" from 1 note: broken \(frontmatter is not valid YAML/)
    expect(disk.get(BROKEN)).toBe('---\nstatus: [unclosed\n---\n')
    expect(disk.get(A)).not.toContain('status:')
    expect(disk.get(C)).not.toContain('status:')
    expect(h.writeSettings).toHaveBeenCalledTimes(1)
  })

  it('a record that claims the key but whose disk no longer has it is read and left alone', async () => {
    disk.set(C, '---\ntitle: C\n---\n')
    const h = host()
    await deleteColumn('status', h)
    expect(disk.get(C)).toBe('---\ntitle: C\n---\n')
  })

  it('refuses a built-in key before touching anything', async () => {
    const h = host()
    await expect(deleteColumn('file.name', h)).rejects.toThrow("Can't delete file.name: built-in column — hide it instead")
    await expect(deleteColumn('folder_pages', h)).rejects.toThrow(/built-in column/)
    expect(h.writeSettings).not.toHaveBeenCalled()
    expect(transformFile).not.toHaveBeenCalled()
  })

  it('a REFUSED settings write aborts: the error surfaces and not one member is touched (YAZ-1549)', async () => {
    const h = host({ writeSettings: vi.fn(async () => { throw new Error('disk full') }) })
    await expect(deleteColumn('status', h)).rejects.toThrow('disk full')
    expect(transformFile).not.toHaveBeenCalled()
    expect(disk.get(A)).toContain('status: 2-Todo')
  })

  it('a key with no declaration and no references still strips the members and writes the settings unchanged in shape', async () => {
    const h = host({ columns: {}, def: { views: [{ type: 'table', name: 'T' }] } })
    await deleteColumn('owner', h)
    expect(h.writeSettings).toHaveBeenCalledExactlyOnceWith({}, [{ type: 'table', name: 'T' }], undefined)
    expect(disk.get(A)).toBe('---\n# a comment\ntitle: A\nstatus: 2-Todo\n---\n\nbody a\n')
    expect(disk.get(B)).toBe('---\ntitle: B\n---\n')
  })
})
