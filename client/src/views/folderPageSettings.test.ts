/**
 * Folder page settings (YAZ-830): the ONE door to `folder_page_settings`. Each case pins a
 * locked rule — tolerant parsing (report, never block, never throw), DEFAULT_VIEWS outline-first,
 * the 7 property kinds, parseViews's own view assertion mirrored, the `FOLDER_NAME` parking
 * bin, and the [D5] ordering rule. Resolution is handed IN, keyed exactly like the real resolver
 * (`makeResolver`, `views/engine.ts`), same as folderPages.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { stripBrackets } from './expr'

/** `transformFile`'s stand-in: the file the ONE label write reads and rewrites (YAZ-1513). */
const { disk } = vi.hoisted(() => ({ disk: { content: '' } }))
vi.mock('./writeProperty', () => ({
  writeProperty: vi.fn(),
  transformFile: vi.fn(async (_path: string, transform: (content: string) => string) => {
    disk.content = transform(disk.content)
    return { mtime: 1, content: disk.content }
  }),
}))
import { writeProperty } from './writeProperty'
import {
  columnKindIn,
  DEFAULT_COLUMNS,
  DEFAULT_VIEWS,
  folderPageSettings,
  newFolderPageProperties,
  orderedMembers,
  outlineOrderOf,
  bornFolderPage,
  turnIntoFolderPage,
  writeFolderPageSettings,
} from './folderPageSettings'

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

const METRICS = '/vault/Metrics.md'

/** A flagged folder page carrying this settings value, parsed. */
const settingsOf = (value: unknown) =>
  folderPageSettings(rec(METRICS, { folder_page: true, folder_page_settings: value }))

/** Basename → path, keyed like `makeResolver`: `stripBrackets`, `#`/`|` tail dropped, trimmed, lowered. */
const resolverOver = (records: readonly IndexRecord[]): ResolveLink => {
  const byBase = new Map(records.map((r) => [r.basename.toLowerCase(), r.path]))
  return (target) => byBase.get(stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()) ?? null
}

const OUTLINE_TABLE_BOARD = [
  { type: 'outline', name: 'Outline' },
  { type: 'table', name: 'Table' },
  { type: 'board', name: 'Board' },
]

describe('defaults (Q7, amended YAZ-935): a page that lists NO views gets its three skins, outline first', () => {
  it('a page with NO settings key renders with defaults and zero problems', () => {
    const settings = folderPageSettings(rec(METRICS, { folder_page: true }))
    expect(settings.views).toEqual(OUTLINE_TABLE_BOARD)
    expect(settings.columns).toEqual({})
    expect(settings.folder).toBeUndefined()
    expect(settings.problems).toEqual([])
  })

  it('DEFAULT_VIEWS is still three, outline first, and each parse hands back its own copy', () => {
    expect(DEFAULT_VIEWS).toHaveLength(3)
    expect(DEFAULT_VIEWS.map((v) => v.type)).toEqual(['outline', 'table', 'board'])
    const a = folderPageSettings(rec(METRICS, { folder_page: true }))
    const b = folderPageSettings(rec(METRICS, { folder_page: true }))
    expect(a.views).not.toBe(b.views)
    expect(a.views[0]).not.toBe(b.views[0])
  })

  it.each([
    ['a string', 'table'],
    ['a number', 3],
    ['a list', [{ type: 'table', name: 'Table' }]],
  ])('a settings key that is %s is ONE problem plus full defaults', (_label, value) => {
    const settings = settingsOf(value)
    expect(settings.problems).toHaveLength(1)
    expect(settings.views).toEqual(OUTLINE_TABLE_BOARD)
    expect(settings.columns).toEqual({})
    expect(settings.folder).toBeUndefined()
  })
})

