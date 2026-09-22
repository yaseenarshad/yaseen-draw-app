/**
 * WHAT A COMPONENT IS MADE OF, AND WHAT AN INSERT DOES (🔒 D5, YAZ-1819):
 * `excalidraw-app/components/SavedComponentsData.ts` ported — its validation, its capture and its
 * insert-as-an-independent-copy — with the Convex half replaced by the library folder.
 *
 * THE CAPTURE IS THE WEB APP'S, RULE FOR RULE. `getSelectedElements` with
 * `includeBoundTextElement` and `includeElementsInFrames`, `deepCopyElement` over the result, and
 * then the same four assertions: at least one element, no duplicate ids, no `iframe` / `embeddable`,
 * and no dangling `frameId` / `containerId` / bound-text reference. A component that references
 * something it does not carry would insert broken, which is the whole reason those checks exist.
 *
 * IMAGES ARE ALWAYS ALLOWED, AND THEIR BYTES TRAVEL WITH THEM. The web app listed `image` as
 * unsupported and then passed `allowImages: true` everywhere it mattered, because its images lived
 * in its own object store. 🔒 D5 makes the same call for a different reason: a component is small
 * and self-contained, so its bytes are EMBEDDED in the fragment as dataURLs and it inserts into
 * any vault, on any machine, with no shared store at all.
 *
 * WHAT AN INSERT COSTS ON DISK: nothing, here. `insertElements` is the engine's own paste door —
 * it runs the elements through `duplicateElements`, so every insert is a FRESH set of ids placed
 * at the middle of what the user can see, and two inserts of one component are two independent
 * copies. The files handed to `addFiles` beside them become `assets/` files through 2E (🔒 D3):
 * the engine's files map grows ids the store does not hold, `unpersistedFiles` picks them up, and
 * `drawing:save` writes them BEFORE the scene that names them, deduped by `fileId`.
 *
 * ENGINE-BOUND BY DESIGN: every engine value comes in as an argument rather than being imported
 * (`engine.ts`'s lazy rule), which is also what makes this testable with a stub.
 */
import { DRAWING_SOURCE } from '../drawings/drawingScene'
import { parseComponentFragment } from '@shared/savedComponents'
import type { ExcalidrawElementModule, ExcalidrawImperativeApi, ExcalidrawModule } from '../drawings/engine'

/** The element types a component may not contain — the web app's list, minus the images it carries. */
export const UNSUPPORTED_COMPONENT_ELEMENT_TYPES = ['iframe', 'embeddable'] as const

/**
 * The web app's `MAX_SAVED_COMPONENT_BYTES` (`packages/common/src/savedComponents.ts`), applied
 * where it applied there: to the ELEMENTS, not to the embedded image bytes beside them. A
 * component is a handful of shapes; three quarters of a megabyte of geometry is a board.
 */
export const MAX_COMPONENT_ELEMENTS_BYTES = 750_000

/** The engine values this module needs; all on `@excalidraw/excalidraw`'s own index. */
export type ComponentEngine = Pick<ExcalidrawModule, 'restoreElements'>
/** The element package's two (`loadExcalidrawElement`, the second lazy package — YAZ-1818). */
export type ComponentElementApi = Pick<ExcalidrawElementModule, 'getSelectedElements' | 'deepCopyElement'>
/** The slice of the engine's imperative handle a capture and an insert use. */
export type ComponentTarget = Pick<ExcalidrawImperativeApi, 'getAppState' | 'getSceneElements' | 'getFiles' | 'addFiles' | 'insertElements'>

type JsonRecord = Record<string, unknown>
const isRecord = (v: unknown): v is JsonRecord => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A component's elements and the image bytes they name, in hand. */
export interface CapturedComponent {
  elements: readonly unknown[]
  files: Record<string, unknown>
}

/**
 * `assertSupportedElements` ported: the four checks, in the web app's own order, with its own
 * messages — every one of them is a sentence the user reads in the tab's error line.
 */
export function assertSupportedComponentElements(elements: readonly unknown[]): void {
  if (elements.length === 0) throw new Error('A component must contain at least one element')
  const ids = new Set<string>()
  for (const element of elements) {
    if (!isRecord(element) || typeof element.id !== 'string' || typeof element.type !== 'string') throw new Error('Every component element must have a valid id and type')
    if (ids.has(element.id)) throw new Error(`Duplicate element id: ${element.id}`)
    ids.add(element.id)
    if ((UNSUPPORTED_COMPONENT_ELEMENT_TYPES as readonly string[]).includes(element.type)) throw new Error(`Saved components do not support ${element.type} elements yet`)
  }
  for (const element of elements) {
    if (!isRecord(element)) continue
    const id = String(element.id)
    if (typeof element.frameId === 'string' && !ids.has(element.frameId)) throw new Error(`Element ${id} references a missing frame (${element.frameId})`)
    if (element.type === 'text' && typeof element.containerId === 'string' && !ids.has(element.containerId)) {
      throw new Error(`Text element ${id} references a missing container (${element.containerId})`)
    }
    const bound = Array.isArray(element.boundElements) ? element.boundElements : []
    for (const entry of bound) {
      if (isRecord(entry) && entry.type === 'text' && typeof entry.id === 'string' && !ids.has(entry.id)) throw new Error(`Element ${id} references missing bound text (${entry.id})`)
    }
  }
}

