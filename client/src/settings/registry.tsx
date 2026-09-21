/**
 * THE SETTINGS REGISTRY (YAZ-1679 D2): one array the dialog's nav, page rendering and search all
 * read. A setting is declared ONCE — id, label, hint, search keywords, and how it renders — and
 * appears in its section, in a search result, and in the nav's section list from that one entry. Same
 * eleven settings as the popover it replaced (sidebar/SettingsPanel.tsx, GRO-2024); the
 * persistence layer (`SettingsState`, `storage.setSettings`, per-vault `github.json`) is untouched.
 *
 * `id` doubles as the row's `data-setting` address — for the `SettingsState` rows it IS the field
 * name, so a test or spec that knows the field knows the row.
 *
 * GitHub sync (YAZ-1081 3B) is the ONE setting not in `SettingsState`: the switch lives per-vault
 * in `.yaseendraw/github.json`, read and written through the engine, so its section is
 * `available` only when App hands the engine's status + setter over.
 */
import type { ReactNode } from 'react'
import type { GithubSyncStatus, SettingsState } from '@shared/types'
import { Segmented } from './controls'
import { HOTKEY_GROUPS, type HotkeyEntry } from './hotkeys'
import { NewNoteLocationControl } from './NewNoteLocationControl'
import { BLOCK_GAP_PRESETS, COMMENTS_ORDER_OPTIONS, CONTENT_WIDTH_OPTIONS, DEFAULT_THREAD_SWATCH, LINE_SPACING_PRESETS, ON_OFF_OPTIONS, repoHint, THEME_OPTIONS, THREAD_WIDTH_OPTIONS, THREADING_OPTIONS } from './options'

export interface SettingsCtx {
  settings: SettingsState
  onChange: (next: SettingsState) => void
  sync?: { status: GithubSyncStatus | null; setEnabled: (enabled: boolean) => void }
}

export interface SettingDef {
  id: string
  label: string
  /** Shown under the label; a hint written as a function reads live state (the sync repo facts). */
  hint?: string | ((ctx: SettingsCtx) => string)
  keywords?: readonly string[]
  /** The control stacks full-width under the text instead of sitting beside it (D7); a function reads live state (the folder input shows only for `folder`). */
  wide?: boolean | ((ctx: SettingsCtx) => boolean)
  render: (ctx: SettingsCtx) => ReactNode
}

export type SettingsSectionId = 'appearance' | 'editor' | 'files' | 'sync' | 'hotkeys'

/** Rows that belong together under one sub-heading; no title = plain rows straight under the section. */
export interface SettingsGroup {
  title?: string
  hint?: string
  items: readonly SettingDef[]
}

export interface SettingsSection {
  id: SettingsSectionId
  title: string
  /** A section that only exists in some contexts (sync needs the engine); absent = always. */
  available?: (ctx: SettingsCtx) => boolean
  /** One line under the section title, for the section whose settings do not live where the rest do. */
  note?: string
  /**
   * Its own page in the dialog rather than a stretch of the scrolling settings page — the
   * hotkey reference, which is a table to look things up in, not settings to scroll past.
   * Search still indexes it.
   */
  standalone?: true
  groups: readonly SettingsGroup[]
}

