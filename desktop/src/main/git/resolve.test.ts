import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, mkdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GITHUB_FILE_LIMIT_BYTES } from '@shared/types'
import { git } from './exec'
import { makeBareRemote, makeGitRepo, REAL_GIT_TIMEOUT_MS, requireGit, wireOrigin } from './gitFixture'
import { BEFORE_MERGE_REF } from './resolve'
import { syncPass } from './sync'

/**
 * YAZ-1897 against REAL git: two machines and a bare-repo "GitHub", driven through the real
 * `syncPass`. Every scenario ends the same way — both machines sync until they agree, and then
 * they must hold byte-identical vaults — plus the scenario's own outcome (the S-numbers are the
 * catalogue on YAZ-1897).
 */

type El = Record<string, unknown> & { id: string }
const shape = (id: string, over: Partial<El> = {}): El => ({ id, type: 'rectangle', x: 0, index: `a${id}`, version: 1, versionNonce: 1, updated: 1000, isDeleted: false, boundElements: null, ...over })
const board = (elements: El[]): string => `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements, appState: { gridSize: 20 }, files: {} }, null, 2)}\n`
const shapesOf = (text: string): El[] => (JSON.parse(text) as { elements: El[] }).elements

interface Machine {
  root: string
  write: (rel: string, content: string) => Promise<void>
  read: (rel: string) => string
  remove: (rel: string) => Promise<void>
  git: (...args: string[]) => Promise<string>
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

function machine(root: string, bin: string): Machine {
  const abs = (rel: string) => path.join(root, rel)
  return {
    root,
    write: async (rel, content) => {
      await mkdir(path.dirname(abs(rel)), { recursive: true })
      await writeFile(abs(rel), content)
    },
    read: (rel) => readFileSync(abs(rel), 'utf8'),
    remove: (rel) => unlink(abs(rel)),
    git: async (...args) => (await git(bin, root, args)).stdout.trim(),
  }
}

/** Machine A ("Yaseen Draw Test") seeded with `files` and pushed; machine B ("Sam") cloned from it. */
async function twoMachines(files: Record<string, string>): Promise<{ a: Machine; b: Machine }> {
  const bin = await requireGit()
  const remote = await makeBareRemote()
  const repo = await makeGitRepo()
  cleanups.push(remote.cleanup, repo.cleanup)
  for (const [rel, content] of Object.entries(files)) await repo.write(rel, content)
  await repo.run(['add', '-A'])
  await repo.run(['commit', '-m', 'base'])
  await wireOrigin(repo, remote)
  await repo.run(['push', '-u', 'origin', 'HEAD'])
  const bDir = await mkdtemp(path.join(tmpdir(), 'yaseendraw-b-'))
  cleanups.push(() => rm(bDir, { recursive: true, force: true }))
  expect((await git(bin, tmpdir(), ['clone', remote.url, bDir])).code).toBe(0)
  for (const cfg of [['user.name', 'Sam'], ['user.email', 'sam@example.invalid'], ['commit.gpgsign', 'false']]) await git(bin, bDir, ['config', ...cfg])
  return { a: machine(repo.root, bin), b: machine(bDir, bin) }
}

/** Every file's bytes, `.git` excluded. */
function vault(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(root, p).split(path.sep).join('/')] = readFileSync(p, 'utf8')
    }
  }
  walk(root)
  return out
}

/** B has pushed first; A's pass is the one that meets the conflict. Then B pulls, and both must agree. */
async function meet(a: Machine, b: Machine) {
  expect((await syncPass(b.root)).state).toBe('synced')
  const status = await syncPass(a.root)
  expect((await syncPass(b.root)).state).toBe('synced')
  expect(vault(b.root)).toEqual(vault(a.root))
  expect(await a.git('status', '--porcelain')).toBe('')
  return status
}

const r1 = shape('1')
const r2 = shape('2')

