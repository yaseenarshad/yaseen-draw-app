/**
 * The option vocabularies behind the settings rows (YAZ-1679 D2): label + value pairs the
 * registry hands to `Segmented`, in the order the controls show them. Every list mirrors a type
 * in shared/types.ts, which owns validation; App owns what each value DOES (CSS vars, theme
 * resolution, the folder for a new note). Moved here verbatim from sidebar/SettingsPanel.tsx.
 */
import { THREAD_WIDTHS, type CommentsOrder, type ContentWidth, type GithubSyncStatus, type NewNoteLocation, type Theme } from '@shared/types'

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

/** Global reading-surface width presets (YAZ-1176); App owns their exact CSS mapping. */
export const CONTENT_WIDTH_OPTIONS: readonly Option<ContentWidth>[] = [
  { label: 'Narrow', value: 'narrow' },
  { label: 'Medium', value: 'medium' },
  { label: 'Full', value: 'full' },
]

/** Comment stream order (YAZ-1515): a reading preference, global — the block's own toggle drives the same field. */
export const COMMENTS_ORDER_OPTIONS: readonly Option<CommentsOrder>[] = [
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Newest first', value: 'newest' },
]

/** Google-Docs-style presets (GRO-2024 D4). blockGap is per-side padding: visual gap = 2×. */
export const LINE_SPACING_PRESETS: readonly Option<number>[] = [
  { label: '1.0', value: 1.0 },
  { label: '1.15', value: 1.15 },
  { label: '1.5', value: 1.5 },
  { label: '2.0', value: 2.0 },
]
export const BLOCK_GAP_PRESETS: readonly Option<number>[] = [
  { label: 'Compact', value: 2 },
  { label: 'Default', value: 4 },
  { label: 'Relaxed', value: 8 },
  { label: 'Spacious', value: 12 },
]

/** Thread line width presets, like logseq-bullet-threading (GRO-2109); `THREAD_WIDTHS` validates the field. */
export const THREAD_WIDTH_OPTIONS: readonly Option<number>[] = THREAD_WIDTHS.map((value) => ({ label: `${value}px`, value }))

/** Shown in the colour swatch while the thread uses the app accent (`--accent` in app.css). */
export const DEFAULT_THREAD_SWATCH = '#5b6cff'

/** Bullet threading on/off (GRO-2094); the editor reads it as `data-threading` on `.app`. */
export const THREADING_OPTIONS: readonly Option<boolean>[] = [
  { label: 'Off', value: false },
  { label: 'On', value: true },
]

/** The On-first pair the guards use ("Confirm before deleting", GitHub sync): the safe answer leads. */
export const ON_OFF_OPTIONS: readonly Option<boolean>[] = [
  { label: 'On', value: true },
  { label: 'Off', value: false },
]

/**
 * Obsidian's "Default location for new notes" options and order (Files & Links, Links C2- —
 * GRO-2240): drives where clicking a bare unresolved [[link]] creates its page. The labels
 * are sentences, so they go in a dropdown (`Select`) rather than a segmented row.
 */
export const NEW_NOTE_LOCATION_OPTIONS: readonly Option<NewNoteLocation>[] = [
  { label: 'Vault folder', value: 'root' },
  { label: 'Same folder as current file', value: 'current' },
  { label: 'In the folder specified below', value: 'folder' },
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
