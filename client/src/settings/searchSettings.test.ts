/**
 * Settings search (YAZ-1679 D6): the candidates are built from the registry — label, hint,
 * keywords, group title, group hint, section title — and the match is the app's ONE matcher's
 * exact → prefix → substring rule.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { SettingsCtx } from './registry'
import { searchSettings, settingCandidates, type SettingHit } from './searchSettings'

const ctx = (sync?: SettingsCtx['sync']): SettingsCtx => ({ settings: { ...DEFAULT_SETTINGS }, onChange: () => undefined, sync })
const ids = (hits: readonly SettingHit[]) => hits.map((h) => h.item.id)

/** A synthetic candidate list where the three tiers are all present for one needle. */
const tiers: SettingHit[] = (['theme of the app', 'theme', 'system theme'] as const).map((name) => ({
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
      'canvas.gridModeEnabled',
      'canvas.objectsSnapModeEnabled',
      'canvas.snapToMidpoints',
      'canvas.arrowBinding',
      'canvas.selectOn',
      'canvas.toolLock',
      'canvas.zenModeEnabled',
      'canvas.writingMode',
      'canvas.framesVisible',
      'canvas.writingStrokeWidth',
      'canvas.vectorStrokeWidth',
      'canvas.defaultFontFamily',
      'canvas.defaultRoughness',
      'canvas.defaultTextAlign',
      'confirmDelete',
      'hoverPreview',
      'libraryFolder',
      'pixabayApiKey',
      'hotkeys-window',
      'hotkeys-canvas',
      'hotkeys-mouse',
    ])
  })

  it('includes the Sync page only when the engine is there', () => {
    expect(ids(settingCandidates(ctx({ status: null, setEnabled: () => undefined })))).toContain('githubSync')
    expect(ids(settingCandidates(ctx()))).not.toContain('githubSync')
  })

  it('a candidate carries label, hint, keywords and section title, case-folded in `lower`', () => {
    const confirm = settingCandidates(ctx()).find((h) => h.item.id === 'confirmDelete')
    expect(confirm?.name).toBe('Confirm before deleting Deleted drawings and folders move to the Trash either way. Files')
    expect(confirm?.lower).toBe(confirm?.name.toLowerCase())
    const theme = settingCandidates(ctx()).find((h) => h.item.id === 'theme')
    expect(theme?.name).toBe('Theme dark light system Appearance')
  })

  it('a hotkey table carries its group title and every key and label of the table', () => {
    const window = settingCandidates(ctx()).find((h) => h.item.id === 'hotkeys-window')
    expect(window?.group.title).toBe('Window')
    expect(window?.name).toContain('⌘W')
    expect(window?.name).toContain('Close tab')
    expect(window?.name).toContain('keyboard shortcuts')
  })

  it('the sync hint is the live repo fact, so a remote URL is searchable', () => {
    const hit = settingCandidates(ctx({ status: { root: '/v', state: 'synced', repo: { remoteUrl: 'git@github.com:me/notes.git', branch: 'main' } }, setEnabled: () => undefined })).find((h) => h.item.id === 'githubSync')
    expect(hit?.name).toContain('repo git@github.com:me/notes.git · branch main')
  })
})

describe('searchSettings', () => {
  it('ranks exact before prefix before substring — the one matcher\'s rule', () => {
    expect(searchSettings(tiers, 'theme').map((h) => h.name)).toEqual(['theme', 'theme of the app', 'system theme'])
    expect(searchSettings(tiers, '  THEME ').map((h) => h.name)).toEqual(['theme', 'theme of the app', 'system theme'])
  })

  it('never truncates: every match comes back', () => {
    expect(searchSettings(tiers, 'theme')).toHaveLength(3)
  })

  it('matches on a keyword the label does not contain', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'dark'))).toEqual(['theme'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'trash'))).toEqual(['confirmDelete'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'iconify'))).toEqual(['pixabayApiKey'])
  })

  it('matches on the section title, returning every row of that section', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'appearance'))).toEqual(['theme'])
    expect(ids(searchSettings(settingCandidates(ctx({ status: null, setEnabled: () => undefined })), 'sync this vault'))).toEqual(['githubSync'])
  })

  it('matches on the group title: "mouse" finds the Mouse table (and the hover preview, whose hint says "mouse" — YAZ-1800)', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'mouse'))).toEqual(['hotkeys-mouse', 'hoverPreview'])
  })

  it('a hotkey label or key finds its Hotkeys table: "close tab" → Window', () => {
    expect(ids(searchSettings(settingCandidates(ctx()), 'close tab'))).toEqual(['hotkeys-window'])
    expect(ids(searchSettings(settingCandidates(ctx()), '⌘W'))).toEqual(['hotkeys-window'])
    expect(ids(searchSettings(settingCandidates(ctx()), 'keyboard shortcuts'))).toEqual(['hotkeys-window', 'hotkeys-canvas', 'hotkeys-mouse'])
  })

  it('no match is an empty list', () => {
    expect(searchSettings(settingCandidates(ctx()), 'zzzz')).toEqual([])
  })
})
