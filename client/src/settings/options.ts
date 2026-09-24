/**
 * The option vocabularies behind the settings rows (YAZ-1679 D2): label + value pairs the
 * registry hands to `Segmented`, in the order the controls show them. Every list mirrors a type
 * in shared/types.ts, which owns validation; App owns what each value DOES.
 */
import type { DiagramDarkColors, GithubSyncStatus, Theme } from '@shared/types'

export interface Option<T> {
  label: string
  value: T
}

/** Obsidian's Appearance control and order (Desktop K, GRO-2218); App resolves and applies it. */
export const THEME_OPTIONS: readonly Option<Theme>[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

/** 🔒 YAZ-1802 D16: how draw.io diagrams look in dark mode; the default leads. */
export const DIAGRAM_DARK_COLORS_OPTIONS: readonly Option<DiagramDarkColors>[] = [
  { label: 'Adapt colours', value: 'adapt' },
  { label: 'Keep original colours', value: 'keep' },
]

/** The On-first pair the guards use ("Confirm before deleting", GitHub sync): the safe answer leads. */
export const ON_OFF_OPTIONS: readonly Option<boolean>[] = [
  { label: 'On', value: true },
  { label: 'Off', value: false },
]

/**
 * What we DETECTED about this vault's repo (YAZ-1081 3B), stated as fact rather than advice.
 * The two not-ready cases name GitHub Desktop deliberately: setting a remote up is a job for
 * the tool the user already has, not a flow this app should grow.
 */
export function repoHint(status: GithubSyncStatus | null): string {
  const repo = status?.repo
  if (repo === undefined) return "This folder isn't a git repo — set it up with GitHub Desktop, then turn sync on."
  if (repo.remoteUrl === null) return 'This folder is a git repo with no GitHub remote — add one with GitHub Desktop, then turn sync on.'
  return `repo ${repo.remoteUrl} · branch ${repo.branch ?? '—'}`
}
