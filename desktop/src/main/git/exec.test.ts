import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GIT_CANDIDATES, GIT_TIMEOUT_CODE, git, gitCandidates, installGitHint, resolveGit } from './exec'
import { requireGit } from './gitFixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

/** A temp dir that is NOT a repo — `os.tmpdir()` is never inside one, so git calls in it fail predictably. */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mdapp-exec-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

describe('resolveGit', () => {
  it('returns null when no candidate exists', async () => {
    expect(await resolveGit(['/nope/bin/git', '/also/nope/git'])).toBeNull()
  })

  it('ignores a candidate that is a directory rather than a binary', async () => {
    expect(await resolveGit([await tempDir()])).toBeNull()
  })

  it('finds this machine’s git among the defaults', async () => {
    const bin = await resolveGit()
    expect(GIT_CANDIDATES).toContain(bin)
  })
})

describe('gitCandidates', () => {
  it('on a Mac prefers the Command Line Tools shim, then Homebrew', () => {
    expect(gitCandidates('darwin')).toEqual(['/usr/bin/git', '/opt/homebrew/bin/git'])
  })

  it('on Windows lists Git for Windows under each install prefix, cmd launcher before bin', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }
    const got = gitCandidates('win32', env)
    // path.join on the host (posix here) normalises separators; assert on the shape, not the slash.
    const norm = got.map((p) => p.replace(/\\/g, '/'))
    expect(norm).toEqual([
      'C:/Program Files/Git/cmd/git.exe',
      'C:/Program Files/Git/bin/git.exe',
      'C:/Program Files (x86)/Git/cmd/git.exe',
      'C:/Program Files (x86)/Git/bin/git.exe',
      'C:/Users/me/AppData/Local/Programs/Git/cmd/git.exe',
      'C:/Users/me/AppData/Local/Programs/Git/bin/git.exe',
    ])
  })

  it('on Windows skips a prefix whose env var is missing rather than producing a relative path', () => {
    const got = gitCandidates('win32', { ProgramFiles: 'C:\\Program Files' })
    expect(got).toHaveLength(2)
    expect(got.every((p) => p.startsWith('C:'))).toBe(true)
  })

  it('never contains a bare name — every candidate is absolute, so nothing is ever a PATH lookup', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      for (const p of gitCandidates(platform, { ProgramFiles: 'C:\\Program Files' })) expect(p).toMatch(/^(\/|[A-Z]:)/)
    }
  })
})

describe('installGitHint', () => {
  it('sends a Mac to xcode-select and a PC to git-scm.com', () => {
    expect(installGitHint('darwin')).toContain('xcode-select --install')
    expect(installGitHint('win32')).toContain('https://git-scm.com/download/win')
    expect(installGitHint('linux')).toContain('package manager')
  })
})

describe('git', () => {
  it('resolves a non-zero exit with stderr instead of rejecting', async () => {
    const res = await git(await requireGit(), await tempDir(), ['rev-parse', '--is-inside-work-tree'])
    expect(res.code).toBeGreaterThan(0)
    expect(res.stderr).toMatch(/not a git repository/i)
    expect(res.stdout).toBe('')
  })

  it('resolves code 0 with stdout for a successful run', async () => {
    const res = await git(await requireGit(), await tempDir(), ['--version'])
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/^git version /)
  })

  it('rejects with ENOENT for a bogus binary path — a spawn failure is not a git exit code', async () => {
    await expect(git('/definitely/not/a/git', await tempDir(), ['--version'])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('kills a hung child on timeout and resolves -1', async () => {
    // `hash-object --stdin` blocks reading stdin, which execFile opens as a pipe and never closes:
    // a reliably hanging git that needs no repo, no network and no credentials.
    const t0 = Date.now()
    const res = await git(await requireGit(), await tempDir(), ['hash-object', '--stdin'], { timeoutMs: 100 })
    expect(res.code).toBe(GIT_TIMEOUT_CODE)
    expect(res.stderr).toMatch(/timed out/)
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})
