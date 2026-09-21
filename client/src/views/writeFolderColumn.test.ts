import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import type { PropertyDecl } from '@shared/types'
import { writeFolderColumn } from './folderPageSettings'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))
import { api, BridgeRequestError } from '../api'

const path = '/vault/Candidates.md'
const read = vi.mocked(api.readFile)
const write = vi.mocked(api.writeFile)
const file = (content: string, mtime = 100) => ({ path, content, mtime, size: content.length })
const base: PropertyDecl = { kind: 'select', options: ['Later', 'Ready'] }
const next: PropertyDecl = { ...base, optionSort: 'ascending' }
const content = (settings: unknown) => setFrontmatterProperty('---\nfolder_page: true\n---\nBody stays.\n', 'folder_page_settings', settings)
const settingsWritten = () => parseFrontmatter(splitFrontmatter(write.mock.lastCall![0].content).frontmatter).properties.folder_page_settings
beforeEach(() => {
  read.mockReset(); write.mockReset()
  write.mockResolvedValue({ path, mtime: 200, size: 200 })
})

describe('writeFolderColumn', () => {
  it.each([undefined, null])('creates a definition when settings are %s without injecting view defaults', async settings => {
    read.mockResolvedValue(file(content(settings)))
    await expect(writeFolderColumn(path, 'Status', base, undefined)).resolves.toMatchObject({ mtime: 200 })
    expect(settingsWritten()).toEqual({ columns: { Status: base } })
    expect(write.mock.lastCall![0].expectedMtime).toBe(100)
    expect(write.mock.lastCall![0].content).toContain('Body stays.\n')
  })

  it('preserves concurrent sibling edits, raw view settings and unknown definition metadata', async () => {
    const settings = { columns: { Status: { ...base, future: { color: 'pink' } }, Priority: { kind: 'future-kind', extra: 8 } }, views: [{ type: 'future-view', name: 'Future', custom: true }], futureSetting: [1, 2] }
    read.mockResolvedValue(file(content(settings)))
    await writeFolderColumn(path, 'Status', next, { options: ['Later', 'Ready'], kind: 'select' })
    expect(settingsWritten()).toEqual({ ...settings, columns: { ...settings.columns, Status: { ...next, future: { color: 'pink' } } } })
  })

  it('clears omitted known fields without removing unknown metadata', async () => {
    const old: PropertyDecl = { kind: 'link', target: '[[People]]', required: true }
    read.mockResolvedValue(file(content({ columns: { Related: { ...old, future: true } } })))
    await writeFolderColumn(path, 'Related', { kind: 'link' }, old)
    expect(settingsWritten()).toEqual({ columns: { Related: { kind: 'link', future: true } } })
  })

  it.each([
    { ...base, options: ['New'] }, { ...base, optionSort: 'descending' },
    { ...base, kind: 'multi-select' }, { ...base, required: true }, { ...base, target: '[[Page]]' },
    undefined,
  ])('rejects a stale edit when this column changed to %j', async current => {
    read.mockResolvedValue(file(content({ columns: current === undefined ? {} : { Status: current } })))
    await expect(writeFolderColumn(path, 'Status', next, base)).rejects.toThrow('changed since these settings were opened')
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects creating a column that appeared after the dialog opened', async () => {
    read.mockResolvedValue(file(content({ columns: { Status: base } })))
    await expect(writeFolderColumn(path, 'Status', next, undefined)).rejects.toThrow('changed since')
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['bad', [], { columns: null }, { columns: [] }, { columns: { Status: 42 } }, { columns: { Status: { kind: 'future-kind' } } }])('rejects malformed settings %j without replacing them', async settings => {
    read.mockResolvedValue(file(content(settings)))
    await expect(writeFolderColumn(path, 'Status', next, undefined)).rejects.toThrow()
    expect(write).not.toHaveBeenCalled()
  })

  it.each([
    { options: ['Ready', 7] }, { options: ['Ready', 'Ready'] }, { optionSort: 'future-mode' }, { target: 7 }, { required: 'yes' },
  ])('rejects malformed current optional fields %j even when the tolerant base matches', async malformed => {
    read.mockResolvedValue(file(content({ columns: { Status: { kind: 'select', options: ['Ready'], ...malformed } } })))
    await expect(writeFolderColumn(path, 'Status', { kind: 'select', options: ['Ready'], optionSort: 'ascending' }, { kind: 'select', options: ['Ready'] })).rejects.toThrow('invalid definition')
    expect(write).not.toHaveBeenCalled()
  })

  it.each([{ kind: 'bad' }, { kind: 'select', options: ['A', 'A'] }, { kind: 'select', options: [''] }, { kind: 'select', optionSort: 'bad' }, { kind: 'link', target: 1 }, { kind: 'text', required: 'yes' }])('rejects invalid submitted definitions %j before reading or writing', async invalid => {
    await expect(writeFolderColumn(path, 'Status', invalid as PropertyDecl, undefined)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
  })

  it('rejects broken frontmatter and skips writes for an unchanged definition', async () => {
    read.mockResolvedValueOnce(file('---\nbad: [\n---\nBody'))
    await expect(writeFolderColumn(path, 'Status', next, undefined)).rejects.toThrow()
    read.mockResolvedValueOnce(file(content({ columns: { Status: base } })))
    await expect(writeFolderColumn(path, 'Status', base, base)).resolves.toMatchObject({ mtime: 100 })
    expect(write).not.toHaveBeenCalled()
  })

  it('re-reads on mtime conflict and recomputes against fresh unrelated settings', async () => {
    read.mockResolvedValueOnce(file(content({ columns: { Status: base } })))
      .mockResolvedValueOnce(file(content({ columns: { Status: base, Added: { kind: 'text' } }, defaultView: 'New view' }), 150))
    write.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'changed', 150))
    await writeFolderColumn(path, 'Status', next, base)
    expect(read).toHaveBeenCalledTimes(2)
    expect(write.mock.lastCall![0].expectedMtime).toBe(150)
    expect(settingsWritten()).toEqual({ columns: { Status: next, Added: { kind: 'text' } }, defaultView: 'New view' })
  })

  it('stops the retry if the same definition changed on disk', async () => {
    read.mockResolvedValueOnce(file(content({ columns: { Status: base } })))
      .mockResolvedValueOnce(file(content({ columns: { Status: { ...base, options: ['Changed'] } } }), 150))
    write.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'changed', 150))
    await expect(writeFolderColumn(path, 'Status', next, base)).rejects.toThrow('changed since')
    expect(write).toHaveBeenCalledTimes(1)
  })
})