describe("columns: the 7 property kinds, report-don't-block", () => {
  it('parses declared columns, keeping kind, target and a boolean required', () => {
    const settings = settingsOf({
      columns: {
        owner: { kind: 'text' },
        kpis: { kind: 'multi-link', target: '[[KPIs]]' },
        due: { kind: 'date', required: true },
      },
    })
    expect(settings.columns).toEqual({
      owner: { kind: 'text' },
      kpis: { kind: 'multi-link', target: '[[KPIs]]' },
      due: { kind: 'date', required: true },
    })
    expect(settings.problems).toEqual([])
  })

  it('an unknown kind is a problem and the column is treated as ABSENT', () => {
    const settings = settingsOf({ columns: { owner: { kind: 'text' }, weird: { kind: 'rating' } } })
    expect(Object.keys(settings.columns)).toEqual(['owner'])
    expect(settings.problems).toHaveLength(1)
    expect(settings.problems[0]).toContain('weird')
  })

  it('a non-map column value is a problem and the column is absent', () => {
    const settings = settingsOf({ columns: { owner: 'text', nope: null } })
    expect(settings.columns).toEqual({})
    expect(settings.problems).toHaveLength(2)
  })

  it('a non-boolean required is a problem and only that key is dropped — the column stays', () => {
    const settings = settingsOf({ columns: { owner: { kind: 'text', required: 'yes' } } })
    expect(settings.columns).toEqual({ owner: { kind: 'text' } })
    expect(settings.problems).toHaveLength(1)
    expect(settings.problems[0]).toContain('required')
  })

  it('a non-map columns value is a problem and no columns are declared', () => {
    const settings = settingsOf({ columns: ['owner'] })
    expect(settings.columns).toEqual({})
    expect(settings.problems).toHaveLength(1)
  })
})

describe('views: parseViews\'s own assertion, mirrored', () => {
  it('keeps view order, and unknown types and extra keys pass through untouched', () => {
    const settings = settingsOf({
      views: [
        { type: 'outline', name: 'Outline', order: ['[[CAC]]', '[[LTV]]'] },
        { type: 'gantt', name: 'Table', columnSize: { owner: 120 }, zoom: 3 },
      ],
    })
    expect(settings.views).toEqual([
      { type: 'outline', name: 'Outline', order: ['[[CAC]]', '[[LTV]]'] },
      { type: 'gantt', name: 'Table', columnSize: { owner: 120 }, zoom: 3 },
    ])
    expect(settings.views[1].zoom).toBe(3)
    expect(settings.problems).toEqual([])
  })

  it('an entry missing name (or type, or not a map) is dropped with a problem; the rest survive', () => {
    const settings = settingsOf({
      views: [{ type: 'outline' }, { type: 'table', name: 'Table' }, 'table', { name: 'Nameless' }],
    })
    expect(settings.views).toEqual([{ type: 'table', name: 'Table' }])
    expect(settings.problems).toHaveLength(3)
  })

  it('a persisted list WITHOUT a board reads back without one — what the card says is what you get (YAZ-1471)', () => {
    const settings = settingsOf({ views: [{ type: 'table', name: 'My table' }] })
    expect(settings.views).toEqual([{ type: 'table', name: 'My table' }])
    expect(settings.problems).toEqual([])
  })

  it('a persisted list WITH a board — whatever its name — passes through untouched', () => {
    const views = [
      { type: 'board', name: 'Kanban', groupBy: { property: 'note.status' } },
      { type: 'table', name: 'Table' },
    ]
    const settings = settingsOf({ views })
    expect(settings.views).toEqual(views)
    expect(settings.problems).toEqual([])
  })

  it('a string outline rides along verbatim (🔒 D2: the view IS its markdown bullet list)', () => {
    const settings = settingsOf({ views: [{ type: 'outline', name: 'Outline', outline: '- [[CAC]]\n    - [[LTV]]' }] })
    expect(settings.views).toEqual([{ type: 'outline', name: 'Outline', outline: '- [[CAC]]\n    - [[LTV]]' }])
    expect(settings.problems).toEqual([])
  })

  it('a non-string outline is a problem and only THAT key is dropped — the view stays', () => {
    const settings = settingsOf({ views: [{ type: 'outline', name: 'Outline', outline: ['[[CAC]]'], limit: 3 }] })
    expect(settings.views).toEqual([{ type: 'outline', name: 'Outline', limit: 3 }])
    expect(settings.problems).toHaveLength(1)
    expect(settings.problems[0]).toContain('outline')
  })

  it('a non-list views is a problem and yields DEFAULT_VIEWS', () => {
    const settings = settingsOf({ views: 'table' })
    expect(settings.views).toEqual(OUTLINE_TABLE_BOARD)
    expect(settings.problems).toHaveLength(1)
  })

  it('an empty list yields DEFAULT_VIEWS quietly — a folder page always has its three skins', () => {
    const settings = settingsOf({ views: [] })
    expect(settings.views).toEqual(OUTLINE_TABLE_BOARD)
    expect(settings.problems).toEqual([])
  })

  it('views whose entries ALL fail fall back to DEFAULT_VIEWS, problems recorded', () => {
    const settings = settingsOf({ views: [{ type: 'outline' }] })
    expect(settings.views).toEqual(OUTLINE_TABLE_BOARD)
    expect(settings.problems).toHaveLength(1)
  })
})

