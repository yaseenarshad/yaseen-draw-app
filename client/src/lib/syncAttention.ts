import type { GithubSyncAttention, GithubSyncStatus } from '@shared/types'
import { basename } from './paths'

/**
 * What to SAY when sync is stuck (YAZ-1081 3B) — the whole reason `GithubSyncAttention` is a
 * closed set: each value is a different sentence to a person, not a different error code.
 *
 * Pure and separate from the banner that renders it, because the copy is the part worth
 * testing: two of these six reasons are things the app cannot fix from inside itself (git
 * missing, credentials rejected), so the honest affordance is a prompt the user pastes into an
 * LLM that CAN drive their terminal — not a dead end, and not a wizard we would have to keep
 * correct against every future macOS/Windows/git/GitHub change.
 */

export interface AttentionCopy {
  title: string
  body: string
  /** Whether the banner offers "Copy setup prompt" — true only for the machine-setup reasons. */
  showSetupPrompt: boolean
  /**
   * Whether the banner offers Dismiss. False only for `too-large` (YAZ-1801 D3): a file that is
   * silently not backed up is exactly what a dismissed banner would hide, so it stays until the
   * status clears (the file shrinks, moves out, or goes).
   */
  dismissible: boolean
}

/** Fixed copy per reason; `error` alone is dynamic, carrying the engine's own message. */
const COPY: Record<GithubSyncAttention, Omit<AttentionCopy, 'body' | 'dismissible'> & { body: string | null }> = {
  'no-git': {
    title: "Git isn't installed on this computer.",
    body: 'Copy the setup prompt into any LLM and it will walk you through installing it.',
    showSetupPrompt: true,
  },
  'no-identity': {
    title: "Git doesn't know who you are yet.",
    body: 'One-time setup: a name and email for your commits. The setup prompt walks you through it.',
    showSetupPrompt: true,
  },
  auth: {
    title: "GitHub didn't accept this computer's credentials.",
    body: 'Copy the setup prompt into any LLM and it will walk you through signing in.',
    showSetupPrompt: true,
  },
  conflict: {
    // YAZ-1897: ordinary conflicts are merged; this is the rare pass that had to stop instead.
    title: "Sync couldn't finish merging with the other computer.",
    // The lossless rule (git/resolve.ts): the working tree was put back exactly as it was.
    body: 'Nothing was lost — your local version is untouched. Resolve in GitHub Desktop, then sync again.',
    showSetupPrompt: false,
  },
  error: {
    title: 'Sync hit a problem.',
    body: null, // filled from `status.message`
    showSetupPrompt: false,
  },
  // YAZ-1801 D3: the body names the file(s), so it is built in `attentionCopy` from `status.tooLarge`.
  'too-large': {
    title: 'A file is too big for GitHub.',
    body: null,
    showSetupPrompt: false,
  },
}

/**
 * What a held-back file's cloud-off icon says (hover and screen reader), and what the chip's hover
 * leads with — ONE phrase for the one fact (YAZ-1801 D3). "100 MB" is GitHub's own number; the
 * guard holds files back a margin under it (`GITHUB_FILE_LIMIT_BYTES`).
 */
export const TOO_LARGE_LABEL = "Over GitHub's 100 MB limit — only on this Mac"

/**
 * The `too-large` body (YAZ-1801 D3): WHICH files, by base name (the full paths are on the sidebar
 * rows' icons), and the three facts that make it calm rather than alarming — it is safe on this
 * Mac, nothing else is held up, and here is how to fix it.
 */
function tooLargeBody(paths: readonly string[]): string {
  const names = paths.map(basename)
  const many = names.length > 1
  const subject = many ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? 'A file')
  return `${subject} ${many ? 'are' : 'is'} over GitHub's 100 MB limit. ${many ? 'They stay' : 'It stays'} on this Mac only. Everything else is synced. ${many ? 'Shrink them' : 'Shrink it'} (Settings › Storage) or move ${many ? 'them' : 'it'} out of the vault.`
}

/**
 * The banner's words for a status, or null when there is nothing to say — every state except
 * `attention` is either fine or in progress, and none of them gets a banner.
 *
 * An `attention` with no `attention` field at all falls back to the `error` copy: the state is
 * the claim, the reason is the detail, and a missing detail must not silence a real problem.
 */
export function attentionCopy(status: GithubSyncStatus): AttentionCopy | null {
  if (status.state !== 'attention') return null
  const entry = COPY[status.attention ?? 'error']
  if (status.attention === 'too-large') {
    const paths = status.tooLarge ?? []
    return { title: paths.length > 1 ? `${paths.length} files are too big for GitHub.` : entry.title, body: tooLargeBody(paths), showSetupPrompt: false, dismissible: false }
  }
  return { title: entry.title, body: entry.body ?? status.message ?? 'git reported an error.', showSetupPrompt: entry.showSetupPrompt, dismissible: true }
}

/** One short clause naming what went wrong, for the prompt's "It reported:" slot. */
const REASON: Record<GithubSyncAttention, string> = {
  'no-git': 'git is not installed on this computer',
  'no-identity': 'git has no user.name or user.email configured',
  auth: "GitHub did not accept this computer's credentials",
  conflict: 'it could not finish merging changes from another computer, so it stopped without changing anything',
  error: 'git reported an error',
  'too-large': 'a file in the folder is over GitHub\'s 100 MB per-file limit',
}

/**
 * Where the main process looks for git (`desktop/src/main/git/exec.ts` `gitCandidates`), in words
 * the assistant on the other end can act on. Keyed by the same OS the renderer already reads for
 * keymaps (`navigator.platform`): a Windows platform string starts with `Win`, a Mac's with
 * `Mac`; anything else is treated as Linux.
 */
function gitLocation(platform: string): { os: string; where: string } {
  if (/^Win/i.test(platform)) return { os: 'Windows', where: 'Git for Windows installed (C:\\Program Files\\Git\\cmd\\git.exe, or the per-user install under %LOCALAPPDATA%\\Programs\\Git) — from https://git-scm.com/download/win' }
  if (/^Mac/i.test(platform)) return { os: 'Mac', where: 'git installed at /usr/bin/git or /opt/homebrew/bin/git' }
  return { os: 'Linux', where: 'git installed at /usr/bin/git or /usr/local/bin/git' }
}

/**
 * The paste-into-an-LLM setup prompt. It states the situation, names the reason, and lists the
 * four things to CHECK in order — so the assistant on the other end diagnoses rather than
 * guessing, and the user gets a verified fix instead of a plausible one. The OS and git's
 * location are named for THIS machine, so the assistant does not have to guess which one it is.
 */
export function buildSetupPrompt(root: string, attention: GithubSyncAttention, platform: string = navigator.platform): string {
  const { os, where } = gitLocation(platform)
  return `I'm using a ${os} desktop app that syncs a folder of boards (Excalidraw .excalidraw and draw.io .drawio files) to GitHub using my computer's own git. It reported: ${REASON[attention]}. Please walk me through fixing this step by step, checking as we go: (1) ${where}, (2) \`git config --global user.name\` and \`user.email\` set, (3) GitHub authentication working for HTTPS (credential helper, e.g. via GitHub Desktop sign-in) or SSH — whichever my repo's remote uses, (4) a test \`git push\` from my notes folder succeeds. My notes folder is: ${root}.`
}
