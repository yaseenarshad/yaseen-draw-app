import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { datedFolderSeed, entryPath, renamedPath, renameInputName, targetDirFor, validateEntryName } from './createEntry'

const dir = (path: string): TreeNode => ({ type: 'dir', name: path.split('/').pop()!, path, children: [] })
const file = (path: string): TreeNode => ({ type: 'file', name: path.split('/').pop()!, path, size: 0, mtime: 1, kind: 'drawing' })

describe('validateEntryName', () => {
  it('accepts plain names', () => {
    expect(validateEntryName('Notes')).toBeNull()
    expect(validateEntryName('my drawing.excalidraw')).toBeNull()
  })

  it('rejects slashes, leading dots, and NUL', () => {
    expect(validateEntryName('a/b')).toMatch(/\//)
    expect(validateEntryName('.hidden')).toMatch(/hidden/i)
    expect(validateEntryName('a\0b')).not.toBeNull()
  })
})

describe('entryPath', () => {
  it('appends .excalidraw to file names without the drawing extension', () => {
    expect(entryPath('/r', 'sketch', 'file')).toBe('/r/sketch.excalidraw')
    expect(entryPath('/r', 'sketch.txt', 'file')).toBe('/r/sketch.txt.excalidraw')
  })

  it('keeps an existing drawing extension, case-insensitive', () => {
    expect(entryPath('/r', 'sketch.excalidraw', 'file')).toBe('/r/sketch.excalidraw')
    expect(entryPath('/r', 'sketch.EXCALIDRAW', 'file')).toBe('/r/sketch.EXCALIDRAW')
  })

  it('uses dir names as-is and trims whitespace', () => {
    expect(entryPath('/r', 'Folder', 'dir')).toBe('/r/Folder')
    expect(entryPath('/r', '  sketch ', 'file')).toBe('/r/sketch.excalidraw')
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
    expect(targetDirFor(file('/r/sub/a.excalidraw'), '/r')).toBe('/r/sub')
    expect(targetDirFor(null, '/r')).toBe('/r')
  })
})

describe('renameInputName', () => {
  it('hides only the final drawing suffix', () => {
    expect(renameInputName('B.excalidraw')).toBe('B')
    expect(renameInputName('Guide.txt.excalidraw')).toBe('Guide.txt')
    expect(renameInputName('Version 1.0.excalidraw')).toBe('Version 1.0')
  })

  it('keeps the full filename for every other kind — nothing else has a suffix we vouch for', () => {
    expect(renameInputName('data.json')).toBe('data.json')
    expect(renameInputName('report.PDF')).toBe('report.PDF')
    expect(renameInputName('tool.Py')).toBe('tool.Py')
    expect(renameInputName('schema.graphql.ts')).toBe('schema.graphql.ts')
    expect(renameInputName('archive.bin')).toBe('archive.bin')
  })
})

describe('renamedPath (Links E1, GRO-2194)', () => {
  it('same parent dir; the OLD extension re-appends when no drawing one is typed', () => {
    expect(renamedPath('/r/sub/B.excalidraw', 'C')).toBe('/r/sub/C.excalidraw')
    expect(renamedPath('/r/B.excalidraw', '  C  ')).toBe('/r/C.excalidraw')
  })

  it('a typed drawing extension is kept as typed', () => {
    expect(renamedPath('/r/B.excalidraw', 'C.excalidraw')).toBe('/r/C.excalidraw')
    expect(renamedPath('/r/B.excalidraw', 'C.EXCALIDRAW')).toBe('/r/C.EXCALIDRAW')
  })

  it('an unchanged name round-trips to the same path (the caller treats it as a no-op)', () => {
    expect(renamedPath('/r/B.excalidraw', 'B')).toBe('/r/B.excalidraw')
  })

  it('round-trips unchanged unsupported names without duplicating their extensions', () => {
    expect(renamedPath('/r/data.json', 'data.json')).toBe('/r/data.json')
    expect(renamedPath('/r/report.PDF', 'report.PDF')).toBe('/r/report.PDF')
  })

  it('preserves the current suffix of an unsupported file when a bare basename is typed', () => {
    expect(renamedPath('/r/data.json', 'profile')).toBe('/r/profile.json')
    expect(renamedPath('/r/report.PDF', 'brief')).toBe('/r/brief.PDF')
    expect(renamedPath('/r/data.json', 'profile.bin')).toBe('/r/profile.bin.json')
  })

  it('an explicit drawing suffix wins over the old one — the only conversion the rename allows', () => {
    expect(renamedPath('/r/data.json', 'profile.excalidraw')).toBe('/r/profile.excalidraw')
    expect(renamedPath('/r/B.excalidraw', 'C.bin')).toBe('/r/C.bin.excalidraw')
  })

  it.each([
    ['Version 1.0.excalidraw', 'Version 1.0'],
    ['Release.1.json', 'Release.1.json'],
    ['report.final.PDF', 'report.final.PDF'],
    ['schema.graphql.ts', 'schema.graphql.ts'],
  ])('round-trips a dotted or compound filename exactly: %s', (name, input) => {
    expect(renameInputName(name)).toBe(input)
    expect(renamedPath(`/r/${name}`, input)).toBe(`/r/${name}`)
  })

  it('renames dotted basenames while preserving the old exact suffix', () => {
    expect(renamedPath('/r/Release.1.json', 'Release.2')).toBe('/r/Release.2.json')
    expect(renamedPath('/r/report.final.PDF', 'summary.final')).toBe('/r/summary.final.PDF')
    expect(renamedPath('/r/Guide.txt.excalidraw', 'Manual.txt')).toBe('/r/Manual.txt.excalidraw')
  })

  it('a DIRECTORY renames with no extension logic at all (E1b, GRO-2241)', () => {
    expect(renamedPath('/r/sub/Old', 'New', 'dir')).toBe('/r/sub/New')
    expect(renamedPath('/r/Old', ' Notes.excalidraw ', 'dir')).toBe('/r/Notes.excalidraw') // a folder may be NAMED like a file
    expect(renamedPath('/r/Old', 'Old', 'dir')).toBe('/r/Old') // unchanged → caller no-op
  })
})