describe('folder: the parking bin, validated by FOLDER_NAME', () => {
  it('keeps a usable folder', () => {
    const settings = settingsOf({ folder: 'metrics' })
    expect(settings.folder).toBe('metrics')
    expect(settings.problems).toEqual([])
  })

  it.each([['../evil'], ['/absolute'], ['C:/drive'], ['back\\slash'], ['.hidden']])(
    'treats %s as absent with a problem',
    (folder) => {
      const settings = settingsOf({ folder })
      expect(settings.folder).toBeUndefined()
      expect(settings.problems).toHaveLength(1)
    },
  )

  it('a non-string folder is a problem and absent', () => {
    const settings = settingsOf({ folder: 7 })
    expect(settings.folder).toBeUndefined()
    expect(settings.problems).toHaveLength(1)
  })
})

/** A folder page whose outline view carries this order, plus the members to arrange. */
const arrange = (order: unknown, memberPaths: string[], extra: string[] = []): string[] => {
  const views = order === undefined ? [{ type: 'outline', name: 'Outline' }] : [{ type: 'outline', name: 'Outline', order }]
  const page = rec(METRICS, { folder_page: true, folder_page_settings: { views } })
  const members = memberPaths.map((p) => rec(p))
  const records = [page, ...members, ...extra.map((p) => rec(p))]
  return orderedMembers(members, folderPageSettings(page), resolverOver(records)).map((r) => r.basename)
}

describe('orderedMembers: the [D5] ordering rule, once', () => {
  it('places the ordered members first, in order-entry sequence, then the rest alphabetically', () => {
    expect(arrange(['[[CAC]]', '[[LTV]]'], ['/vault/Zulu.md', '/vault/LTV.md', '/vault/alpha.md', '/vault/CAC.md'])).toEqual([
      'CAC',
      'LTV',
      'alpha',
      'Zulu',
    ])
  })

  it('ignores stale entries harmlessly: an unresolved one and one resolving to a NON-member', () => {
    expect(
      arrange(['[[Missing]]', '[[Outsider]]', '[[CAC]]'], ['/vault/Zulu.md', '/vault/CAC.md'], ['/vault/Outsider.md']),
    ).toEqual(['CAC', 'Zulu'])
  })

  it('resolves order entries case-insensitively and counts one member ONCE', () => {
    expect(arrange(['[[cac]]', '[[CAC]]', '[[CAC|nice name]]'], ['/vault/CAC.md', '/vault/alpha.md'])).toEqual([
      'CAC',
      'alpha',
    ])
  })

  it('no order at all is all-alphabetical by basename, case-insensitively', () => {
    expect(arrange(undefined, ['/vault/Zulu.md', '/vault/alpha.md', '/vault/Beta.md'])).toEqual(['alpha', 'Beta', 'Zulu'])
  })

  it('no outline view is all-alphabetical too', () => {
    const page = rec(METRICS, {
      folder_page: true,
      folder_page_settings: { views: [{ type: 'table', name: 'Table', order: ['[[Zulu]]'] }] },
    })
    const members = [rec('/vault/Zulu.md'), rec('/vault/alpha.md')]
    const ordered = orderedMembers(members, folderPageSettings(page), resolverOver([page, ...members]))
    expect(ordered.map((r) => r.basename)).toEqual(['alpha', 'Zulu'])
  })

  it('non-string order entries are ignored, and no members is an empty list', () => {
    expect(arrange([42, null, '[[CAC]]'], ['/vault/CAC.md', '/vault/alpha.md'])).toEqual(['CAC', 'alpha'])
    expect(arrange(['[[CAC]]'], [])).toEqual([])
  })
})

