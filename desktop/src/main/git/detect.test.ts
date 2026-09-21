import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectRepo } from './detect'
import { makeBareRemote, makeGitRepo, requireGit, wireOrigin, type GitRepo } from './gitFixture'

let bin: string
beforeAll(async () => {
  bin = await requireGit()
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function freshRepo(): Promise<GitRepo> {
  const repo = await makeGitRepo()
  cleanups.push(repo.cleanup)
  return repo
}

/** The common case: a repo with one commit and a clean tree. */
async function committedRepo(): Promise<GitRepo> {
  const repo = await freshRepo()
  await repo.write('a.md', '# a\n')
  await repo.run(['add', 'a.md'])
  await repo.run(['commit', '-m', 'init'])
  return repo
}

describe('detectRepo', () => {
  it('reports a plain directory as not a repo', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mdapp-norepo-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    expect(await detectRepo(bin, dir)).toEqual({ isRepo: false, remoteUrl: null, branch: null, dirty: false, dirtyFiles: [] })
  })

  it('reports a clean repo with no remote', async () => {
    const repo = await committedRepo()
    expect(await detectRepo(bin, repo.root)).toEqual({ isRepo: true, remoteUrl: null, branch: 'main', dirty: false, dirtyFiles: [] })
  })

  it('reports origin’s fetch URL once wired', async () => {
    const repo = await committedRepo()
    const remote = await makeBareRemote()
    cleanups.push(remote.cleanup)
    await wireOrigin(repo, remote)
    expect((await detectRepo(bin, repo.root)).remoteUrl).toBe(remote.url)
  })

  it('lists untracked and modified files, unquoting paths with spaces', async () => {
    const repo = await committedRepo()
    await repo.write('a.md', '# a, edited\n')
    await repo.write('new.md', '# new\n')
    await repo.write('spaced name.md', '# spaced\n')
    const facts = await detectRepo(bin, repo.root)
    expect(facts.dirty).toBe(true)
    expect([...facts.dirtyFiles].sort()).toEqual(['a.md', 'new.md', 'spaced name.md'])
  })

  it('takes the new path from a staged rename', async () => {
    const repo = await committedRepo()
    await repo.run(['mv', 'a.md', 'renamed.md'])
    const facts = await detectRepo(bin, repo.root)
    expect(facts.dirty).toBe(true)
    expect(facts.dirtyFiles).toEqual(['renamed.md'])
  })

  it('reports a detached HEAD as no branch', async () => {
    const repo = await committedRepo()
    await repo.run(['checkout', '--detach', 'HEAD'])
    const facts = await detectRepo(bin, repo.root)
    expect(facts.isRepo).toBe(true)
    expect(facts.branch).toBeNull()
  })

  it('reports the unborn branch of a zero-commit repo', async () => {
    const repo = await freshRepo()
    expect(await detectRepo(bin, repo.root)).toEqual({ isRepo: true, remoteUrl: null, branch: 'main', dirty: false, dirtyFiles: [] })
  })
})