/** `serializeSavedComponent`'s size guard, on the elements alone (see the constant's note). */
export function assertComponentElementsSize(elements: readonly unknown[]): void {
  const bytes = new TextEncoder().encode(JSON.stringify(elements)).byteLength
  if (bytes > MAX_COMPONENT_ELEMENTS_BYTES) throw new Error(`Component payloads must be ${MAX_COMPONENT_ELEMENTS_BYTES.toLocaleString('en-US')} bytes or smaller`)
}

/**
 * `captureSavedComponentSelectionWithFiles` ported: the selection, deep-copied, validated, with
 * every image element's bytes pulled out of the scene's own files map. A missing byte throws
 * rather than saving a component that cannot be inserted.
 */
export function captureComponentSelection(element: ComponentElementApi, api: ComponentTarget): CapturedComponent {
  const appState = api.getAppState()
  const selected = element
    .getSelectedElements(api.getSceneElements(), { selectedElementIds: appState.selectedElementIds }, { includeBoundTextElement: true, includeElementsInFrames: true })
    .map((el) => element.deepCopyElement(el)) as unknown as readonly unknown[]
  assertSupportedComponentElements(selected)
  assertComponentElementsSize(selected)
  const sceneFiles = api.getFiles() as unknown as Record<string, unknown>
  const files: Record<string, unknown> = {}
  for (const el of selected) {
    if (!isRecord(el) || el.type !== 'image' || typeof el.fileId !== 'string') continue
    const file = sceneFiles[el.fileId]
    if (file === undefined) throw new Error(`Image data is missing for file ${el.fileId}`)
    files[el.fileId] = file
  }
  return { elements: selected, files }
}

/**
 * The bytes that become `<library>/components/<slug>.excalidraw` (🔒 D5): a whole Excalidraw
 * document with `appState: {}` — the same envelope `drawingScene.ts` writes a board with, so a
 * component opens in this app, in the web app, and on excalidraw.com — and with its image bytes
 * EMBEDDED, which is the one place this app deliberately does not follow 🔒 D3.
 */
export function componentFragmentJson({ elements, files }: CapturedComponent): string {
  return `${JSON.stringify({ type: 'excalidraw', version: 2, source: DRAWING_SOURCE, elements, appState: {}, files }, null, 2)}\n`
}

/** The fragment's files map as the engine's `addFiles` wants it: an array carrying its own ids. */
function fileEntries(files: Record<string, unknown>, referenced: ReadonlySet<string>): Parameters<ComponentTarget['addFiles']>[0] {
  const created = Date.now()
  return Object.entries(files)
    .filter(([id]) => referenced.has(id))
    .map(([id, entry]) => ({ ...(isRecord(entry) ? entry : {}), id, created })) as unknown as Parameters<ComponentTarget['addFiles']>[0]
}

/**
 * `insertSavedComponent` ported. The fragment is validated and restored (`repairBindings`, the web
 * app's own call), its bytes are handed to the engine, and the elements go through
 * `insertElements` — the door that duplicates ids and centres on the viewport, which is what makes
 * every insert an INDEPENDENT COPY. Answers what was handed in, for the tests and the toast.
 */
export function insertComponent(engine: ComponentEngine, api: ComponentTarget, fragmentJson: string): readonly unknown[] {
  const fragment = parseComponentFragment(fragmentJson)
  assertSupportedComponentElements(fragment.elements)
  const restored = (engine.restoreElements(fragment.elements as never, null, { repairBindings: true }) as unknown as readonly unknown[]).filter(
    (element) => !(isRecord(element) && element.isDeleted === true),
  )
  assertSupportedComponentElements(restored)
  const referenced = new Set<string>()
  for (const element of restored) if (isRecord(element) && element.type === 'image' && typeof element.fileId === 'string') referenced.add(element.fileId)
  const entries = fileEntries(fragment.files, referenced)
  if (entries.length > 0) api.addFiles(entries)
  api.insertElements(restored as never)
  return restored
}
