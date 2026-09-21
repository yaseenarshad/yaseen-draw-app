/** Note property rows share the view editors and the selected folder page's definitions.
 * Value writes remain surgical and conflict-checked; raw YAML retains its own dirty draft.
 * A note with multiple folder memberships requires an explicit definition context.
 */
import { useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { frontmatterInterior, parseFrontmatter, replaceFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import {
  PROPERTY_NAME,
  type FileResponse,
  type IndexRecord,
  type PropertiesResponse,
  type PropertyDecl,
} from '@shared/types'
import { BridgeRequestError, api } from '../api'
import { FOLDER_PAGE_KEY, folderPagesLookup } from '../links/folderPages'
import { RESERVED_KEYS } from '../links/reservedKeys'
import { cellEditor, columnTyping, type EditorKind } from '../views/editorType'
import { fromYaml } from '../views/expr'
import { folderPageSettings, writeFolderColumn, type FolderPageSettings } from '../views/folderPageSettings'
import { PropertyDefinitionEditor, PropertyTypeIcon } from '../views/view/PropertyDefinitionEditor'
import { Popover } from '../views/view/Popover'
import { EditableCell } from '../views/view/EditableCell'
import { ColumnSearch } from '../views/view/ColumnSearch'
import { cellContent } from '../views/view/GroupHeader'
import { PropertiesIcon } from '../views/view/icons'
import { writeProperty } from '../views/writeProperty'
import type { WikilinkResolveSource } from './wikilink/wikilinkPlugin'
import '../views/views.css'

export interface FrontmatterPanelProps {
  /** The open note as the Editor loaded it — the panel's disk truth until its own write moves it. */
  file: Pick<FileResponse, 'path' | 'content' | 'mtime'>
  /** The vault root: the scope of `.yaseendocs/properties.json`. Absent → rows carry no type affordance. */
  root?: string | null
  /** Legacy vault declarations are a fallback beneath the selected folder page's definition. */
  properties?: PropertiesResponse | null
  /** Live link feed resolves folder membership and provides link suggestions. */
  wikilinks?: WikilinkResolveSource
}

/** The app's own keys: shown, never edited here — each has its own door (the sidebar's toggle, the folder page's settings, the Comments block below the note — YAZ-1472). */
/** The one list (YAZ-1513): `links/reservedKeys.ts` spells it from the real constants. */
const RESERVED = RESERVED_KEYS

/** No view is rendering here, so the ladder's record-derived rungs have nothing to read. */
const NO_RECORDS: readonly IndexRecord[] = []

/** The interior of a whole file's frontmatter block; '' when the page carries none. */
const interiorOf = (content: string): string => frontmatterInterior(splitFrontmatter(content).frontmatter)

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const isScalar = (v: unknown): boolean => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/**
 * Values no typed editor can hold without LYING about them (🔒): nested maps, multi-line scalars,
 * and lists carrying either. `null` is not one of them — an empty scalar is a text row.
 */
function isOpaque(raw: unknown): boolean {
  if (Array.isArray(raw)) return raw.some((item) => !isScalar(item) || (typeof item === 'string' && item.includes('\n')))
  if (!isScalar(raw)) return true
  return typeof raw === 'string' && raw.includes('\n')
}

interface Row {
  key: string
  raw: unknown
  /** null = read-only; the row then offers nothing but its chip. */
  editor: EditorKind | null
  chip: 'reserved' | 'yaml' | null
}

/**
 * The editor for a key on THIS surface. `columnTyping` is the ONE ladder (`views/editorType.ts`):
 * folder declaration → legacy declaration → the note's own value → text.
 */
const editorFor = (key: string, raw: unknown, decls: PropertiesResponse | null, folder: FolderPageSettings | null = null): EditorKind | null =>
  cellEditor(raw, columnTyping(key, NO_RECORDS, decls, folder))

function rowsOf(properties: Record<string, unknown>, decls: PropertiesResponse | null, folder: FolderPageSettings | null = null): Row[] {
  return Object.entries(properties).map(([key, raw]) => {
    if (RESERVED.has(key)) return { key, raw, editor: null, chip: 'reserved' }
    if (isOpaque(raw)) return { key, raw, editor: null, chip: 'yaml' }
    // Existing human-readable keys can have a folder-local declaration.
    return { key, raw, editor: folder?.columns[key] || PROPERTY_NAME.test(key) ? editorFor(key, raw, decls, folder) : 'text', chip: null }
  })
}

/** A new key's FIRST value, shaped by the kind it will be read back at — the registry is the authority. */
function seedValue(text: string, editor: EditorKind | null): unknown {
  const t = text.trim()
  if (editor === 'number') {
    const n = Number(t)
    return t !== '' && Number.isFinite(n) ? n : text
  }
  if (editor === 'checkbox') return t.toLowerCase() === 'true'
  if (editor === 'list' || editor === 'multi-link' || editor === 'multi-select') return t === '' ? [] : [t]
  return text
}

/** `setFrontmatterProperty` over the panel's OWN copy, never throwing: the disk write already succeeded. */
function applied(content: string, key: string, value: unknown): string {
  try {
    return setFrontmatterProperty(content, key, value)
  } catch {
    return content
  }
}

interface Snapshot {
  /** The `file.content` PROP this was last derived from — the re-derive trigger, and nothing else. */
  seen: string
  /** Whole-file bytes the panel believes are on disk; its own writes move this AHEAD of `seen`. */
  content: string
  /** The user's unsaved RAW text; null = clean, i.e. showing `content`'s own interior. */
  draft: string | null
}

export function FrontmatterPanel({ file, properties: decls = null, wikilinks }: FrontmatterPanelProps) {
  const [propertyMenu, setPropertyMenu] = useState<{ key: string; anchor: HTMLElement; definition: PropertyDecl; base: PropertyDecl | undefined; folderPath: string | null; folderName: string; editing: boolean } | null>(null)
  const [contextPath, setContextPath] = useState<string | null>(null)
  const index = useSyncExternalStore(listener => wikilinks?.subscribe(listener) ?? (() => {}), () => wikilinks?.records ?? NO_RECORDS)
  const contexts = useMemo(() => {
    if (!wikilinks?.resolve) return []
    const parents = folderPagesLookup(index, wikilinks.resolve).folderPagesOf(file.path)
    return index.filter(r => parents.includes(r.path))
  }, [index, wikilinks, file.path])
  const context = contexts.find(r => r.path === contextPath) ?? (contextPath === null && contexts.length === 1 ? contexts[0] : null)
  const folderDefinition = context ? folderPageSettings(context) : null
  const [expanded, setExpanded] = useState(false)
  // 🔒 Typed rows are the default; raw is the fallback under them.
  const [yamlMode, setYamlMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState<{ name: string; value: string } | null>(null)
  const [query, setQuery] = useState('')
  const [snap, setSnap] = useState<Snapshot>(() => ({ seen: file.content, content: file.content, draft: null }))

  // The file was (re)loaded under us: follow the new bytes, keeping a dirty draft — text the user
  // typed is never thrown away by a load. Compared against the PROP we last saw, so the panel's
  // own writes (which run ahead of it) do not read as an external change and bounce back.
  if (snap.seen !== file.content) setSnap({ seen: file.content, content: file.content, draft: snap.draft })

  const basenames = useMemo(() => (wikilinks?.records ?? NO_RECORDS).map((r) => r.basename), [wikilinks?.records])

  const disk = interiorOf(snap.content)
  const text = snap.draft ?? disk
  const dirty = snap.draft !== null && snap.draft !== disk

  const cancel = (): void => {
    setSnap((s) => ({ ...s, draft: null }))
    setError(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const fresh = await api.readFile(file.path)
      const next = replaceFrontmatter(fresh.content, text)
      // Validate what will actually be WRITTEN, fences and all — never a hand-wrapped copy.
      const parsed = parseFrontmatter(splitFrontmatter(next).frontmatter)
      if (parsed.error !== undefined) {
        setError(`Not valid YAML: ${parsed.error}`)
        return
      }
      // Identity never touches disk, same as the editor's autosave and `writeProperty`.
      if (next !== fresh.content) await writeBlock(file.path, next, fresh.mtime, text)
      setSnap((s) => ({ seen: s.seen, content: next, draft: null }))
      setError(null)
    } catch (err) {
      setError(`Could not save the properties: ${messageOf(err)}`)
    } finally {
      setSaving(false)
    }
  }

  /**
   * ONE key, surgically (🔒): `writeProperty`'s dance whole — read fresh, `setFrontmatterProperty`,
   * `expectedMtime`, retry once — reused rather than duplicated. Then the panel's own belief of
   * disk moves the SAME way, so the raw fallback can never show a block a typed edit left behind
   * and a later raw Save cannot silently revert it.
   */
  const commit = async (key: string, value: unknown): Promise<void> => {
    await writeProperty(file.path, key, value)
    setSnap((s) => ({ seen: s.seen, content: applied(s.content, key, value), draft: null }))
    setError(null)
  }

  const { properties: parsed, error: parseError } = parseFrontmatter(splitFrontmatter(snap.content).frontmatter)
  const count = parseError === undefined ? Object.keys(parsed).length : 0
  const empty = disk === '' && snap.draft === null
  // The words live in the tooltip and the accessible name (YAZ-1758); the chip itself shows a glyph.
  const label = empty ? 'Add properties' : count > 0 ? `Properties (${count})` : 'Properties'
  // A block that will not parse has no rows to show: the raw fallback IS the surface then.
  const rawMode = yamlMode || parseError !== undefined
  const rows = rawMode ? [] : rowsOf(parsed, decls, folderDefinition)
  const needle = query.trim().toLocaleLowerCase()
  const shown = rows.filter((row) => row.key.toLocaleLowerCase().includes(needle))

  const remove = (key: string): void => {
    void commit(key, undefined).catch((err: unknown) => setError(`Could not delete "${key}": ${messageOf(err)}`))
  }

  const addKey = (): void => {
    if (adding === null) return
    const name = adding.name.trim()
    // The registry's own message, in its own shape — the panel enforces nothing it invented.
    if (!PROPERTY_NAME.test(name)) {
      setError(`property names are snake_case (${String(PROPERTY_NAME)})`)
      return
    }
    if (Object.prototype.hasOwnProperty.call(parsed, name)) {
      setError(`"${name}" is already a property of this page`)
      return
    }
    setSaving(true)
    void commit(name, seedValue(adding.value, editorFor(name, undefined, decls, folderDefinition)))
      .then(() => setAdding(null))
      .catch((err: unknown) => setError(`Could not add "${name}": ${messageOf(err)}`))
      .finally(() => setSaving(false))
  }

  const saveDefinition = async (): Promise<void> => {
    if (!propertyMenu?.folderPath) return
    setSaving(true)
    try {
      const { key, definition, base, folderPath } = propertyMenu
      await writeFolderColumn(folderPath, key, definition, base)
      setPropertyMenu(null)
      setError(null)
    } catch (err) { setError(`Could not save the property: ${messageOf(err)}`) }
    finally { setSaving(false) }
  }

  return (
    <section className="frontmatter-panel">
      <button type="button" className="frontmatter-panel__header" aria-expanded={expanded} aria-label={label} title={label} onClick={() => { setExpanded((open) => !open); setQuery('') }}>
        <svg className="frontmatter-panel__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        <PropertiesIcon />
        {count > 0 && <span className="frontmatter-panel__count">{count}</span>}
      </button>
      {propertyMenu && createPortal(<Popover label={`Property ${propertyMenu.key}`} anchor={propertyMenu.anchor} onClose={() => { if (!saving) setPropertyMenu(null) }} className="frontmatter-property-menu">
        <div className="frontmatter-property-menu__heading"><PropertyTypeIcon kind={propertyMenu.definition.kind} /><strong>{propertyMenu.key}</strong></div>
        {propertyMenu.editing ? <>
          <p className="frontmatter-property-menu__scope">In {propertyMenu.folderName}</p>
          <fieldset disabled={saving} className="property-settings-fields">
          <PropertyDefinitionEditor value={propertyMenu.definition} onChange={definition => setPropertyMenu({ ...propertyMenu, definition })} observed={Array.isArray(parsed[propertyMenu.key]) ? (parsed[propertyMenu.key] as unknown[]).map(String) : parsed[propertyMenu.key] == null ? [] : [String(parsed[propertyMenu.key])]} />
          {error && <p role="alert" className="frontmatter-panel__error">{error}</p>}
          <div className="frontmatter-property-menu__actions"><button type="button" disabled={saving} onClick={() => setPropertyMenu(null)}>Cancel</button><button type="button" disabled={saving} onClick={() => void saveDefinition()}>{saving ? 'Saving…' : 'Save'}</button></div>
          </fieldset>
        </> : <>
          {context ? <button className="view-popover__item" type="button" onClick={() => setPropertyMenu({ ...propertyMenu, editing: true })}>Edit property <span>›</span></button> : <p className="frontmatter-property-menu__scope">Choose a folder page to configure this property.</p>}
          <button className="view-popover__item" type="button" onClick={() => { remove(propertyMenu.key); setPropertyMenu(null) }}>Remove from this note</button>
        </>}
      </Popover>, document.body)}
      {expanded && (
        <div className="frontmatter-panel__body">
          {contexts.length > 0 && !rawMode && <div className="frontmatter-property-context">
            <label>Properties from <select aria-label="Property context" value={context?.path ?? ''} onChange={e => { setContextPath(e.target.value); setPropertyMenu(null) }}>
              {contexts.length > 1 && <option value="">Choose a folder page…</option>}
              {contexts.map(r => <option key={r.path} value={r.path}>{r.basename}</option>)}
            </select></label>

          </div>}
          {rawMode ? (
            <textarea
              className="frontmatter-panel__text"
              aria-label="Properties (YAML)"
              spellCheck={false}
              value={text}
              onChange={(e) => {
                const draft = e.currentTarget.value
                setSnap((s) => ({ ...s, draft }))
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                // The textarea owns Esc while focused: it reverts to disk rather than reaching
                // whatever else in the window listens for it.
                e.preventDefault()
                e.stopPropagation()
                cancel()
              }}
            />
          ) : (
            <>
              {rows.length > 0 && <ColumnSearch value={query} onChange={setQuery} label="Search properties" placeholder="Search properties…" />}
              {rows.length > 0 && shown.length === 0 && <p className="column-search__empty" role="status">No properties found.</p>}
              {shown.length > 0 && (
                <ul className="frontmatter-panel__rows">
                  {shown.map((row) => (
                    <li key={row.key} className="frontmatter-panel__row" data-key={row.key}>
                      {row.editor === null ? <span className="frontmatter-panel__key">{row.key}</span> : <button type="button" className="frontmatter-panel__key frontmatter-property-name" aria-label={`Configure ${row.key}`} onClick={event => setPropertyMenu({ key: row.key, anchor: event.currentTarget, base: folderDefinition?.columns[row.key], folderPath: context?.path ?? null, folderName: context?.basename ?? '', definition: folderDefinition?.columns[row.key] ?? decls?.properties[row.key] ?? { kind: row.editor ?? 'text' }, editing: false })}>
                        <PropertyTypeIcon kind={row.editor} /><span>{row.key}</span>
                      </button>}
                      <span className="frontmatter-panel__value">
                        {row.editor === null ? (
                          <>
                            {cellContent(fromYaml(row.raw))}
                            <span
                              className="frontmatter-panel__chip"
                              title={
                                row.chip === 'reserved'
                                  ? `${row.key} is the app's own property — it is set where it belongs, not here`
                                  : 'No typed editor can hold this value — edit it as YAML'
                              }
                            >
                              {row.chip === 'reserved' ? 'Reserved' : 'YAML'}
                            </span>
                          </>
                        ) : (
                          <EditableCell
                            path={file.path}
                            propKey={row.key}
                            raw={row.raw}
                            value={fromYaml(row.raw)}
                            editor={row.editor}
                            options={columnTyping(row.key, NO_RECORDS, decls, folderDefinition)?.options}
                            basenames={basenames}
                            onCommit={(next) => commit(row.key, next)}
                          />
                        )}
                      </span>

                    </li>
                  ))}
                </ul>
              )}
              {adding !== null && (
                <div className="frontmatter-panel__new">
                  <input
                    className="view-input frontmatter-panel__name"
                    aria-label="New property name"
                    autoFocus
                    placeholder="name"
                    value={adding.name}
                    onChange={(e) => setAdding({ ...adding, name: e.currentTarget.value })}
                  />
                  <input
                    className="view-input"
                    aria-label="New property value"
                    placeholder="value"
                    value={adding.value}
                    onChange={(e) => setAdding({ ...adding, value: e.currentTarget.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addKey()
                    }}
                  />
                  <button type="button" className="frontmatter-panel__btn" disabled={saving} onClick={addKey}>
                    Add
                  </button>
                  <button
                    type="button"
                    className="frontmatter-panel__btn"
                    disabled={saving}
                    onClick={() => {
                      setAdding(null)
                      setError(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
          {error !== null && !propertyMenu?.editing && (
            <p className="frontmatter-panel__error" role="alert">
              {error}
            </p>
          )}
          {rawMode && dirty && (
            <div className="frontmatter-panel__actions">
              <button type="button" className="frontmatter-panel__btn" disabled={saving} onClick={() => void save()}>
                Save
              </button>
              <button type="button" className="frontmatter-panel__btn" disabled={saving} onClick={cancel}>
                Cancel
              </button>
            </div>
          )}
          {/* The two acts that are about the PANEL rather than about a key, on one quiet line. */}
          <div className="frontmatter-panel__footer">
            {!rawMode && adding === null && (
              <button
                type="button"
                className="frontmatter-panel__btn"
                onClick={() => {
                  setAdding({ name: '', value: '' })
                  setQuery('')
                  setError(null)
                }}
              >
                Add property
              </button>
            )}
            {/* No rows exist to go back to while the block will not parse, so the toggle stays away. */}
            {parseError === undefined && (
              <button
                type="button"
                className="frontmatter-panel__btn frontmatter-panel__mode"
                disabled={rawMode && dirty}
                title={rawMode && dirty ? 'Save or cancel your YAML edits first' : undefined}
                onClick={() => { setYamlMode(!rawMode); setQuery('') }}
              >
                {rawMode ? 'Edit as rows' : 'Edit as YAML'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** `writeProperty`'s CONFLICT dance (GRO-2141), whole-block: retry once over the fresh bytes. */
async function writeBlock(path: string, content: string, expectedMtime: number, yamlText: string): Promise<{ mtime: number }> {
  try {
    return { mtime: (await api.writeFile({ path, content, expectedMtime })).mtime }
  } catch (err) {
    if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT') throw err
    const fresh = await api.readFile(path)
    const merged = replaceFrontmatter(fresh.content, yamlText)
    // A second conflict throws: two racing writers means something else is fighting us.
    return { mtime: (await api.writeFile({ path, content: merged, expectedMtime: fresh.mtime })).mtime }
  }
}
