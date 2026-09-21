import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { datedFolderSeed, entryPath, renamedPath, renameInputName, targetDirFor, validateEntryName } from './createEntry'

const dir = (path: string): TreeNode => ({ type: 'dir', name: path.split('/').pop()!, path, children: [] })
const file = (path: string): TreeNode => ({ type: 'file', name: path.split('/').pop()!, path, size: 0, mtime: 1, kind: 'markdown' })

describe('validateEntryName', () => {
  it('accepts plain names', () => {
    expect(validateEntryName('Notes')).toBeNull()
    expect(validateEntryName('my file.md')).toBeNull()
  })

  it('rejects slashes, leading dots, and NUL', () => {
    expect(validateEntryName('a/b')).toMatch(/\//)
    expect(validateEntryName('.hidden')).toMatch(/hidden/i)
    expect(validateEntryName('a\0b')).not.toBeNull()
  })
})

describe('entryPath', () => {
  it('appends .md to file names without a markdown extension', () => {
    expect(entryPath('/r', 'note', 'file')).toBe('/r/note.md')
    expect(entryPath('/r', 'note.txt', 'file')).toBe('/r/note.txt.md')
  })

  it('keeps existing markdown extensions, case-insensitive', () => {
    expect(entryPath('/r', 'note.md', 'file')).toBe('/r/note.md')
    expect(entryPath('/r', 'note.MARKDOWN', 'file')).toBe('/r/note.MARKDOWN')
  })

  it('gives a folder page the note extension — it IS a note, just born flagged (🔒 D1, YAZ-841)', () => {
    expect(entryPath('/r', 'Growth', 'folderPage')).toBe('/r/Growth.md')
    expect(entryPath('/r', 'Growth.md', 'folderPage')).toBe('/r/Growth.md')
    expect(entryPath('/r', '  Growth ', 'folderPage')).toBe('/r/Growth.md')
  })

  it('uses dir names as-is and trims whitespace', () => {
    expect(entryPath('/r', 'Folder', 'dir')).toBe('/r/Folder')
    expect(entryPath('/r', '  note ', 'file')).toBe('/r/note.md')
  })
})

describe('datedFolderSeed (YAZ-1604)', () => {
  it('is MM_DD of the given day, zero-padded, then "- " so the title lands one space after the dash', () => {
    expect(datedFolderSeed(new Date(2026, 5, 22))).toBe('06_22- ')
    expect(datedFolderSeed(new Date(2026, 11, 3))).toBe('12_03- ')
  })

  it('defaults to today', () => {
    expect(datedFolderSeed()).toMatch(/^\d{2}_\d{2}- $/)
  })
})

describe('targetDirFor', () => {
  it('dir row → itself, file row → its parent, blank space → root', () => {
    expect(targetDirFor(dir('/r/sub'), '/r')).toBe('/r/sub')
    expect(targetDirFor(file('/r/sub/a.md'), '/r')).toBe('/r/sub')
    expect(targetDirFor(null, '/r')).toBe('/r')
  })
})

describe('renameInputName', () => {
  it('hides only the final Markdown suffix', () => {
    expect(renameInputName('B.markdown')).toBe('B')
    expect(renameInputName('Guide.txt.md')).toBe('Guide.txt')
  })

  it('keeps the full filename for JSON, PDF, code, and compound view-only names', () => {
    expect(renameInputName('data.json')).toBe('data.json')
    expect(renameInputName('report.PDF')).toBe('report.PDF')
    expect(renameInputName('tool.Py')).toBe('tool.Py')
    expect(renameInputName('schema.graphql.ts')).toBe('schema.graphql.ts')
    expect(renameInputName('report.json.pdf')).toBe('report.json.pdf')
  })

  it('leaves unsupported suffixes intact', () => {
    expect(renameInputName('archive.bin')).toBe('archive.bin')
  })
})

describe('renamedPath (Links E1, GRO-2194)', () => {
  it('same parent dir; the OLD file extension re-appends when no markdown one is typed', () => {
    expect(renamedPath('/r/sub/B.md', 'C')).toBe('/r/sub/C.md')
    expect(renamedPath('/r/sub/B.markdown', 'C')).toBe('/r/sub/C.markdown')
    expect(renamedPath('/r/B.md', '  C  ')).toBe('/r/C.md')
  })

  it('a typed markdown extension is kept as typed', () => {
    expect(renamedPath('/r/B.md', 'C.md')).toBe('/r/C.md')
    expect(renamedPath('/r/B.markdown', 'C.md')).toBe('/r/C.md')
    expect(renamedPath('/r/B.md', 'C.MD')).toBe('/r/C.MD')
  })

  it('an unchanged name round-trips to the same path (the caller treats it as a no-op)', () => {
    expect(renamedPath('/r/B.md', 'B')).toBe('/r/B.md')
  })

  it('round-trips unchanged JSON and PDF names without duplicating their extensions', () => {
    expect(renamedPath('/r/data.json', 'data.json')).toBe('/r/data.json')
    expect(renamedPath('/r/report.PDF', 'report.PDF')).toBe('/r/report.PDF')
  })

  it('preserves or appends the current view-only suffix when a bare basename is typed', () => {
    expect(renamedPath('/r/data.json', 'profile')).toBe('/r/profile.json')
    expect(renamedPath('/r/report.PDF', 'brief')).toBe('/r/brief.PDF')
  })

  it('respects explicit supported extensions, including mixed-case same-kind text extensions', () => {
    expect(renamedPath('/r/data.JSON', 'profile.json')).toBe('/r/profile.json')
    expect(renamedPath('/r/data.JSON', 'profile.Py')).toBe('/r/profile.Py')
    expect(renamedPath('/r/report.pdf', 'brief.PDF')).toBe('/r/brief.PDF')
  })

  it.each([
    ['Version 1.0.md', 'Version 1.0'],
    ['Release.1.json', 'Release.1.json'],
    ['report.final.PDF', 'report.final.PDF'],
  ])('round-trips a dotted basename with its real supported suffix: %s', (name, input) => {
    expect(renameInputName(name)).toBe(input)
    expect(renamedPath(`/r/${name}`, input)).toBe(`/r/${name}`)
  })

  it('renames dotted basenames while preserving the old exact suffix', () => {
    expect(renamedPath('/r/Release.1.json', 'Release.2')).toBe('/r/Release.2.json')
    expect(renamedPath('/r/report.final.PDF', 'summary.final')).toBe('/r/summary.final.PDF')
  })

  it.each([
    ['schema.graphql.ts', 'schema.graphql.ts'],
    ['report.json.pdf', 'report.json.pdf'],
    ['Guide.txt.md', 'Guide.txt'],
  ])('round-trips an unchanged compound filename exactly: %s', (name, input) => {
    expect(renameInputName(name)).toBe(input)
    expect(renamedPath(`/r/${name}`, input)).toBe(`/r/${name}`)
  })

  it('still honors intentional compound-name renames with an explicit supported suffix', () => {
    expect(renamedPath('/r/schema.graphql.ts', 'schema.py')).toBe('/r/schema.py')
    expect(renamedPath('/r/report.json.pdf', 'summary.PDF')).toBe('/r/summary.PDF')
    expect(renamedPath('/r/Guide.txt.md', 'Manual.markdown')).toBe('/r/Manual.markdown')
  })

  it('preserves Markdown suffix ownership when the visible name ends in another supported suffix', () => {
    expect(renameInputName('Guide.txt.md')).toBe('Guide.txt')
    expect(renamedPath('/r/Guide.txt.md', 'Manual.txt')).toBe('/r/Manual.txt.md')
    expect(renamedPath('/r/B.md', 'C.bin')).toBe('/r/C.bin.md')
  })

  it('appends the current suffix to unrecognized dotted names but leaves recognized cross-kind suffixes explicit', () => {
    expect(renamedPath('/r/B.md', 'C.bin')).toBe('/r/C.bin.md')
    expect(renamedPath('/r/data.json', 'profile.bin')).toBe('/r/profile.bin.json')
    expect(renamedPath('/r/data.json', 'profile.pdf')).toBe('/r/profile.pdf')
  })

  it('a DIRECTORY renames with no extension logic at all (E1b, GRO-2241)', () => {
    expect(renamedPath('/r/sub/Old', 'New', 'dir')).toBe('/r/sub/New')
    expect(renamedPath('/r/Old', ' Notes.md ', 'dir')).toBe('/r/Notes.md') // a folder may be NAMED like a file
    expect(renamedPath('/r/Old', 'Old', 'dir')).toBe('/r/Old') // unchanged → caller no-op
  })
})
