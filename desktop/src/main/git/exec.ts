import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Git runner (YAZ-1081 2A) — the one place this app starts a child process, and the documented
 * exception (D1) to the no-spawn ruling in `fs/openInVsCode.ts`.
 *
 * That ruling's objection is specific: a packaged app has no developer `PATH`, so "find the tool
 * and run it" resolves differently (or not at all) on every machine, and a shell would hand the
 * child this process' environment plus a parser for its arguments. GitHub sync has no deep link
 * to hide behind — `fetch`/`commit`/`push` only exist as a binary — so it takes the objection
 * seriously instead of waiving it: the binary is an EXPLICIT absolute path picked from a fixed
 * candidate list (never a `PATH` lookup), `execFile` runs it with no shell, and the environment
 * is narrowed on the way in. The caller assembles argv; nothing is interpolated into a string.
 *
 * Non-zero exits are DATA, not failures — "no origin", "nothing to commit", "auth rejected" are
 * all normal states of a sync pass and each caller classifies them differently. Only a
 * spawn-level failure (no such binary, no permission) rejects.
 */

/**
 * Where each OS keeps git, in the order we prefer it. Still a fixed list of absolute paths per
 * platform — never a `PATH` lookup — so the ruling above holds on Windows exactly as on a Mac.
 *
 *   - darwin: Apple's Command Line Tools shim, then Homebrew (Apple Silicon prefix). Presence is
 *     not proof it WORKS — on a Mac without CLT installed, `/usr/bin/git` still exists as a shim
 *     that pops the installer dialog and exits non-zero. Callers that need certainty run
 *     `git --version` and treat a non-zero exit as "no git".
 *   - win32: Git for Windows (git-scm.com), whose installer ships the Git Credential Manager, so a
 *     GitHub sign-in survives the way the macOS keychain does. `cmd\git.exe` is the launcher
 *     meant for callers outside its own shell; `bin\git.exe` is the fallback. Machine-wide
 *     installs land under `%ProgramFiles%` (the 32-bit prefix is the legacy install location),
 *     per-user installs under `%LOCALAPPDATA%\Programs`. The env vars are read at call time so
 *     a test can pin them; a missing var simply contributes nothing.
 *   - anything else (Linux): the distro package and the source-install prefix.
 */
export function gitCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): readonly string[] {
  if (platform === 'darwin') return ['/usr/bin/git', '/opt/homebrew/bin/git']
  if (platform === 'win32') {
    const out: string[] = []
    const prefixes = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]
    for (const prefix of prefixes) {
      if (prefix === undefined || prefix === '') continue
      out.push(path.join(prefix, 'Git', 'cmd', 'git.exe'), path.join(prefix, 'Git', 'bin', 'git.exe'))
    }
    return out
  }
  return ['/usr/bin/git', '/usr/local/bin/git']
}

/** This machine's candidate list — the default for `resolveGit` and what the git tests require. */
export const GIT_CANDIDATES: readonly string[] = gitCandidates()

/**
 * The one-line "how to get git" for the `no-git` attention message, per OS. The banner copy in
 * the renderer stays platform-neutral; this is the concrete instruction it carries.
 */
export function installGitHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'git is not installed — open Terminal and run `xcode-select --install`'
  if (platform === 'win32') return 'git is not installed — install Git for Windows from https://git-scm.com/download/win, then reopen the app'
  return 'git is not installed — install it with your package manager (e.g. `sudo apt install git`)'
}

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/** `code` when the run was killed for exceeding its timeout. Negative, so it can never collide with a git exit status. */
export const GIT_TIMEOUT_CODE = -1

/** Long enough for a real `fetch`/`push` over a slow link, short enough that a wedged child can't hang a sync pass forever. */
const DEFAULT_TIMEOUT_MS = 30_000

/** `git status` on a large vault is still kilobytes; 10 MB is a runaway guard, not a working limit. */
const MAX_BUFFER = 10 * 1024 * 1024

/**
 * First candidate that exists as a file, else null. Deliberately uncached: two stats per sync
 * pass is nothing, and a cache would keep answering "no git" after the user installs the Command
 * Line Tools. `stat` follows symlinks, so Homebrew's link to the Cellar counts.
 */
export async function resolveGit(candidates: readonly string[] = GIT_CANDIDATES): Promise<string | null> {
  for (const bin of candidates) {
    const st = await stat(bin).catch(() => null)
    if (st?.isFile() === true) return bin
  }
  return null
}

/**
 * Runs git at the EXPLICIT binary path `bin` inside `root`. No shell, no `PATH` lookup — see the
 * module note on the `openInVsCode.ts` exception.
 *
 * Resolves with the exit code: a non-zero exit NEVER throws, because callers classify it (exit 2
 * from `remote get-url` means "no origin", not an error). Rejects only when the process could not
 * be started at all — `ENOENT` for a missing binary, `EACCES` for a non-executable one.
 *
 * On timeout the child is killed (SIGTERM) and the result resolves with `code`
 * `GIT_TIMEOUT_CODE` (-1) and a `timed out` line appended to stderr, so a wedged git looks like
 * any other classifiable failure to the caller rather than an exception.
 *
 * `timeoutMs` defaults to 30 s; the sync pass's two transfers (`fetch`, `push`) raise it to
 * `TRANSFER_TIMEOUT_MS` (YAZ-1801 D4). `input` is written to the child's stdin and closed.
 */
export function git(bin: string, root: string, args: string[], opts: { timeoutMs?: number; input?: string } = {}): Promise<GitResult> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      {
        cwd: root,
        timeout,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf8',
        // Merged over the inherited environment rather than replacing it — git still needs HOME
        // (its config) and the proxy vars. GIT_TERMINAL_PROMPT=0 makes a missing or expired
        // credential fail fast: without it a `fetch` over HTTPS blocks on a username prompt that
        // no one can ever answer, and a background sync pass hangs until the timeout. Askpass and
        // the macOS keychain helper are unaffected, so a stored credential still works.
        // GIT_OPTIONAL_LOCKS=0 keeps read-only calls (`status`) from writing the index, so a sync
        // poll never fights an editor or the user's own terminal for `.git/index.lock`.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      },
      (err, stdout, stderr) => {
        if (err === null) {
          resolve({ code: 0, stdout, stderr })
          return
        }
        // execFile reports a non-zero exit as an ERROR carrying the streams; `code` is the numeric
        // exit status. A spawn failure carries an errno STRING instead ('ENOENT'), and a killed
        // child carries null. That three-way split is the whole classification.
        const code: unknown = (err as NodeJS.ErrnoException).code
        if (typeof code === 'number') {
          resolve({ code, stdout, stderr })
          return
        }
        if (code === null || code === undefined) {
          const note = `git: timed out after ${timeout}ms`
          resolve({ code: GIT_TIMEOUT_CODE, stdout, stderr: stderr === '' ? note : `${stderr.trimEnd()}\n${note}` })
          return
        }
        reject(err)
      },
    )
    // `input` (YAZ-1801): the list a `--batch` reader takes on stdin (`cat-file --batch-check`).
    // Still no shell — it is bytes on a pipe, never parsed as a command line. An EPIPE from a child
    // that exits early is swallowed here; its exit code is what the caller classifies.
    if (opts.input !== undefined) {
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(opts.input)
    }
  })
}

/** One `-z` listing as paths; a failed listing is an empty one (a guard built on it is then a no-op, never a stop). */
export const zList = (res: GitResult): string[] => (res.code === 0 ? res.stdout.split('\0').filter((p) => p !== '') : [])
