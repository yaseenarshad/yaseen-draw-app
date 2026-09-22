/**
 * THE SAVED-COMPONENT RULES (🔒 D5, YAZ-1819): what a slug is, what `<library>/components.json`
 * holds, and what a component fragment has to be before it is written or inserted. Pure and
 * Electron-free — the main-process store around it (`desktop/src/main/library/componentStore.ts`)
 * only reads, writes, watches and trashes, so every rule here unit-tests with no disk.
 *
 * THE SLUG IS THE IDENTITY, THE NAME IS THE LABEL. A component lives as two files named after its
 * slug — `<library>/components/<slug>.excalidraw` and `<slug>.png` — so the FOLDER can be read
 * back into an index with nothing else on hand, which is exactly what makes the index a cache
 * rather than a record: it is rebuilt whenever it is missing, corrupt or out of step with what is
 * on disk. A rename therefore moves no file; it changes one string in the index. (The web app's
 * identity was a Convex `_id`; here it has to be something a folder can carry.)
 *
 * THE SLUG IS ALSO A PATH SEGMENT, which is why `isValidComponentSlug` is narrow to the point of
 * rudeness: lowercase words joined by single hyphens and nothing else. Every separator, dot,
 * control character and `..` is refused, so a slug out of a hand-edited index can never name a
 * file outside the components folder (`drawingAssets.ts`'s `isValidFileId` posture, same reason).
 */
import { COMPONENTS_INDEX_FILE, LIBRARY_COMPONENTS_DIR, MAX_COMPONENT_NAME_LENGTH, type ComponentItem, type ComponentsIndexFile } from './types'
import { isFiniteNumber, isRecord } from './guards'

export { COMPONENTS_INDEX_FILE, LIBRARY_COMPONENTS_DIR }

/** The fragment's extension — a component IS an Excalidraw document, openable by anything. */
export const COMPONENT_EXT = '.excalidraw'
/** The preview's extension (🔒 D5). PNG, not the web app's WebP: every reader has one. */
export const COMPONENT_PREVIEW_EXT = '.png'

/**
 * The longest slug a name may produce. A component name is free text — someone will paste a
 * paragraph — and a 300-character path segment is a filesystem argument nobody needs.
 */
export const MAX_COMPONENT_SLUG_LENGTH = 60

/** What a name with nothing sluggable in it (non-latin, punctuation only, empty) becomes. */
export const FALLBACK_COMPONENT_SLUG = 'component'

export const EMPTY_COMPONENTS_INDEX: ComponentsIndexFile = { version: 1, items: [] }


const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A slug that may be used as a filename: lowercase words, single hyphens, nothing else at all. */
export function isValidComponentSlug(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_COMPONENT_SLUG_LENGTH && SLUG_RE.test(v)
}

/** Kebab of the name: every run of anything that is not `a-z0-9` becomes one hyphen, ends trimmed. */
export function slugForComponentName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_COMPONENT_SLUG_LENGTH)
    .replace(/-+$/g, '')
  return slug === '' ? FALLBACK_COMPONENT_SLUG : slug
}

/**
 * The first free slug: the base, then `-2`, `-3`, … — Finder's own counting, and never `-1`,
 * because "the second one" is what a duplicate name means. The stem is re-trimmed for EVERY
 * candidate, because the suffix grows: reserving a fixed three characters made `-100` overflow
 * `MAX_COMPONENT_SLUG_LENGTH` and produced a slug `isValidComponentSlug` then rejected.
 */
