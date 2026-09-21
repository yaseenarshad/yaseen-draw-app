import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MAX_FAVORITES, VAULT_CONFIG_DIR } from '@shared/types'
import { failure } from './fs/testFixture'
import { FAVORITES_FILE, getFavorites, isSafeRel, removePath, renamePath, setFavorites, toAbs, toRel } from './favorites'

/**
 * The Favorites list in the vault (YAZ-1766 6A, D11–D14): `.yaseendraw/favorites.json` holds
 * VAULT-RELATIVE POSIX paths; the API speaks absolute ones. Real tmp vaults, like vaultConfig.test.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})

/** A vault with `Notes/n.md`, `Projects/Alpha/deep.md`, `Projects/p.md`, `top.md`. */
async function makeVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-favorites-'))
  roots.push(root)
  await mkdir(path.join(root, 'Notes'))
  await mkdir(path.join(root, 'Projects', 'Alpha'), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, 'Notes', 'n.md'), '# n\n'),
    writeFile(path.join(root, 'Projects', 'Alpha', 'deep.md'), '# deep\n'),
    writeFile(path.join(root, 'Projects', 'p.md'), '# p\n'),
    writeFile(path.join(root, 'top.md'), '# top\n'),
  ])
  return root
}

const file = (root: string) => path.join(root, VAULT_CONFIG_DIR, FAVORITES_FILE)
const onDisk = async (root: string): Promise<unknown> => JSON.parse(await readFile(file(root), 'utf8'))
const seed = async (root: string, content: string) => {
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(file(root), content)
}
const mtimeOf = async (root: string) => (await stat(file(root))).mtimeMs

describe('path helpers', () => {
  it('toRel / toAbs round-trip POSIX relative paths under the root', () => {
    expect(toRel('/v', '/v/Projects/p.md')).toBe('Projects/p.md')
    expect(toAbs('/v', 'Projects/p.md')).toBe('/v/Projects/p.md')
  })

  it('isSafeRel: non-empty, relative, no `..` segment, no NUL', () => {
    expect(isSafeRel('a/b.md')).toBe(true)
    expect(isSafeRel('')).toBe(false)
    expect(isSafeRel('/abs')).toBe(false)
    expect(isSafeRel('../x')).toBe(false)
    expect(isSafeRel('a/../x')).toBe(false)
    expect(isSafeRel('a\0b')).toBe(false)
    expect(isSafeRel(3)).toBe(false)
    expect(isSafeRel('a..b/c')).toBe(true) // `..` inside a name is a name
  })
})

describe('getFavorites / setFavorites', () => {
  it('absent → [], and reading creates nothing', async () => {
    const root = await makeVault()
    expect(await getFavorites(root)).toEqual([])
    expect(await readdir(root)).not.toContain(VAULT_CONFIG_DIR)
  })

  it('set creates .yaseendraw/favorites.json with RELATIVE POSIX entries in order, pretty JSON; get round-trips to absolute', async () => {
    const root = await makeVault()
    const abs = [path.join(root, 'Projects', 'p.md'), path.join(root, 'Notes'), path.join(root, 'top.md')]
    await setFavorites(root, abs)
    const raw = await readFile(file(root), 'utf8')
    expect(raw).toBe(`${JSON.stringify({ version: 1, favorites: ['Projects/p.md', 'Notes', 'top.md'] }, null, 2)}\n`)
    expect(await getFavorites(root)).toEqual(abs)
  })

  it('unsafe (`../x`, `/abs`, ``) and duplicate entries are dropped on read; the cap holds', async () => {
    const root = await makeVault()
    const many = Array.from({ length: MAX_FAVORITES + 5 }, (_, i) => `p${i}.md`)
    await seed(root, JSON.stringify({ version: 1, favorites: ['../x', '/abs', '', 'top.md', 'top.md', 'a/../b', ...many] }))
    const got = await getFavorites(root)
    expect(got).toHaveLength(MAX_FAVORITES)
    expect(got[0]).toBe(path.join(root, 'top.md'))
    expect(got[1]).toBe(path.join(root, 'p0.md'))
  })

  it('malformed JSON or a wrong shape → get [] and set rejects INVALID_CONFIG with the bytes untouched', async () => {
    for (const bad of ['{not json', JSON.stringify({ version: 2, favorites: [] }), JSON.stringify({ favorites: ['top.md'] }), JSON.stringify({ version: 1, favorites: 'top.md' }), '[]']) {
      const root = await makeVault()
      await seed(root, bad)
      expect(await getFavorites(root)).toEqual([])
      const err = await failure(setFavorites(root, [path.join(root, 'top.md')]))
      expect(err.code).toBe('INVALID_CONFIG')
      expect(err.message).toBe('favorites.json is malformed; fix or delete it')
      expect(await readFile(file(root), 'utf8')).toBe(bad)
    }
  })

  it('a path outside the root is BAD_REQUEST before anything is written', async () => {
    const root = await makeVault()
    expect((await failure(setFavorites(root, [path.join(root, 'top.md'), '/elsewhere/x.md']))).code).toBe('BAD_REQUEST')
    expect((await failure(setFavorites(root, [`${root}-sibling/x.md`]))).code).toBe('BAD_REQUEST') // a sibling sharing the prefix
    expect(await readdir(root)).not.toContain(VAULT_CONFIG_DIR)
    expect((await failure(setFavorites('rel', []))).code).toBe('NOT_ABSOLUTE')
  })

  it('set de-duplicates and caps at MAX_FAVORITES', async () => {
    const root = await makeVault()
    const top = path.join(root, 'top.md')
    await setFavorites(root, [top, path.join(root, 'Notes'), top])
    expect(await onDisk(root)).toEqual({ version: 1, favorites: ['top.md', 'Notes'] })
    // The cap: MAX_FAVORITES + 5 existing files (dirs are cheaper to make than files here).
    const dirs = Array.from({ length: MAX_FAVORITES + 5 }, (_, i) => path.join(root, 'many', `d${i}`))
    await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })))
    await setFavorites(root, dirs)
    expect((await getFavorites(root)).length).toBe(MAX_FAVORITES)
  })

  it('set drops entries whose path is gone from disk (D14) and keeps the rest in order', async () => {
    const root = await makeVault()
    await setFavorites(root, [path.join(root, 'Notes'), path.join(root, 'gone.md'), path.join(root, 'Projects', 'Alpha', 'missing'), path.join(root, 'top.md')])
    expect(await onDisk(root)).toEqual({ version: 1, favorites: ['Notes', 'top.md'] })
  })
})

