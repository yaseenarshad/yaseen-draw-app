import { stat } from 'node:fs/promises'
import path from 'node:path'
import { git } from './exec'

/**
 * Repo detection (YAZ-1081, 2A): everything the sync layer needs to know about a vault root
 * before it decides to do anything, gathered in one pass of read-only git calls.
 *
 * Every question here has a "no" answer that is NORMAL — a vault that isn't a repo, a repo with
 * no origin, a repo mid-rebase on a detached HEAD — so nothing throws for them; they come back as
 * `false`/`null` and the caller decides what to offer the user. Only a spawn-level failure from
 * `exec.ts` (no git binary) propagates, because that is the one condition no policy here can
 * describe.
 */
export interface RepoFacts {
  isRepo: boolean
  /** origin's fetch URL; null when there is no `origin` remote. */
  remoteUrl: string | null
  /** Current branch name; null when detached. */
  branch: string | null
  dirty: boolean
  /** Paths from `git status --porcelain` (for a rename, the NEW path). */
  dirtyFiles: string[]
}

/** Fresh object per call — a shared constant would hand every caller the same mutable `dirtyFiles`. */
function notARepo(): RepoFacts {
  return { isRepo: false, remoteUrl: null, branch: null, dirty: false, dirtyFiles: [] }
}

/**
 * One `git status --porcelain=v1` line → the path it concerns, or null for a line that carries none.
 *
 * Format is `XY<space><path>`, and for a rename or copy the path field is `old -> new` — we want
 * the new one, since that is what exists on disk now. Splitting on the LAST ` -> ` is safe even
 * for odd names because git quotes any path containing a space.
 *
 * Quoting is handled only for the simple quoted-whole-path case: the surrounding quotes are
 * stripped and the C-style escapes git puts INSIDE them (`\303\251` for non-ASCII, `\"`, `\\`)
 * are left as written. A path this mangles is still recognisable in a dirty-file list, which is
 * all this field is for. (`--porcelain -z` would sidestep quoting entirely, at the cost of a
 * different rename record — new path first, NUL-separated. Worth revisiting only if these paths
 * ever become something the app acts on rather than shows.)
 */
function porcelainPath(line: string): string | null {
  if (line.length < 4) return null
  const status = line.slice(0, 2)
  let p = line.slice(3)
  if (status.includes('R') || status.includes('C')) {
    const arrow = p.lastIndexOf(' -> ')
    if (arrow !== -1) p = p.slice(arrow + 4)
  }
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
  return p === '' ? null : p
}

export async function detectRepo(bin: string, root: string): Promise<RepoFacts> {
  // Cheap gate, and a load-bearing one: `rev-parse` walks UP from `cwd`, so a vault nested inside
  // some unrelated repo would otherwise report as a repo. Requiring a `.git` entry at the root
  // itself pins the answer to this directory. A `.git` FILE counts — that is how a linked
  // worktree or a submodule points at its real git dir — so only presence is checked, not type,
  // with `rev-parse --is-inside-work-tree` as the authority on what it actually is.
  if ((await stat(path.join(root, '.git')).catch(() => null)) === null) return notARepo()
  const inside = await git(bin, root, ['rev-parse', '--is-inside-work-tree'])
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return notARepo()

  // Exit 2 is `remote get-url`'s "No such remote" — the normal state of a repo that has never
  // been wired to GitHub, not a failure. Any other non-zero is treated the same way: no URL.
  const remote = await git(bin, root, ['remote', 'get-url', 'origin'])
  const remoteUrl = remote.code === 0 ? remote.stdout.trim() || null : null

  // `rev-parse --abbrev-ref HEAD` prints the branch, or the literal `HEAD` when detached. It
  // FAILS (exit 128) on a repo with zero commits, because the branch HEAD names has no commit to
  // resolve — note it prints `HEAD` to stdout there too, so the exit code is what we branch on.
  // `symbolic-ref` reads HEAD's ref without resolving it, which is exactly the unborn-branch case.
  const head = await git(bin, root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  let branch: string | null
  if (head.code === 0) {
    const name = head.stdout.trim()
    branch = name === 'HEAD' || name === '' ? null : name
  } else {
    const sym = await git(bin, root, ['symbolic-ref', '--short', 'HEAD'])
    branch = sym.code === 0 ? sym.stdout.trim() || null : null
  }

  // Untracked files included (porcelain's default), since an unsynced new note is exactly the
  // state this flag exists to catch. Untracked DIRECTORIES collapse to a single `dir/` entry —
  // fine for "is there anything to commit", and 2B stages with `add -A` regardless.
  const status = await git(bin, root, ['status', '--porcelain=v1'])
  const dirtyFiles =
    status.code === 0
      ? status.stdout
          .split('\n')
          .map(porcelainPath)
          .filter((p): p is string => p !== null)
      : []

  return { isRepo: true, remoteUrl, branch, dirty: dirtyFiles.length > 0, dirtyFiles }
}
