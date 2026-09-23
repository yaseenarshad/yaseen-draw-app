import { describe, expect, it } from 'vitest'
import { basename, boardFolder, stripExt, vaultPath } from './paths'

describe('basename', () => {
  it('returns the last segment, ignoring trailing slashes', () => {
    expect(basename('/a/b/c.excalidraw')).toBe('c.excalidraw')
    expect(basename('/a/b/')).toBe('b')
    expect(basename('/')).toBe('/')
  })
})

describe('stripExt', () => {
  it('strips the vault extension, case-insensitive', () => {
    expect(stripExt('Board.excalidraw')).toBe('Board')
    expect(stripExt('Board.EXCALIDRAW')).toBe('Board')
  })

  it('leaves every other name alone — nothing else vouches for what its bytes are', () => {
    expect(stripExt('notes.txt')).toBe('notes.txt')
    expect(stripExt('note.md')).toBe('note.md')
    expect(stripExt('database')).toBe('database')
  })
})

describe('boardFolder', () => {
  it('is the vault-relative folder, `/` at the root, however deep', () => {
    expect(boardFolder('/v', '/v/a.excalidraw')).toBe('/')
    expect(boardFolder('/v', '/v/Nested/Deeper/b.excalidraw')).toBe('Nested/Deeper')
    expect(boardFolder('/v', '/vault2/c.excalidraw')).toBe('/vault2') // a sibling root is not inside /v
  })
})

describe('vaultPath', () => {
  it("joins git's POSIX relative path onto the root in the root's own separator", () => {
    expect(vaultPath('/v', 'Folder/Big video.mov')).toBe('/v/Folder/Big video.mov')
    expect(vaultPath('C:\\Users\\me\\Notes', 'Folder/Big video.mov')).toBe('C:\\Users\\me\\Notes\\Folder\\Big video.mov')
    expect(vaultPath('C:\\', 'a.excalidraw')).toBe('C:\\a.excalidraw')
  })
})