describe('outlineOrderOf', () => {
  it('an edited outline answers from its DOCUMENT: link lines in document order, prose ignored (YAZ-905)', () => {
    const settings = settingsOf({
      views: [
        {
          type: 'outline',
          name: 'Outline',
          outline: '- Q3 focus\n    - [[LTV]]\n    - waiting on finance\n- [[CAC]]\n- see [[CAC]] inline',
          order: ['[[Stale]]'],
        },
      ],
    })
    // The document wins over a stale order; a mid-prose link is not a line and names nobody.
    expect(outlineOrderOf(settings)).toEqual(['[[LTV]]', '[[CAC]]'])
  })

  it('returns the FIRST outline view\'s order', () => {
    const settings = settingsOf({
      views: [
        { type: 'table', name: 'Table', order: ['file.name'] },
        { type: 'outline', name: 'Outline', order: ['[[CAC]]', '[[LTV]]'] },
        { type: 'outline', name: 'Second', order: ['[[Nope]]'] },
      ],
    })
    expect(outlineOrderOf(settings)).toEqual(['[[CAC]]', '[[LTV]]'])
  })

  it('is empty when there is no outline view, no order, or a non-list order', () => {
    expect(outlineOrderOf(settingsOf({ views: [{ type: 'table', name: 'Table', order: ['file.name'] }] }))).toEqual([])
    expect(outlineOrderOf(settingsOf({ views: [{ type: 'outline', name: 'Outline' }] }))).toEqual([])
    expect(outlineOrderOf(settingsOf({ views: [{ type: 'outline', name: 'Outline', order: 'CAC' }] }))).toEqual([])
    expect(outlineOrderOf(folderPageSettings(rec(METRICS, { folder_page: true })))).toEqual([])
  })
})

describe('defaultView (YAZ-1104): the saved starting view', () => {
  const write = vi.mocked(writeProperty)

  it('reads a string name, and absent stays undefined — zero problems either way', () => {
    expect(settingsOf({ defaultView: 'Table' }).defaultView).toBe('Table')
    expect(settingsOf({ defaultView: 'Table' }).problems).toEqual([])
    expect(settingsOf({}).defaultView).toBeUndefined()
    expect(folderPageSettings(rec(METRICS, { folder_page: true })).defaultView).toBeUndefined()
  })

  it.each([
    ['a number', 3],
    ['a list', ['Table']],
    ['a map', { name: 'Table' }],
  ])('%s is ONE problem and reads as absent', (_label, value) => {
    const settings = settingsOf({ defaultView: value })
    expect(settings.defaultView).toBeUndefined()
    expect(settings.problems).toHaveLength(1)
  })

  it("a name matching no view still reads verbatim — staleness is the pane's concern, not a problem", () => {
    expect(settingsOf({ defaultView: 'Ghost' }).defaultView).toBe('Ghost')
    expect(settingsOf({ defaultView: 'Ghost' }).problems).toEqual([])
  })

  it('round-trips to disk, and an unset value never reaches the key', async () => {
    write.mockReset()
    write.mockResolvedValue({ mtime: 200 })
    await writeFolderPageSettings(METRICS, settingsOf({ defaultView: 'Table' }))
    expect(write.mock.calls[0][2]).toMatchObject({ defaultView: 'Table' })
    await writeFolderPageSettings(METRICS, settingsOf({}))
    expect(write.mock.calls[1][2]).not.toHaveProperty('defaultView')
  })
})

