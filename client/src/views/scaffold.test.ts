/**
 * Folder-page scaffolding (YAZ-832; 🔒 Q5/Q6 of YAZ-815): a new member is the folder page's
 * declared columns, empty, plus ONE `folder_pages` wikilink back to it, forced LAST — a template
 * at `.yaseendocs/templates/<folder page>.md` overrides key-by-key and may not displace the
 * birth. The declarations/`page_type` half this file used to cover died with the type system
 * (YAZ-836). `api` mocked like newNote.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderPageSettings } from './folderPageSettings'
import { emptyColumnValue, ensureFolder, folderPageTemplatePath, memberFolder, newPageFromFolderPage, scaffoldFromFolderPage } from './scaffold'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    readFile: vi.fn(),
    createDir: vi.fn(),
  },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const createDir = vi.mocked(api.createDir)

const notFound = () => new BridgeRequestError('NOT_FOUND', 'path does not exist')
const alreadyExists = () => new BridgeRequestError('ALREADY_EXISTS', 'path already exists')

beforeEach(() => {
  vi.clearAllMocks()
})

/** A folder page's declaration — the 2A shape, columns spanning every kind. */
const METRICS: FolderPageSettings = {
  columns: {
    owner: { kind: 'link', target: 'person' },
    kpis: { kind: 'multi-link', target: 'kpi', required: true },
    steps: { kind: 'list' },
    due: { kind: 'date' },
    done: { kind: 'checkbox' },
    score: { kind: 'number' },
    unit: { kind: 'text' },
  },
  views: [{ type: 'outline', name: 'Outline' }],
  problems: [],
}

const EMPTY_COLUMNS = { owner: null, kpis: [], steps: [], due: null, done: null, score: null, unit: null }

describe('scaffoldFromFolderPage (🔒 Q5)', () => {
  it('uses one empty-value rule: list-like columns get [], every scalar gets null', () => {
    expect(emptyColumnValue({ kind: 'list' })).toEqual([])
    expect(emptyColumnValue({ kind: 'multi-link' })).toEqual([])
    expect(emptyColumnValue({ kind: 'text' })).toBeNull()
    expect(emptyColumnValue({ kind: 'number' })).toBeNull()
    expect(emptyColumnValue({ kind: 'checkbox' })).toBeNull()
  })

  it('every declared column empty — list/multi-link → [], scalar kinds → null — and folder_pages LAST', () => {
    const properties = scaffoldFromFolderPage('Metrics', METRICS)
    expect(properties).toEqual({ ...EMPTY_COLUMNS, folder_pages: ['[[Metrics]]'] })
    expect(Object.keys(properties).at(-1)).toBe('folder_pages')
  })

  it('the new page is a NORMAL page: no folder_page flag is ever born here (that is 4B\'s)', () => {
    expect('folder_page' in scaffoldFromFolderPage('Metrics', METRICS)).toBe(false)
  })

  it('a folder page declaring no columns scaffolds the belonging alone', () => {
    expect(scaffoldFromFolderPage('Metrics', { columns: {}, views: [], problems: [] })).toEqual({
      folder_pages: ['[[Metrics]]'],
    })
  })
})

describe('folderPageTemplatePath / newPageFromFolderPage (🔒 Q6)', () => {
  it('the template lives in `.yaseendocs/templates`; existence = has-template', () => {
    expect(folderPageTemplatePath('/v', 'Metrics')).toBe('/v/.yaseendocs/templates/Metrics.md')
    expect(folderPageTemplatePath('/v', 'Meta Ads')).toBe('/v/.yaseendocs/templates/Meta Ads.md')
  })

  it('no template → scaffold + seed, folder_pages still last (a new seed key never displaces it), body \'\'', async () => {
    readFile.mockRejectedValue(notFound())

    const parts = await newPageFromFolderPage('/v', 'Metrics', METRICS, { unit: 'days', spend: 12 })

    expect(readFile).toHaveBeenCalledWith('/v/.yaseendocs/templates/Metrics.md')
    expect(parts).toEqual({
      properties: { ...EMPTY_COLUMNS, unit: 'days', spend: 12, folder_pages: ['[[Metrics]]'] },
      body: '',
    })
    expect(Object.keys(parts.properties).at(-1)).toBe('folder_pages')
  })

  it('merge order: scaffold ← template ← seed; extra template keys survive; folder_pages forced back and last; body verbatim', async () => {
    readFile.mockResolvedValue({
      path: '/v/.yaseendocs/templates/Metrics.md',
      content: '---\nunit: "%"\nscore: 1\nextra: kept\nfolder_pages: ["[[Wrong]]"]\n---\n# Scaffolded\n\nNotes.\n',
      mtime: 1,
      size: 1,
    })

    const parts = await newPageFromFolderPage('/v', 'Metrics', METRICS, { score: 3, folder_pages: ['[[Also wrong]]'] })

    expect(parts).toEqual({
      properties: { ...EMPTY_COLUMNS, unit: '%', score: 3, extra: 'kept', folder_pages: ['[[Metrics]]'] },
      body: '# Scaffolded\n\nNotes.\n',
    })
    expect(Object.keys(parts.properties).at(-1)).toBe('folder_pages')
  })

  it('other read failures propagate', async () => {
    readFile.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    await expect(newPageFromFolderPage('/v', 'Metrics', METRICS)).rejects.toThrow('permission denied')
  })
})

/**
 * WHERE a member lands (🔒 Q5/Q6) — the ONE place both birth surfaces ask (YAZ-869): the contents
 * block's New / outline create row, and the Topics tree's right-click on the folder page itself.
 */
describe('memberFolder', () => {
  it('is the settings folder, created level by level', async () => {
    createDir.mockResolvedValue({ path: '' })
    expect(await memberFolder('/v', '/v/Metrics.md', { ...METRICS, folder: 'kpis/growth' })).toBe('/v/kpis/growth')
    expect(createDir.mock.calls.map((c) => c[0])).toEqual(['/v/kpis', '/v/kpis/growth'])
  })

  it("without one, the folder page's OWN directory — and nothing is created", async () => {
    expect(await memberFolder('/v', '/v/deep/Metrics.md', METRICS)).toBe('/v/deep')
    expect(await memberFolder('/v', '/v/Metrics.md', METRICS)).toBe('/v')
    expect(createDir).not.toHaveBeenCalled()
  })
})

describe('ensureFolder', () => {
  it('creates each missing level, tolerates existing ones, resolves the absolute dir', async () => {
    createDir.mockRejectedValueOnce(alreadyExists())
    createDir.mockResolvedValue({ path: '' })

    expect(await ensureFolder('/v', 'kpis/growth')).toBe('/v/kpis/growth')
    expect(createDir.mock.calls.map((c) => c[0])).toEqual(['/v/kpis', '/v/kpis/growth'])
  })

  it('other failures propagate', async () => {
    createDir.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    await expect(ensureFolder('/v', 'kpis')).rejects.toThrow('permission denied')
  })
})


it('initializes select as empty scalar and multi-select as an empty list, not the first option', () => {
  expect(emptyColumnValue({ kind: 'select', options: ['First'] })).toBeNull()
  expect(emptyColumnValue({ kind: 'multi-select', options: ['First'] })).toEqual([])
})
