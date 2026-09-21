/**
 * Settings search (YAZ-1679 D6): every available setting becomes ONE candidate whose searchable
 * text is its label, hint, keywords, group title, group hint and section title run together, and the match
 * is the `[[` picker's own (`matchLinkCandidates`: exact, then prefix, then substring,
 * case-folded) — one ranking rule in the app, not two. The candidates are built once per dialog
 * open; the query runs over them on every keystroke.
 */
import { matchLinkCandidates } from '../links/completion'
import { availableSections, resolveHint, type SettingDef, type SettingsCtx, type SettingsGroup, type SettingsSection } from './registry'

export interface SettingHit {
  section: SettingsSection
  group: SettingsGroup
  item: SettingDef
  /** The searchable text; `lower` is its case-folded twin, precomputed for the matcher. */
  name: string
  lower: string
}

export function settingCandidates(ctx: SettingsCtx): SettingHit[] {
  return availableSections(ctx).flatMap((section) =>
    section.groups.flatMap((group) =>
      group.items.map((item) => {
        const name = [item.label, resolveHint(item, ctx), ...(item.keywords ?? []), group.title, group.hint, section.title].filter((part) => part !== undefined).join(' ')
        return { section, group, item, name, lower: name.toLowerCase() }
      }),
    ),
  )
}

/** Every hit for `query`, best first; the cap is the whole list — a settings search never truncates. */
export function searchSettings(candidates: readonly SettingHit[], query: string): SettingHit[] {
  return matchLinkCandidates(candidates, query, candidates.length)
}
