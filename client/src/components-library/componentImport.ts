/**
 * IMPORT JSON (YAZ-1833): the web app's `parseImportedComponentJson`
 * (`excalidraw-app/components/SavedComponentsData.ts`) ported, so a `.excalidraw` picked on disk
 * becomes a library component through the SAME door "Save selection" uses (`components:save`).
 *
 * WHAT IS VERBATIM: the envelope table — `growprofit/saved-component` with its schema-version and
 * element-count checks, `excalidraw`, `excalidraw/clipboard`, `excalidraw-api/clipboard`, and
 * `excalidrawlib` with its one-item rule — then `assertSupportedComponentElements`, the engine's
 * own `restoreElements(…, { repairBindings: true })`, the soft-deleted filter, a SECOND assertion
 * over what restore produced, and the size guard. Each message is a sentence the user reads.
 *
 * THE ONE DIFFERENCE, AND IT IS THE ISSUE'S OWN RULE: the web app called this with
 * `allowImages: false`, because an imported payload had no bytes in its object store to point at.
 * Here the picked file CARRIES its `files` map, so images are kept and their bytes travel into the
 * fragment exactly as a captured selection's do (🔒 D5) — which is what makes importing a legacy
 * embedded board yield a component with its pictures. An image whose bytes are NOT in the file is
 * still a refusal: a component that cannot insert is worse than no component.
 *
 * NOTHING IS WRITTEN BY A FAILURE. Every refusal is a throw before `components:save` is called, so
 * a corrupt, empty or unsupported file leaves the library exactly as it was.
 *
 * ENGINE-BOUND BY DESIGN: `restoreElements` comes in as an argument (`engine.ts`'s lazy rule), the
 * same seam `componentData.ts` uses — which is also what makes this testable with a stub.
 */
import { assertComponentElementsSize, assertSupportedComponentElements, type CapturedComponent, type ComponentEngine } from './componentData'

type JsonRecord = Record<string, unknown>
const isRecord = (v: unknown): v is JsonRecord => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The web app's own schema version for its saved-component envelope. */
export const SAVED_COMPONENT_SCHEMA_VERSION = 1

/** What a name-less import is called, when the file's own base name is nothing but punctuation. */
export const IMPORTED_COMPONENT_NAME = 'Imported component'

/** `getLibraryElements` ported: one `.excalidrawlib` item, in either of its two shapes. */
function libraryElements(payload: JsonRecord): unknown[] {
  if (payload.version !== 1 && payload.version !== 2) throw new Error('Unsupported Excalidraw Library version')
  const items = payload.libraryItems ?? payload.library
  if (!Array.isArray(items) || items.length === 0) throw new Error('The Library JSON does not contain a component')
  if (items.length !== 1) throw new Error('Import one Library item at a time')
  const item: unknown = items[0]
  if (Array.isArray(item)) return item
  if (isRecord(item) && Array.isArray(item.elements)) return item.elements
  throw new Error('The Library item does not contain valid elements')
}

/** `getImportedElements` ported: the four envelopes this app will read, and nothing else. */
export function importedElements(payload: unknown): unknown[] {
  if (!isRecord(payload)) throw new Error('Unsupported component JSON envelope')
  if (payload.type === 'growprofit/saved-component') {
    if (payload.schemaVersion !== SAVED_COMPONENT_SCHEMA_VERSION) throw new Error(`Unsupported component schema version: ${String(payload.schemaVersion)}`)
    if (!Array.isArray(payload.elements)) throw new Error('The component JSON must contain an elements array')
    if (payload.elementCount !== undefined && payload.elementCount !== payload.elements.length) throw new Error('Component element count does not match its payload')
    return payload.elements
  }
  if (payload.type === 'excalidraw' || payload.type === 'excalidraw/clipboard' || payload.type === 'excalidraw-api/clipboard') {
    if (!Array.isArray(payload.elements)) throw new Error('The Excalidraw JSON must contain an elements array')
    return payload.elements
  }
  if (payload.type === 'excalidrawlib') return libraryElements(payload)
  throw new Error('Unsupported component JSON envelope')
}

/**
 * The picked file as a component, ready for `componentFragmentJson()` and the preview: its live
 * elements plus the image bytes they name. A component embeds its pictures (🔒 D5), so the bytes
 * must be in the file that carried the elements — an id with nothing behind it is a refusal.
 */
export function parseImportedComponentJson(engine: ComponentEngine, source: string): CapturedComponent {
  let payload: unknown
  try {
    payload = JSON.parse(source) as unknown
  } catch {
    throw new Error('This file is not valid JSON')
  }
  const imported = importedElements(payload)
  assertSupportedComponentElements(imported)
  const restored = (engine.restoreElements(imported as never, null, { repairBindings: true }) as unknown as readonly unknown[]).filter(
    (element) => !(isRecord(element) && element.isDeleted === true),
  )
  assertSupportedComponentElements(restored)
  assertComponentElementsSize(restored)
  const carried = isRecord(payload) && isRecord(payload.files) ? payload.files : {}
  const files: Record<string, unknown> = {}
  for (const element of restored) {
    if (!isRecord(element) || element.type !== 'image') continue
    const fileId = element.fileId
    if (typeof fileId !== 'string' || !isRecord(carried[fileId])) throw new Error(`Image data is missing for file ${String(fileId)}`)
    files[fileId] = carried[fileId]
  }
  return { elements: restored, files }
}

/**
 * The component's name: the picked file's base name, as the issue locks it. A name that is only
 * punctuation or whitespace has nothing to show in the grid, so it falls back — the same rule
 * `slugForComponentName` applies one layer down, said here in the user's own words.
 */
export function importedComponentName(baseName: string): string {
  const trimmed = baseName.trim()
  return trimmed === '' ? IMPORTED_COMPONENT_NAME : trimmed
}
