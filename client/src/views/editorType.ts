import type { IndexRecord, PropertiesResponse, PropertyKind } from '@shared/types'
import { orderedPropertyOptions } from '@shared/propertyOptions'
import { columnKindIn, type FolderPageSettings } from './folderPageSettings'
import { canonicalKey } from './view/keys'

/**
 * Editor type inference for inline cell editors (5B, GRO-2142). Locked precedence, as amended
 * by the 5E relation contract (GRO-2120 comment 1f28abb4 §5), narrowed by YAZ-836 (the
 * type-scoped rung that used to sit above it died with the type system) and topped by YAZ-819
 * (the folder page's own, view-scoped declaration): the FOLDER PAGE whose view is rendering
 * wins, then a vault-wide property declaration; otherwise the note's own YAML value decides; a
 * note without the key borrows the dominant value type across the view's records; text is the
 * final fallback. `file.*` and `formula.*` never get an editor. The per-column halves are
 * computed once per render via `columnTyping`; `cellEditor` adds the per-note value on top.
 *
 * TOMBSTONE (⚡ YAZ-815, ruled by Yasin): a rung for an explicit `.obsidian/types.json`
 * assignment sat between the vault-wide declarations and the note's own value, with a `types`
 * parameter to feed it. Nothing ever fed it — the one surface that mounts these editors reads
 * the window's link snapshot rather than fetching an index (🔒 D2) — and the whole
 * `.obsidian/types.json` chain came out with it: a foreign app's file is not our schema.
 */

export type EditorKind = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'link' | 'multi-link' | 'select' | 'multi-select'

/** Per-column typing facts; null = the column is read-only (`file.*` / `formula.*`). `target` rides along from a declared link/multi-link property to constrain the picker. */
export type ColumnTyping = { assigned: EditorKind | null; dominant: EditorKind | null; target?: string; options?: readonly string[] } | null

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/
const WIKILINK = /^\[\[[^[\]]+\]\]$/

/** The editor a raw YAML value asks for; null when the note has no value for the key. */
export function valueKind(raw: unknown): EditorKind | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'boolean') return 'checkbox'
  if (typeof raw === 'number') return 'number'
  if (Array.isArray(raw)) return 'list'
  if (typeof raw === 'string') return ISO_DATE.test(raw) ? 'date' : WIKILINK.test(raw) ? 'link' : 'text'
  return 'text'
}

/** Most common value kind for `bare` across `records`; ties go to the first kind seen. */
function dominantKind(records: readonly IndexRecord[], bare: string): EditorKind | null {
  const counts = new Map<EditorKind, number>()
  for (const r of records) {
    const k = valueKind(r.properties[bare])
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best: EditorKind | null = null
  let n = 0
  for (const [k, c] of counts) {
    if (c > n) {
      best = k
      n = c
    }
  }
  return best
}

/** `PropertyKind` → editor, 1:1 (contract §5; `multi-link` is the chips editor with link suggestions). */
const DECLARED_KIND: Record<PropertyKind, EditorKind> = {
  text: 'text',
  number: 'number',
  date: 'date',
  checkbox: 'checkbox',
  list: 'list',
  link: 'link',
  'multi-link': 'multi-link',
  select: 'select',
  'multi-select': 'multi-select',
}

/**
 * The column-wide typing facts for `key` over the view's records, the folder page's own
 * declaration (YAZ-819) and the vault-wide property declarations (5E).
 */
export function columnTyping(
  key: string,
  records: readonly IndexRecord[],
  properties?: PropertiesResponse | null,
  folderPage?: FolderPageSettings | null,
): ColumnTyping {
  const c = canonicalKey(key)
  if (!c.startsWith('note.')) return null
  const bare = c.slice(5)
  const dominant = dominantKind(records, bare)
  // Rung 1 (🔒 Q8, YAZ-815): the folder page whose view is rendering, asked through the ONE
  // reader. VIEW-SCOPED by construction — two folder pages may type the same key differently and
  // neither wins globally, so there is no conflict to resolve here and none may be built.
  const own = folderPage == null ? null : columnKindIn(folderPage, bare)
  if (own !== null) return { assigned: DECLARED_KIND[own.kind], dominant, target: own.target, options: orderedPropertyOptions(own) }
  const declared = properties?.properties[bare]
  if (declared !== undefined) return { assigned: DECLARED_KIND[declared.kind], dominant, target: declared.target, options: orderedPropertyOptions(declared) }
  return { assigned: null, dominant }
}

/** The editor for one cell; null = read-only. */
export function cellEditor(raw: unknown, column: ColumnTyping): EditorKind | null {
  if (column === null) return null
  return column.assigned ?? valueKind(raw) ?? column.dominant ?? 'text'
}
