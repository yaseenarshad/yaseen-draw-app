/**
 * Settings search (YAZ-1679 D6): the candidates are built from the registry — label, hint,
 * keywords, group title, group hint, section title — and the match is the `[[` picker's exact →
 * prefix → substring rule.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { SettingsCtx } from './registry'
import { searchSettings, settingCandidates, type SettingHit } from './searchSettings'

const ctx = (sync?: SettingsCtx['sync']): SettingsCtx => ({ settings: { ...DEFAULT_SETTINGS }, onChange: () => undefined, sync })
const ids = (hits: readonly SettingHit[]) => hits.map((h) => h.item.id)

/** A synthetic candidate list where the three tiers are all present for one needle. */
const tiers: SettingHit[] = (['width of the thread', 'width', 'content width'] as const).map((name) => ({
  section: { id: 'appearance', title: 'Appearance', groups: [] },
  group: { items: [] },
  item: { id: name, label: name, render: () => null },
  name,
  lower: name.toLowerCase(),
}))

describe('settingCandidates', () => {
  it('covers every setting of every available section, one candidate each, in registry order', () => {
    expect(ids(settingCandidates(ctx()))).toEqual([
      'theme',
      'contentWidth',
      'lineSpacing',
      'blockGap',
      'bulletThreading',
      'threadWidth',
      'threadColor',
      'commentsOrder',
      'confirmDelete',
      'newNoteLocation',
      'hotkeys-keyboard',
      'hotkeys-views',
      'hotkeys-window',
      'hotkeys-mouse',
    ])
  })

  it('includes the Sync page only when the engine is there', () => {
    expect(ids(settingCandidates(ctx({ status: null, setEnabled: () => undefined })))).toContain('githubSync')
    expect(ids(settingCandidates(ctx()))).not.toContain('githubSync')
  })

  it('a candidate carries label, hint, keywords, group title and section title, case-folded in `lower`', () => {
    const confirm = settingCandidates(ctx()).find((h) => h.item.id === 'confirmDelete')
    expect(confirm?.name).toBe('Confirm before deleting Deleted notes and folders move to the Trash either way. Files & Links')
    expect(confirm?.lower).toBe(confirm?.name.toLowerCase())
    const width = settingCandidates(ctx()).find((h) => h.item.id === 'threadWidth')
    expect(width?.name).toBe('Line width thread width Bullet threading Guide lines that connect nested bullets. Editor')
    expect(width?.group.title).toBe('Bullet threading')
  })

  it('the sync hint is the live repo fact, so a remote URL is searchable', () => {
    const hit = settingCandidates(ctx({ status: { root: '/v', state: 'synced', repo: { remoteUrl: 'git@github.com:me/notes.git', branch: 'main' } }, setEnabled: () => undefined })).find((h) => h.item.id === 'githubSync')
    expect(hit?.name).toContain('repo git@github.com:me/notes.git · branch main')
  })
})

describe('searchSettings', () => {
  it('ranks exact before prefix before substring — the [[ picker rule', () => {
    expect(searchSettings(tiers, 'width').map((h) => h.name)).toEqual(['width', 'width of the thread', 'content width'])
    expect(searchSettings(tiers, '  WIDTH ').map((h) => h.name)).toEqual(['width', 'width of the thread', 'content width'])
  })

  it('never truncates: every match comes back', () => {
    expect(searchSettings(tiers, 'width')).toHaveLength(3)
  })

  it('matches on a keyword the label does not contain', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'dark'))).toEqual(['theme'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'readable line'))).toEqual(['contentWidth'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'trash'))).toEqual(['confirmDelete'])
  })

  it('matches on the section title, returning every row of that section', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'files & links'))).toEqual(['confirmDelete', 'newNoteLocation'])
  })

  it('matches on the group title: "threading" finds the three threading rows', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'threading'))).toEqual(['bulletThreading', 'threadWidth', 'threadColor'])
  })

  it('the pre-redesign labels still match as keywords: "thread width", "comments order"', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'thread width'))).toEqual(['threadWidth'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'comments order'))).toEqual(['commentsOrder'])
  })

  it('a hotkey label finds its Hotkeys table: "close tab" → Window', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'close tab'))).toEqual(['hotkeys-window'])
    expect(ids(searchSettings(settingCandidates(ctx()), '⌘W'))).toEqual(['hotkeys-window'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'underline'))).toEqual(['hotkeys-keyboard'])
  })

  it('no match is an empty list', () => {
    expect(searchSettings(settingCandidates(ctx()), 'zzzz')).toEqual([])
  })
})