describe('writeFolderPageSettings: ONE key, through the shared writer', () => {
  const write = vi.mocked(writeProperty)

  beforeEach(() => {
    write.mockReset()
    write.mockResolvedValue({ mtime: 200 })
  })

  it('round-trips a parsed settings value as a plain object under the one key', async () => {
    const raw = {
      columns: { owner: { kind: 'text' }, kpis: { kind: 'multi-link', target: '[[KPIs]]' } },
      folder: 'metrics',
      views: [
        { type: 'outline', name: 'Outline', order: ['[[CAC]]', '[[LTV]]'] },
        { type: 'table', name: 'Table', order: ['file.name', 'owner'], columnSize: { owner: 120 }, zoom: 3 },
      ],
    }
    const settings = folderPageSettings(rec(METRICS, { folder_page: true, folder_page_settings: raw }))

    await expect(writeFolderPageSettings(METRICS, settings)).resolves.toMatchObject({ mtime: 200 })

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(METRICS, 'folder_page_settings', raw)
  })

  it('never serializes problems, and omits empty columns and an absent folder', async () => {
    const settings = settingsOf({ folder: '../evil', views: [{ type: 'table', name: 'Table' }] })
    expect(settings.problems).toHaveLength(1)

    await writeFolderPageSettings(METRICS, settings)

    expect(write).toHaveBeenCalledWith(METRICS, 'folder_page_settings', { views: [{ type: 'table', name: 'Table' }] })
  })

  it('writes undefined to DELETE the key when the caller explicitly asks for it', async () => {
    await writeFolderPageSettings(METRICS, undefined)
    expect(write).toHaveBeenCalledWith(METRICS, 'folder_page_settings', undefined)
  })
})

describe('columnKindIn (YAZ-831): typing is VIEW-SCOPED — no global winner', () => {
  it('answers one folder page\'s own declaration, or null', () => {
    const settings = settingsOf({ columns: { owner: { kind: 'text' } } })
    expect(columnKindIn(settings, 'owner')).toEqual({ kind: 'text' })
    expect(columnKindIn(settings, 'cadence')).toBeNull()
  })

  it('two folder pages declaring the SAME key differently each answer their own — neither wins', () => {
    const metrics = settingsOf({ columns: { owner: { kind: 'text' } } })
    const team = folderPageSettings(
      rec('/vault/Team.md', { folder_page: true, folder_page_settings: { columns: { owner: { kind: 'link' } } } }),
    )
    expect(columnKindIn(metrics, 'owner')).toEqual({ kind: 'text' })
    expect(columnKindIn(team, 'owner')).toEqual({ kind: 'link' })
  })
})


it('reads ordered select options tolerantly without changing raw config', () => {
  const raw = { columns: { status: { kind: 'select', options: ['Done', 'Ready', '', 'Done', 7] }, tags: { kind: 'multi-select', options: ['A', 'B'] } } }
  const before = structuredClone(raw)
  const settings = settingsOf(raw)
  expect(settings.columns.status).toEqual({ kind: 'select', options: ['Done', 'Ready'] })
  expect(settings.columns.tags).toEqual({ kind: 'multi-select', options: ['A', 'B'] })
  expect(settings.problems).toHaveLength(1)
  expect(raw).toEqual(before)
})