export function uniqueComponentSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const room = MAX_COMPONENT_SLUG_LENGTH - suffix.length
    const stem = base.length > room ? base.slice(0, room).replace(/-+$/g, '') : base
    const candidate = `${stem}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

export const componentFileName = (slug: string): string => `${slug}${COMPONENT_EXT}`
export const componentPreviewName = (slug: string): string => `${slug}${COMPONENT_PREVIEW_EXT}`

/** A directory entry back to its slug, or null when the entry is not a component fragment. */
export function slugOfComponentFile(name: string): string | null {
  return slugOfEntry(name, COMPONENT_EXT)
}

/** The same for the preview beside it — the watcher's filter needs both, and tmp files neither. */
export function slugOfComponentPreview(name: string): string | null {
  return slugOfEntry(name, COMPONENT_PREVIEW_EXT)
}

function slugOfEntry(name: string, ext: string): string | null {
  if (!name.endsWith(ext)) return null
  const slug = name.slice(0, -ext.length)
  return isValidComponentSlug(slug) ? slug : null
}

/** Trimmed and capped at the web app's own ceiling; null when there is no name at all. */
export function normalizeComponentName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const name = v.trim().slice(0, MAX_COMPONENT_NAME_LENGTH)
  return name === '' ? null : name
}

/** One index row, whole or not at all — a half-read row would be a tile that cannot be opened. */
export function normalizeComponentItem(v: unknown): ComponentItem | null {
  if (!isRecord(v)) return null
  const { slug, name, elementCount, createdAt, updatedAt } = v
  if (!isValidComponentSlug(slug) || typeof name !== 'string' || name === '') return null
  if (!isFiniteNumber(elementCount) || !isFiniteNumber(createdAt) || !isFiniteNumber(updatedAt)) return null
  return { slug, name, elementCount, createdAt, updatedAt }
}

/**
 * The FILE is lenient where a row is strict: a bad row is dropped and the rest survive, so one
 * hand edit cannot cost the whole library. Anything that is not a version-1 index at all is null,
 * and the caller moves it aside as `components.json.corrupt-<epoch>`.
 */
export function sanitizeComponentsIndex(v: unknown): ComponentsIndexFile | null {
  if (!isRecord(v) || v.version !== 1 || !Array.isArray(v.items)) return null
  const items: ComponentItem[] = []
  const seen = new Set<string>()
  for (const raw of v.items) {
    const item = normalizeComponentItem(raw)
    if (item === null || seen.has(item.slug)) continue
    seen.add(item.slug)
    items.push(item)
  }
  return { version: 1, items }
}

/** What the folder itself says about one component, before the index has had its say. */
export interface ComponentOnDisk {
  slug: string
  elementCount: number
  createdAt: number
  updatedAt: number
}

/**
 * The index the FOLDER implies (🔒 D5's "rebuilt from the folder"). A slug the old index still
 * knows keeps everything it said — its name above all, which is the one thing the folder cannot
 * tell us — and a slug it does not know is named after itself. A row whose file has gone drops
 * out: the folder is the truth and the index is the cache. Newest-updated first, which is the
 * order the grid reads in.
 */
export function indexFromSlugs(seen: readonly ComponentOnDisk[], known: ComponentsIndexFile): ComponentsIndexFile {
  const bySlug = new Map(known.items.map((item) => [item.slug, item]))
  const items = seen.map(({ slug, elementCount, createdAt, updatedAt }) => bySlug.get(slug) ?? { slug, name: slug, elementCount, createdAt, updatedAt })
  return { version: 1, items: [...items].sort((a, b) => b.updatedAt - a.updatedAt) }
}

/** Put an item at the head, replacing the row with its slug IN PLACE when there already is one. */
export function putComponentItem(index: ComponentsIndexFile, item: ComponentItem): ComponentsIndexFile {
  const at = index.items.findIndex((row) => row.slug === item.slug)
  if (at === -1) return { version: 1, items: [item, ...index.items] }
  const items = [...index.items]
  items[at] = item
  return { version: 1, items }
}

/** The label and the stamp; an unknown slug answers the SAME index, so the caller does not write. */
export function renameComponentItem(index: ComponentsIndexFile, slug: string, name: string, now: number): ComponentsIndexFile {
  const at = index.items.findIndex((row) => row.slug === slug)
  if (at === -1) return index
  const items = [...index.items]
  items[at] = { ...items[at], name, updatedAt: now }
  return { version: 1, items }
}

/** Drop one row; an unknown slug answers the SAME index, so the caller does not write. */
export function removeComponentItem(index: ComponentsIndexFile, slug: string): ComponentsIndexFile {
  if (!index.items.some((row) => row.slug === slug)) return index
  return { version: 1, items: index.items.filter((row) => row.slug !== slug) }
}

/** A component fragment as it is held in hand: the elements to insert and the bytes they name. */
export interface ComponentFragment {
  elements: readonly unknown[]
  files: Record<string, unknown>
}

/**
 * A fragment's bytes → what may be inserted. Validation is the OUTLINE plus the ONE promise 🔒 D5
 * makes about a component — that it is SELF-CONTAINED: every image element's bytes are in the
 * fragment's own `files`, so a component saved in one vault inserts in another. Deciding whether
 * those elements really are Excalidraw elements is the engine's `restore()`, a moment later.
 *
 * Soft-deleted elements are dropped here rather than inserted as ghosts, and an empty result is a
 * throw: a component with no elements is not one.
 */
export function parseComponentFragment(json: string): ComponentFragment {
  const parsed: unknown = JSON.parse(json)
  if (!isRecord(parsed) || !Array.isArray(parsed.elements)) throw new Error('not a component: no elements')
  const files = isRecord(parsed.files) ? parsed.files : {}
  const elements = parsed.elements.filter((element) => !(isRecord(element) && element.isDeleted === true))
  if (elements.length === 0) throw new Error('a component must contain at least one element')
  for (const element of elements) {
    if (!isRecord(element) || element.type !== 'image') continue
    const fileId = element.fileId
    if (typeof fileId !== 'string' || !isRecord(files[fileId])) throw new Error(`the component's image data is missing for file ${String(fileId)}`)
  }
  return { elements, files }
}
