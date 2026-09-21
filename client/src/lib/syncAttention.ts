import type { GithubSyncAttention, GithubSyncStatus } from '@shared/types'

/**
 * What to SAY when sync is stuck (YAZ-1081 3B) — the whole reason `GithubSyncAttention` is a
 * closed set: each value is a different sentence to a person, not a different error code.
 *
 * Pure and separate from the banner that renders it, because the copy is the part worth
 * testing: two of these five reasons are things the app cannot fix from inside itself (git
 * missing, credentials rejected), so the honest affordance is a prompt the user pastes into an
 * LLM that CAN drive their terminal — not a dead end, and not a wizard we would have to keep
 * correct against every future macOS/Windows/git/GitHub change.
 */

export interface AttentionCopy {
  title: string
  body: string
  /** Whether the banner offers "Copy setup prompt" — true only for the machine-setup reasons. */
  showSetupPrompt: boolean
}

/** Fixed copy per reason; `error` alone is dynamic, carrying the engine's own message. */
const COPY: Record<GithubSyncAttention, Omit<AttentionCopy, 'body'> & { body: string | null }> = {
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
    title: 'Both machines changed the same lines.',
    // The lossless rule (git/sync.ts): the working tree was put back exactly as it was.
    body: 'Nothing was lost — your local version is untouched. Resolve in GitHub Desktop, then sync again.',
    showSetupPrompt: false,
  },
  error: {
    title: 'Sync hit a problem.',
    body: null, // filled from `status.message`
    showSetupPrompt: false,
  },
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
  return { title: entry.title, body: entry.body ?? status.message ?? 'git reported an error.', showSetupPrompt: entry.showSetupPrompt }
}

/** One short clause naming what went wrong, for the prompt's "It reported:" slot. */
const REASON: Record<GithubSyncAttention, string> = {
  'no-git': 'git is not installed on this computer',
  'no-identity': 'git has no user.name or user.email configured',
  auth: "GitHub did not accept this computer's credentials",
  conflict: 'both machines changed the same lines and the merge conflicted',
  error: 'git reported an error',
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
  return `I'm using a ${os} desktop app that syncs a folder of drawings to GitHub using my computer's own git. It reported: ${REASON[attention]}. Please walk me through fixing this step by step, checking as we go: (1) ${where}, (2) \`git config --global user.name\` and \`user.email\` set, (3) GitHub authentication working for HTTPS (credential helper, e.g. via GitHub Desktop sign-in) or SSH — whichever my repo's remote uses, (4) a test \`git push\` from my notes folder succeeds. My notes folder is: ${root}.`
}