it('reads option order tolerantly and reports malformed order without changing the manual array', () => {
  const raw = { columns: {
    Status: { kind: 'select', options: ['Z', 'A'], optionSort: 'ascending' },
    Labels: { kind: 'multi-select', options: ['B', 'A'], optionSort: 'sideways' },
  } }
  const settings = settingsOf(raw)
  expect(settings.columns.Status).toEqual({ kind: 'select', options: ['Z', 'A'], optionSort: 'ascending' })
  expect(settings.columns.Labels).toEqual({ kind: 'multi-select', options: ['B', 'A'] })
  expect(settings.problems).toEqual(['folder_page_settings.columns.Labels.optionSort must be manual, ascending, or descending — using manual order'])
  expect(raw.columns.Labels.optionSort).toBe('sideways')
})

describe('the default status column (YAZ-1513): every folder page is born with it', () => {
  const STATUS = { kind: 'select', options: ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'] }

  it('DEFAULT_COLUMNS is one Select, its options in board order', () => {
    expect(DEFAULT_COLUMNS).toEqual({ status: STATUS })
  })

  it('newFolderPageProperties: the flag first, then the settings holding ONLY the default declaration — a fresh copy each call', () => {
    const props = newFolderPageProperties()
    expect(Object.keys(props)).toEqual(['folder_page', 'folder_page_settings'])
    expect(props).toEqual({ folder_page: true, folder_page_settings: { columns: { status: STATUS } } })
    // handed out to be edited: mutating one birth never leaks into the next, nor into the constant
    ;((props.folder_page_settings as { columns: Record<string, { options: string[] }> }).columns.status.options).push('5-Archived')
    expect(newFolderPageProperties()).toEqual({ folder_page: true, folder_page_settings: { columns: { status: STATUS } } })
    expect(DEFAULT_COLUMNS.status.options).toEqual(STATUS.options)
    // and the read side agrees with what was written
    expect(folderPageSettings(rec('/vault/New.md', newFolderPageProperties())).columns).toEqual({ status: STATUS })
  })

  it('bornFolderPage is the ONE spelling (YAZ-1549): the flag, and the default settings only when the key is absent; the input is never mutated', () => {
    const plain = { title: 'Ops' }
    expect(bornFolderPage(plain)).toEqual({ title: 'Ops', folder_page: true, folder_page_settings: { columns: { status: STATUS } } })
    expect(plain).toEqual({ title: 'Ops' })
    const kept = { folder_page_settings: { columns: { owner: { kind: 'link' } } } }
    expect(bornFolderPage(kept)).toEqual({ folder_page_settings: { columns: { owner: { kind: 'link' } } }, folder_page: true })
    expect(bornFolderPage({ folder_page_settings: null })).toEqual({ folder_page_settings: null, folder_page: true })
    expect(newFolderPageProperties()).toEqual(bornFolderPage({}))
  })

  it('turnIntoFolderPage adds the flag AND the default settings to a page with no settings key', () => {
    const next = turnIntoFolderPage('---\ntitle: Ops\n---\n\n# Ops\n')
    expect(next).toBe(
      '---\ntitle: Ops\nfolder_page: true\nfolder_page_settings:\n  columns:\n    status:\n      kind: select\n      options:\n        - 1-Backlog\n        - 2-Todo\n        - 3-In-Progress\n        - 4-Done\n---\n\n# Ops\n',
    )
    // no frontmatter at all grows a block, body untouched
    expect(turnIntoFolderPage('# Ops\n')).toBe(
      '---\nfolder_page: true\nfolder_page_settings:\n  columns:\n    status:\n      kind: select\n      options:\n        - 1-Backlog\n        - 2-Todo\n        - 3-In-Progress\n        - 4-Done\n---\n# Ops\n',
    )
  })

  it('turnIntoFolderPage adds ONLY the flag when settings already exist — a page turned back keeps its settings', () => {
    const kept = '---\ntitle: Ops\nfolder_page_settings:\n  columns:\n    owner:\n      kind: link\n  views:\n    - type: table\n      name: T\n---\nbody\n'
    // the one-key writer APPENDS a new key — every existing key keeps its place
    expect(turnIntoFolderPage(kept)).toBe(kept.replace('      name: T\n---', '      name: T\nfolder_page: true\n---'))
    // a bare `folder_page_settings:` is still a present key — nothing is seeded over it
    const bare = '---\nfolder_page_settings:\n---\n'
    expect(turnIntoFolderPage(bare)).toBe('---\nfolder_page_settings:\nfolder_page: true\n---\n')
  })

  it('turnIntoFolderPage byte-preserves every other key, comment and the body; an already-flagged page changes only what is missing', () => {
    const page = '---\n# the owner\nowner: "[[Sam]]"\ntags: [a, b]\nfolder_page: true\n---\n\nprose\n'
    const next = turnIntoFolderPage(page)
    expect(next.startsWith('---\n# the owner\nowner: "[[Sam]]"\ntags: [a, b]\nfolder_page: true\nfolder_page_settings:\n')).toBe(true)
    expect(next.endsWith('---\n\nprose\n')).toBe(true)
    // idempotent: a second pass is the identity
    expect(turnIntoFolderPage(next)).toBe(next)
  })

  it('turnIntoFolderPage throws on unparsable frontmatter rather than writing over it', () => {
    expect(() => turnIntoFolderPage('---\nkey: [unclosed\n---\n')).toThrow()
  })
})

describe('properties: column labels (YAZ-1513) — `ViewSet.properties` verbatim, the key never changes', () => {
  it('reads key → { displayName } and hands it back to the writer untouched', () => {
    const settings = settingsOf({ properties: { status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } }, views: [{ type: 'table', name: 'T' }] })
    expect(settings.properties).toEqual({ status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } })
    expect(settings.problems).toEqual([])
    writeFolderPageSettings('/vault/F.md', settings)
    expect(vi.mocked(writeProperty)).toHaveBeenLastCalledWith('/vault/F.md', 'folder_page_settings', {
      properties: { status: { displayName: 'Stage' }, 'note.owner': { displayName: 'Who' } },
      views: [{ type: 'table', name: 'T' }],
    })
  })

  it('is absent when the card has none, and absent from the write too', () => {
    const settings = settingsOf({ views: [{ type: 'table', name: 'T' }] })
    expect(settings.properties).toBeUndefined()
    writeFolderPageSettings('/vault/F.md', settings)
    expect(vi.mocked(writeProperty)).toHaveBeenLastCalledWith('/vault/F.md', 'folder_page_settings', { views: [{ type: 'table', name: 'T' }] })
  })

  it('a blank displayName reads as absent — the header never goes empty (YAZ-1549)', () => {
    const settings = settingsOf({ properties: { status: { displayName: '   ' }, owner: { displayName: '' } } })
    expect(settings.properties).toEqual({ status: {}, owner: {} })
    expect(settings.problems).toEqual([])
  })

  it("reads tolerantly: a non-map is ignored with a problem; a non-map entry or a non-string displayName drops that entry", () => {
    expect(settingsOf({ properties: 'nope' }).properties).toBeUndefined()
    expect(settingsOf({ properties: 'nope' }).problems).toEqual(['folder_page_settings.properties must be a map of column labels — ignoring it'])
    const mixed = settingsOf({ properties: { a: { displayName: 'A' }, b: 'text', c: { displayName: 7 }, d: {} } })
    expect(mixed.properties).toEqual({ a: { displayName: 'A' }, d: {} })
    expect(mixed.problems).toEqual([
      'folder_page_settings.properties.b must be a map with a displayName — ignoring that label',
      'folder_page_settings.properties.c.displayName must be text — ignoring that label',
    ])
  })

})