describe('resolveRebase via syncPass', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('D2: writes the board rule to .git/info/attributes once, never to the vault', async () => {
    const { a } = await twoMachines({ 'b.excalidraw': board([r1]) })
    await syncPass(a.root)
    await syncPass(a.root)
    expect(readFileSync(path.join(a.root, '.git', 'info', 'attributes'), 'utf8').match(/\*\.excalidraw -merge/g)).toHaveLength(1)
    expect(existsSync(path.join(a.root, '.gitattributes'))).toBe(false)
  })

  it('S1: different shapes edited on each machine — both kept, no clash', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1, r2]) })
    await b.write('b.excalidraw', board([{ ...r1, x: 7, version: 2, updated: 2000 }, r2]))
    await a.write('b.excalidraw', board([r1, { ...r2, x: 13, version: 2, updated: 2000 }]))
    const status = await meet(a, b)
    expect(status.merged).toEqual([{ path: 'b.excalidraw', author: 'Sam', clashes: 0 }])
    expect(shapesOf(a.read('b.excalidraw')).map((e) => e.x)).toEqual([7, 13])
  })

  it('S2: both machines add a shape — the case that used to jam the vault — both kept', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1]) })
    await b.write('b.excalidraw', board([r1, shape('sam', { index: 'a9' })]))
    await a.write('b.excalidraw', board([r1, shape('me', { index: 'a9' })]))
    const status = await meet(a, b)
    expect(status.state).toBe('synced')
    expect(shapesOf(a.read('b.excalidraw')).map((e) => e.id)).toEqual(['1', 'me', 'sam'])
  })

  it('S3 + D4: the same shape on both — newest kept, clash counted, trailer and before-merge ref written', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1, r2]) })
    await b.write('b.excalidraw', board([{ ...r1, x: 7, version: 2, updated: 3000 }, r2]))
    await a.write('b.excalidraw', board([{ ...r1, x: 13, version: 2, updated: 2000 }, { ...r2, x: 5, version: 2, updated: 2000 }]))
    await syncPass(b.root)
    const status = await syncPass(a.root)
    expect(status.merged).toEqual([{ path: 'b.excalidraw', author: 'Sam', clashes: 1 }])
    await meet(a, b)
    expect(shapesOf(a.read('b.excalidraw')).map((e) => e.x)).toEqual([7, 5])
    expect(await a.git('log', '-1', '--format=%B')).toContain('Merged-with: Sam')
    const before = await a.git('show', `${BEFORE_MERGE_REF}:b.excalidraw`)
    expect(shapesOf(before).map((e) => e.x)).toEqual([13, 5])
  })

  it('S4: a shape deleted on one machine and moved on the other survives', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1]) })
    await b.write('b.excalidraw', board([{ ...r1, isDeleted: true, version: 2, updated: 9000 }]))
    await a.write('b.excalidraw', board([{ ...r1, x: 13, version: 2, updated: 2000 }]))
    await meet(a, b)
    expect(shapesOf(a.read('b.excalidraw'))[0]).toMatchObject({ x: 13, isDeleted: false })
  })

  it('S10: the same NEW board created on both machines keeps both — two drawings are never blended', async () => {
    const { a, b } = await twoMachines({ 'keep.md': 'x\n' })
    await b.write('Untitled.excalidraw', board([shape('sam')]))
    await a.write('Untitled.excalidraw', board([shape('me')]))
    const status = await meet(a, b)
    const copy = status.merged?.[0]?.copy ?? ''
    expect(copy).toMatch(/^Untitled \(conflict, .+\)\.excalidraw$/)
    expect(shapesOf(a.read('Untitled.excalidraw'))[0]?.id).toBe('sam')
    expect(shapesOf(a.read(copy))[0]?.id).toBe('me')
  })

  it('S11: a board deleted on one machine and edited on the other comes back with the edit, both ways round', async () => {
    const { a, b } = await twoMachines({ 'x.excalidraw': board([r1]), 'y.excalidraw': board([r2]) })
    await b.remove('x.excalidraw')
    await b.write('y.excalidraw', board([{ ...r2, x: 5, version: 2, updated: 2000 }]))
    await a.write('x.excalidraw', board([{ ...r1, x: 13, version: 2, updated: 2000 }]))
    await a.remove('y.excalidraw')
    await meet(a, b)
    expect(shapesOf(a.read('x.excalidraw'))[0]?.x).toBe(13)
    expect(shapesOf(a.read('y.excalidraw'))[0]?.x).toBe(5)
  })

  it('S13: shares.json and favorites.json merge per entry, silently; another config file keeps ours', async () => {
    const share = (id: string, updatedAt: number) => ({ id, allowDownload: true, sharedAt: 1, updatedAt })
    const shares = (m: Record<string, unknown>) => `${JSON.stringify({ version: 1, shares: m }, null, 2)}\n`
    const favs = (list: string[]) => `${JSON.stringify({ version: 1, favorites: list }, null, 2)}\n`
    const { a, b } = await twoMachines({
      '.yaseendraw/shares.json': shares({ 'old.excalidraw': share('o', 1) }),
      '.yaseendraw/favorites.json': favs(['a.excalidraw', 'b.excalidraw']),
      '.yaseendraw/view.json': '{"x": 0}\n',
    })
    await b.write('.yaseendraw/shares.json', shares({ 'old.excalidraw': share('o', 1), 'sam.excalidraw': share('s', 5) }))
    await b.write('.yaseendraw/favorites.json', favs(['a.excalidraw', 'sam.excalidraw']))
    await b.write('.yaseendraw/view.json', '{"x": 1}\n')
    await a.write('.yaseendraw/shares.json', shares({ 'old.excalidraw': share('o', 1), 'me.excalidraw': share('m', 6) }))
    await a.write('.yaseendraw/favorites.json', favs(['b.excalidraw', 'a.excalidraw', 'me.excalidraw']))
    await a.write('.yaseendraw/view.json', '{"x": 2}\n')
    const status = await meet(a, b)
    expect(status.merged).toBeUndefined()
    expect(Object.keys(JSON.parse(a.read('.yaseendraw/shares.json')).shares).sort()).toEqual(['me.excalidraw', 'old.excalidraw', 'sam.excalidraw'])
    expect(JSON.parse(a.read('.yaseendraw/favorites.json')).favorites).toEqual(['a.excalidraw', 'sam.excalidraw', 'me.excalidraw'])
    expect(a.read('.yaseendraw/view.json')).toBe('{"x": 2}\n')
  })

  it('S15: a board that will not parse on one side keeps both copies instead of writing a broken merge', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1]) })
    await b.write('b.excalidraw', '{ not a scene')
    await a.write('b.excalidraw', board([{ ...r1, x: 13, version: 2, updated: 2000 }]))
    const status = await meet(a, b)
    expect(status.merged?.[0]?.copy).toMatch(/conflict/)
    expect(a.read('b.excalidraw')).toBe('{ not a scene')
  })

  it('S16: several local commits replay one by one, each merged, and the result holds every edit', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1, r2]) })
    await b.write('b.excalidraw', board([r1, r2, shape('sam', { index: 'a8' })]))
    await syncPass(b.root)
    // Two local commits that the pass has to replay onto Sam's.
    await a.write('b.excalidraw', board([{ ...r1, x: 1, version: 2, updated: 2000 }, r2]))
    await a.git('commit', '-am', 'one')
    await a.write('b.excalidraw', board([{ ...r1, x: 1, version: 2, updated: 2000 }, { ...r2, x: 2, version: 2, updated: 2000 }]))
    await a.git('commit', '-am', 'two')
    const status = await meet(a, b)
    expect(status.merged?.[0]?.path).toBe('b.excalidraw')
    expect(shapesOf(a.read('b.excalidraw')).map((e) => [e.id, e.x])).toEqual([
      ['1', 1],
      ['2', 2],
      ['sam', 0],
    ])
  })

  it('S17: a held-back too-large file stays parked and untouched while a board conflict is merged', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1]), 'huge.bin': 'small\n' })
    await b.write('b.excalidraw', board([r1, shape('sam', { index: 'a9' })]))
    await writeFile(path.join(a.root, 'huge.bin'), Buffer.alloc(GITHUB_FILE_LIMIT_BYTES, 1))
    await a.write('b.excalidraw', board([r1, shape('me', { index: 'a9' })]))
    await syncPass(b.root)
    const status = await syncPass(a.root)
    expect(status.state).toBe('attention')
    expect(status.attention).toBe('too-large')
    expect(status.merged?.[0]?.path).toBe('b.excalidraw')
    expect((await readFile(path.join(a.root, 'huge.bin'))).length).toBe(GITHUB_FILE_LIMIT_BYTES)
    expect(shapesOf(a.read('b.excalidraw')).map((e) => e.id)).toEqual(['1', 'me', 'sam'])
  })

  it('a merge that equals the remote is skipped, not a stuck rebase', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1]) })
    // Both deleted the same shape, at different times: the tombstones differ, the merge is the remote's.
    await b.write('b.excalidraw', board([{ ...r1, isDeleted: true, version: 2, updated: 3000 }]))
    await a.write('b.excalidraw', board([{ ...r1, isDeleted: true, version: 2, updated: 2000 }]))
    const status = await meet(a, b)
    expect(status.state).toBe('synced')
    expect(shapesOf(a.read('b.excalidraw'))[0]?.updated).toBe(3000)
  })
})