describe('renamePath / removePath repair (D13)', () => {
  it('renamePath remaps a favorited file', async () => {
    const root = await makeVault()
    await setFavorites(root, [path.join(root, 'top.md'), path.join(root, 'Notes')])
    await renamePath([root], path.join(root, 'top.md'), path.join(root, 'Notes', 'moved.md'))
    expect(await onDisk(root)).toEqual({ version: 1, favorites: ['Notes/moved.md', 'Notes'] })
  })

  it('renamePath remaps a favorited dir AND its descendants by prefix, and leaves a same-prefix sibling alone', async () => {
    const root = await makeVault()
    await setFavorites(root, [path.join(root, 'Projects'), path.join(root, 'Projects', 'Alpha', 'deep.md'), path.join(root, 'Projects', 'p.md'), path.join(root, 'top.md')])
    await mkdir(path.join(root, 'Projects2'))
    await setFavorites(root, [...(await getFavorites(root)), path.join(root, 'Projects2')])
    await renamePath([root], path.join(root, 'Projects'), path.join(root, 'Work'))
    expect(await onDisk(root)).toEqual({ version: 1, favorites: ['Work', 'Work/Alpha/deep.md', 'Work/p.md', 'top.md', 'Projects2'] })
  })

  it('an unrelated rename writes nothing (mtime and bytes unchanged)', async () => {
    const root = await makeVault()
    await setFavorites(root, [path.join(root, 'top.md')])
    const before = await readFile(file(root), 'utf8')
    const mtime = await mtimeOf(root)
    await new Promise((r) => setTimeout(r, 20))
    await renamePath([root], path.join(root, 'Notes', 'n.md'), path.join(root, 'Notes', 'm.md'))
    expect(await readFile(file(root), 'utf8')).toBe(before)
    expect(await mtimeOf(root)).toBe(mtime)
  })

  it('a favorite moved OUT of the vault is dropped', async () => {
    const root = await makeVault()
    await setFavorites(root, [path.join(root, 'Notes'), path.join(root, 'top.md')])
    await renamePath([root], path.join(root, 'Notes'), '/elsewhere/Notes')
    expect(await onDisk(root)).toEqual({ version: 1, favorites: ['top.md'] })
  })

  it('removePath drops a deleted file, and a deleted dir with everything under it', async () => {
    const root = await makeVault()
    await setFavorites(root, [path.join(root, 'top.md'), path.join(root, 'Projects'), path.join(root, 'Projects', 'p.md'), path.join(root, 'Notes')])
    await removePath([root], path.join(root, 'top.md'))
    expect(await onDisk(root)).toEqual({ version: 1, favorites: ['Projects', 'Projects/p.md', 'Notes'] })
    await removePath([root], path.join(root, 'Projects'))
    expect(await onDisk(root)).toEqual({ version: 1, favorites: ['Notes'] })
  })

  it('nested roots: the DEEPEST open root owning the path is the one repaired', async () => {
    const root = await makeVault()
    const sub = path.join(root, 'Projects')
    await setFavorites(root, [path.join(sub, 'p.md')])
    await setFavorites(sub, [path.join(sub, 'p.md'), path.join(sub, 'Alpha')])
    await renamePath([root, sub], path.join(sub, 'p.md'), path.join(sub, 'q.md'))
    expect(await onDisk(sub)).toEqual({ version: 1, favorites: ['q.md', 'Alpha'] })
    expect(await onDisk(root)).toEqual({ version: 1, favorites: ['Projects/p.md'] }) // one owner per path
  })

  it('a path under no open root, or an absent / malformed file, leaves everything untouched', async () => {
    const root = await makeVault()
    await setFavorites(root, [path.join(root, 'top.md')])
    const before = await readFile(file(root), 'utf8')
    await renamePath([], path.join(root, 'top.md'), path.join(root, 'x.md'))
    await removePath(['/some/other/vault'], path.join(root, 'top.md'))
    expect(await readFile(file(root), 'utf8')).toBe(before)
    const other = await makeVault()
    await renamePath([other], path.join(other, 'top.md'), path.join(other, 'x.md'))
    expect(await readdir(other)).not.toContain(VAULT_CONFIG_DIR) // absent stays absent
    await seed(other, '{not json')
    await removePath([other], path.join(other, 'top.md'))
    expect(await readFile(file(other), 'utf8')).toBe('{not json')
  })
})
