/**
 * The attention copy (YAZ-1081 3B): one sentence per reason, because the reason set is closed
 * precisely so each value is a different thing to SAY. Only `attention` gets a banner, only the
 * machine-setup reasons offer the paste-into-an-LLM prompt, and `error` speaks with the
 * engine's own message rather than inventing one.
 */
import { describe, expect, it } from 'vitest'
import type { GithubSyncAttention, GithubSyncStatus } from '@shared/types'
import { attentionCopy, buildSetupPrompt } from './syncAttention'

const status = (extra: Partial<GithubSyncStatus> = {}): GithubSyncStatus => ({ root: '/vault', state: 'attention', ...extra })

describe('attentionCopy', () => {
  it.each(['off', 'synced', 'pending', 'syncing'] as const)('%s has nothing to say — no banner', (state) => {
    expect(attentionCopy(status({ state, attention: 'auth' }))).toBeNull()
  })

  it('no-git names the missing tool and offers the prompt', () => {
    expect(attentionCopy(status({ attention: 'no-git' }))).toEqual({
      title: "Git isn't installed on this computer.",
      body: 'Copy the setup prompt into any LLM and it will walk you through installing it.',
      showSetupPrompt: true,
      dismissible: true,
    })
  })

  it('no-identity frames it as one-time setup, not a failure, and offers the prompt', () => {
    expect(attentionCopy(status({ attention: 'no-identity' }))).toEqual({
      title: "Git doesn't know who you are yet.",
      body: 'One-time setup: a name and email for your commits. The setup prompt walks you through it.',
      showSetupPrompt: true,
      dismissible: true,
    })
  })

  it('auth blames the credentials, not the user, and offers the prompt', () => {
    expect(attentionCopy(status({ attention: 'auth' }))).toEqual({
      title: "GitHub didn't accept this computer's credentials.",
      body: 'Copy the setup prompt into any LLM and it will walk you through signing in.',
      showSetupPrompt: true,
      dismissible: true,
    })
  })

  it('conflict leads with the lossless promise and points at GitHub Desktop — no prompt', () => {
    expect(attentionCopy(status({ attention: 'conflict' }))).toEqual({
      title: 'Both machines changed the same lines.',
      body: 'Nothing was lost — your local version is untouched. Resolve in GitHub Desktop, then sync again.',
      showSetupPrompt: false,
      dismissible: true,
    })
  })

  it("error speaks the engine's own message — no prompt, because there is nothing generic to set up", () => {
    expect(attentionCopy(status({ attention: 'error', message: 'fatal: unable to access remote' }))).toEqual({
      title: 'Sync hit a problem.',
      body: 'fatal: unable to access remote',
      showSetupPrompt: false,
      dismissible: true,
    })
  })

  it('error with no message still says something rather than rendering blank', () => {
    expect(attentionCopy(status({ attention: 'error' }))?.body).toBe('git reported an error.')
  })

  it('too-large names the file, says it is safe here and everything else synced, and cannot be dismissed (YAZ-1801 D3)', () => {
    const copy = attentionCopy(status({ attention: 'too-large', tooLarge: ['Folder/Huge board.excalidraw'] }))
    expect(copy?.title).toBe('A file is too big for GitHub.')
    expect(copy?.body).toContain('Huge board.excalidraw is over GitHub')
    expect(copy?.body).toContain('It stays on this Mac only. Everything else is synced. Shrink it (Settings › Storage) or move it out of the vault.')
    expect(copy?.dismissible).toBe(false)
    expect(copy?.showSetupPrompt).toBe(false)
  })

  it('too-large with several files counts them in the title and names them all', () => {
    const copy = attentionCopy(status({ attention: 'too-large', tooLarge: ['a.excalidraw', 'b/Big video.mov'] }))
    expect(copy?.title).toBe('2 files are too big for GitHub.')
    expect(copy?.body).toContain('a.excalidraw and Big video.mov are over')
    expect(copy?.body).toContain('They stay on this Mac only.')
  })

  it('attention with no reason at all falls back to error copy — a real problem is never silenced', () => {
    expect(attentionCopy(status())?.title).toBe('Sync hit a problem.')
  })
})

const REASONS: GithubSyncAttention[] = ['no-git', 'no-identity', 'auth', 'conflict', 'error', 'too-large']

describe('buildSetupPrompt', () => {
  it.each(REASONS)('%s names the folder and lists all four checks in order', (reason) => {
    const prompt = buildSetupPrompt('/Users/me/Notes', reason)
    expect(prompt).toContain('My notes folder is: /Users/me/Notes.')
    expect(prompt).toContain('(1) git installed at /usr/bin/git or /opt/homebrew/bin/git')
    expect(prompt).toContain('(2) `git config --global user.name` and `user.email` set')
    expect(prompt).toContain('(3) GitHub authentication working for HTTPS')
    expect(prompt).toContain('(4) a test `git push` from my notes folder succeeds')
    // Ordering matters: the assistant on the other end should diagnose top-down, not guess.
    expect(prompt.indexOf('(1)')).toBeLessThan(prompt.indexOf('(2)'))
    expect(prompt.indexOf('(2)')).toBeLessThan(prompt.indexOf('(3)'))
    expect(prompt.indexOf('(3)')).toBeLessThan(prompt.indexOf('(4)'))
  })

  it.each([
    ['no-git', 'git is not installed on this computer'],
    ['no-identity', 'git has no user.name or user.email configured'],
    ['auth', "GitHub did not accept this computer's credentials"],
    ['conflict', 'both machines changed the same lines and the merge conflicted'],
    ['error', 'git reported an error'],
  ] as Array<[GithubSyncAttention, string]>)('%s reports its own reason line', (reason, line) => {
    expect(buildSetupPrompt('/vault', reason)).toContain(`It reported: ${line}.`)
  })

  it('opens by explaining the situation, so the prompt stands alone in a fresh chat', () => {
    expect(buildSetupPrompt('/vault', 'auth')).toMatch(/^I'm using a Mac desktop app that syncs a folder of drawings to GitHub using my computer's own git\./)
  })

  it('names Windows and Git for Windows on a Windows platform, so the assistant never sends a PC to Homebrew', () => {
    const prompt = buildSetupPrompt('C:\\Users\\me\\Notes', 'no-git', 'Win32')
    expect(prompt).toMatch(/^I'm using a Windows desktop app/)
    expect(prompt).toContain('(1) Git for Windows installed (C:\\Program Files\\Git\\cmd\\git.exe')
    expect(prompt).toContain('https://git-scm.com/download/win')
    expect(prompt).not.toContain('/opt/homebrew')
    expect(prompt).toContain('My notes folder is: C:\\Users\\me\\Notes.')
  })

  it('treats anything that is neither Mac nor Windows as Linux', () => {
    expect(buildSetupPrompt('/vault', 'no-git', 'Linux x86_64')).toContain('(1) git installed at /usr/bin/git or /usr/local/bin/git')
  })
})