/** One hotkey table (the Hotkeys section is one group per table, YAZ-1679 redesign). */
const hotkeyTable = (entries: readonly HotkeyEntry[]) => (
  <dl className="hotkeys__list">
    {entries.map(({ keys, label }) => (
      <div key={keys} className="hotkeys__row">
        <dt className="hotkeys__keys">{keys}</dt>
        <dd className="hotkeys__label">{label}</dd>
      </div>
    ))}
  </dl>
)

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'appearance',
    title: 'Appearance',
    groups: [
      {
        items: [
          {
            id: 'theme',
            label: 'Theme',
            keywords: ['dark', 'light', 'system'],
            render: ({ settings, onChange }) => <Segmented options={THEME_OPTIONS} value={settings.theme} onChange={(theme) => onChange({ ...settings, theme })} ariaLabel="Theme" />,
          },
          {
            id: 'contentWidth',
            label: 'Content width',
            keywords: ['readable line length', 'narrow', 'medium', 'full'],
            render: ({ settings, onChange }) => (
              <Segmented options={CONTENT_WIDTH_OPTIONS} value={settings.contentWidth} onChange={(contentWidth) => onChange({ ...settings, contentWidth })} ariaLabel="Content width" />
            ),
          },
        ],
      },
      {
        title: 'Spacing',
        items: [
          {
            id: 'lineSpacing',
            label: 'Line spacing',
            keywords: ['line height'],
            render: ({ settings, onChange }) => (
              <Segmented options={LINE_SPACING_PRESETS} value={settings.lineSpacing} onChange={(lineSpacing) => onChange({ ...settings, lineSpacing })} ariaLabel="Line spacing" />
            ),
          },
          {
            id: 'blockGap',
            label: 'Space between blocks',
            keywords: ['gap', 'paragraph'],
            render: ({ settings, onChange }) => (
              <Segmented options={BLOCK_GAP_PRESETS} value={settings.blockGap} onChange={(blockGap) => onChange({ ...settings, blockGap })} ariaLabel="Space between blocks" />
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'editor',
    title: 'Editor',
    groups: [
      {
        title: 'Bullet threading',
        hint: 'Guide lines that connect nested bullets.',
        items: [
          {
            id: 'bulletThreading',
            label: 'Show',
            // Keywords add only what the label, hints and titles do not already say — search
            // indexes all of those. The pre-redesign names ride along where they add a phrase.
            keywords: ['outline'],
            render: ({ settings, onChange }) => (
              <Segmented options={THREADING_OPTIONS} value={settings.bulletThreading} onChange={(bulletThreading) => onChange({ ...settings, bulletThreading })} ariaLabel="Show bullet threading" />
            ),
          },
          {
            id: 'threadWidth',
            label: 'Line width',
            keywords: ['thread width'],
            render: ({ settings, onChange }) => (
              <Segmented options={THREAD_WIDTH_OPTIONS} value={settings.threadWidth} onChange={(threadWidth) => onChange({ ...settings, threadWidth })} ariaLabel="Line width" />
            ),
          },
          {
            id: 'threadColor',
            label: 'Line colour',
            keywords: ['thread colour', 'color', 'accent'],
            render: ({ settings, onChange }) => (
              <>
                <input
                  type="color"
                  className="settings__color"
                  aria-label="Line colour"
                  value={settings.threadColor ?? DEFAULT_THREAD_SWATCH}
                  onChange={(e) => onChange({ ...settings, threadColor: e.target.value })}
                />
                <button
                  type="button"
                  className={`settings__option${settings.threadColor === null ? ' settings__option--active' : ''}`}
                  disabled={settings.threadColor === null}
                  onClick={() => onChange({ ...settings, threadColor: null })}
                >
                  Default
                </button>
              </>
            ),
          },
        ],
      },
      {
        title: 'Comments',
        items: [
          {
            id: 'commentsOrder',
            label: 'Order',
            keywords: ['comments order', 'sort'],
            render: ({ settings, onChange }) => (
              <Segmented options={COMMENTS_ORDER_OPTIONS} value={settings.commentsOrder} onChange={(commentsOrder) => onChange({ ...settings, commentsOrder })} ariaLabel="Comments order" />
            ),
          },
        ],
      },
    ],
  },
  {
    id: 'files',
    title: 'Files & Links',
    groups: [
      {
        items: [
          {
            // GRO-2272: the confirm sheet is the ONLY guard on delete (the OS Trash has no
            // programmatic undo), so this defaults ON and the hint says what turning it off
            // actually means rather than being a bare switch.
            id: 'confirmDelete',
            label: 'Confirm before deleting',
            hint: 'Deleted notes and folders move to the Trash either way.',
            render: ({ settings, onChange }) => (
              <Segmented options={ON_OFF_OPTIONS} value={settings.confirmDelete} onChange={(confirmDelete) => onChange({ ...settings, confirmDelete })} ariaLabel="Confirm before deleting" />
            ),
          },
          {
            id: 'newNoteLocation',
            label: 'Default location for new notes',
            keywords: ['folder', 'wikilink'],
            // A plain label-left / dropdown-right row, until the folder input needs the width.
            wide: ({ settings }) => settings.newNoteLocation === 'folder',
            render: ({ settings, onChange }) => <NewNoteLocationControl settings={settings} onChange={onChange} />,
          },
        ],
      },
    ],
  },
  {
    id: 'sync',
    title: 'Sync',
    available: (ctx) => ctx.sync !== undefined,
    note: "These settings are saved in this vault's .yaseendraw folder, not app-wide.",
    groups: [
      {
        items: [
          {
            id: 'githubSync',
            label: 'Sync this vault to GitHub',
            hint: ({ sync }) => repoHint(sync?.status ?? null),
            keywords: ['repo', 'remote'],
            // `status.enabled` is the switch's honest read-back, stamped by the engine — NOT
            // `state`, which is `off` for a vault that is enabled but has no repo or remote yet (the
            // hint explains those). A null status — first fetch still in flight — reads as Off, the
            // safe default. `sync` is defined here: the section is `available` only with it.
            render: ({ sync }) => <Segmented options={ON_OFF_OPTIONS} value={sync?.status?.enabled === true} onChange={(enabled) => sync?.setEnabled(enabled)} ariaLabel="Sync this vault to GitHub" />,
          },
        ],
      },
    ],
  },
  {
    id: 'hotkeys',
    title: 'Hotkeys',
    standalone: true,
    // One group per table, so "Window" is a heading search knows. The id is the table's title
    // lower-cased (`hotkeys-window`); every key and label of the table is a keyword, so "close
    // tab" or "⌘W" finds it, and "keyboard shortcuts" reaches every table (the Keyboard one is
    // already labelled that).
    groups: HOTKEY_GROUPS.map(({ title, entries }) => ({
      title,
      items: [
        {
          id: `hotkeys-${title.toLowerCase()}`,
          label: `${title} shortcuts`,
          keywords: [...(title === 'Keyboard' ? [] : ['keyboard shortcuts']), ...entries.flatMap((entry) => [entry.keys, entry.label])],
          wide: true,
          render: () => hotkeyTable(entries),
        },
      ],
    })),
  },
]

/** The sections this context can show, in registry order — what the nav lists and search covers. */
export const availableSections = (ctx: SettingsCtx): SettingsSection[] => SETTINGS_SECTIONS.filter((section) => section.available?.(ctx) ?? true)

/** A hint resolved against the context: plain text, or the live-state kind. */
export const resolveHint = (item: SettingDef, ctx: SettingsCtx): string | undefined => (typeof item.hint === 'function' ? item.hint(ctx) : item.hint)

/** Whether the row stacks its control, resolved the same way. */
export const resolveWide = (item: SettingDef, ctx: SettingsCtx): boolean => (typeof item.wide === 'function' ? item.wide(ctx) : item.wide === true)
