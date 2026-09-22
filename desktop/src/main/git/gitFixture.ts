import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GIT_CANDIDATES, git, resolveGit } from './exec'

/**
 * Test fixtures for the git layer (YAZ-1081, 2A), in the shape of `fs/testFixture.ts`.
 *
 * These run the REAL git, not a mock: the whole point of `detect.ts` is that it reads git's actual
 * output, so a fake would only test the fake. Every repo is a throwaway under the temp dir and
 * every setting is written LOCALLY, so the developer's own `~/.gitconfig` — identity, commit
 * signing, default branch — can never decide whether a test passes.
 */

export interface GitRepo {
  root: string
  /** Writes `<root>/<name>`, creating parent directories. */
  write: (name: string, content: string) => Promise<void>
  /** Runs git in this repo and returns trimmed stdout; THROWS on a non-zero exit, so broken setup is never silent. */
  run: (args: string[]) => Promise<string>
  cleanup: () => Promise<void>
}

export interface BareRemote {
  /** A filesystem path, which is a perfectly good git remote URL and needs no network. */
  url: string
  cleanup: () => Promise<void>
}

/** The machine's git, or a clear failure — these tests cannot run without one. */
export async function requireGit(): Promise<string> {
  const bin = await resolveGit()
  if (bin === null) throw new Error(`no git found at ${GIT_CANDIDATES.join(' or ')}; the git tests need a real one`)
  return bin
}

async function runIn(bin: string, root: string, args: string[]): Promise<string> {
  const res = await git(bin, root, args)
  if (res.code !== 0) throw new Error(`git ${args.join(' ')} exited ${res.code} in ${root}: ${res.stderr.trim()}`)
  return res.stdout.trim()
}

/** A temp repo on `main` with a local identity, ready for `write` + `add` + `commit`. Zero commits until you make one. */
export async function makeGitRepo(): Promise<GitRepo> {
  const bin = await requireGit()
  const root = await mkdtemp(path.join(tmpdir(), 'mdapp-git-'))
  const run = (args: string[]) => runIn(bin, root, args)
  await run(['init', '-b', 'main', '.'])
  await run(['config', 'user.name', 'Yaseen Draw Test'])
  await run(['config', 'user.email', 'test@example.invalid'])
  // A developer with `commit.gpgsign = true` globally would otherwise fail every commit here.
  await run(['config', 'commit.gpgsign', 'false'])
  return {
    root,
    write: async (name, content) => {
      const file = path.join(root, name)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, content, 'utf8')
    },
    run,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

/** A temp bare repo to stand in for GitHub — wire it up with `wireOrigin`, push to it, clone from it. */
export async function makeBareRemote(): Promise<BareRemote> {
  const bin = await requireGit()
  const root = await mkdtemp(path.join(tmpdir(), 'mdapp-remote-'))
  await runIn(bin, root, ['init', '--bare', '-b', 'main', '.'])
  return { url: root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

export async function wireOrigin(repo: GitRepo, remote: BareRemote): Promise<void> {
  await repo.run(['remote', 'add', 'origin', remote.url])
}

/**
 * The ceiling the two REAL-git suites run under (`sync.test.ts`, `guarantees.test.ts`): every case
 * there is a commit plus a push plus a fetch against a bare repo on disk. Vitest's 5 s default is
 * enough on a warm Mac and not on a cold CI runner, and the work is real I/O rather than a hang,
 * so those two describes raise it — and nothing else in the project does.
 */
export const REAL_GIT_TIMEOUT_MS = 20_000
