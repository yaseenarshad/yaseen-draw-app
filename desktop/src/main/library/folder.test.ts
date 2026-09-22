import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_LIBRARY_DIR, ensureLibraryFolder, resolveLibraryFolder } from './folder'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-library-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('resolveLibraryFolder (🔒 D5)', () => {
  it('null means `<userData>/library` — the default no vault has to know about', () => {
    expect(resolveLibraryFolder(null, '/Users/x/Application Support/Yaseen Draw')).toBe(path.join('/Users/x/Application Support/Yaseen Draw', DEFAULT_LIBRARY_DIR))
  })

  it('a chosen path is used as it stands — pointing it inside a synced vault IS the backup story', () => {
    expect(resolveLibraryFolder('/Users/x/Vault/Library', '/anything')).toBe('/Users/x/Vault/Library')
  })
})

describe('ensureLibraryFolder', () => {
  it('creates the default folder and answers where it is', async () => {
    const folder = await ensureLibraryFolder(null, dir)
    expect(folder).toBe(path.join(dir, DEFAULT_LIBRARY_DIR))
    expect((await stat(folder)).isDirectory()).toBe(true)
  })

  it('creates a chosen folder, parents and all, and is safe to run again', async () => {
    const chosen = path.join(dir, 'a', 'b', 'Library')
    expect(await ensureLibraryFolder(chosen, dir)).toBe(chosen)
    expect(await ensureLibraryFolder(chosen, dir)).toBe(chosen)
    expect((await stat(chosen)).isDirectory()).toBe(true)
  })

  it('a folder it CANNOT create is still the answer — a launch must not fail over it', async () => {
    // A file where the folder should be: mkdir will refuse, and the row still says where it should be.
    const blocked = path.join(dir, 'blocked')
    await writeFile(blocked, 'not a folder')
    await expect(ensureLibraryFolder(blocked, dir)).resolves.toBe(blocked)
  })
})
