import type { ViewSet } from '../viewSchema'

/**
 * Column labels on the def (YAZ-1513) — the ONE rule for where a `displayName` lives and how it
 * is set, shared by the Properties menu's pencil and the table header's "Rename column…". Edits are
 * `Mutate` bodies, so every rename is one `onChange` → one `folder_page_settings` write through the
 * folder page host, optimistic like every other config edit.
 */

const bare = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key)

/** The `def.properties` entry a key's display name lives in: as written, bare, or `note.`-prefixed; else the bare form. */
function labelEntryKey(def: ViewSet, key: string): string {
  const b = bare(key)
  for (const k of [key, b, `note.${b}`]) if (def.properties?.[k] !== undefined) return k
  return b
}

/** The stored display name, or '' when the column wears its default label. */
export function displayNameOf(def: ViewSet, key: string): string {
  return def.properties?.[labelEntryKey(def, key)]?.displayName ?? ''
}

/**
 * Set — or, for a blank name, clear — one column's display name. An emptied entry and then an
 * emptied `properties` map delete themselves (the YAML default-deletes rule), so a column back on
 * its default label leaves no key behind. The KEY never changes; only what the header says.
 */
export function setDisplayName(d: ViewSet, key: string, name: string): void {
  const k = labelEntryKey(d, key)
  const props = d.properties ?? {}
  const entry = { ...props[k] }
  if (name.trim()) entry.displayName = name.trim()
  else delete entry.displayName
  if (Object.keys(entry).length) props[k] = entry
  else delete props[k]
  if (Object.keys(props).length) d.properties = props
  else delete d.properties
}
