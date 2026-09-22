/**
 * What a component is made of, and what an insert does (🔒 YAZ-1775 D5, YAZ-1819). The engine comes in as a
 * stub — the web app's rules are the thing under test, plus the one promise about an insert that
 * YAZ-1811 has to be able to keep: the bytes arrive at the canvas UNPERSISTED, which is how they become
 * an `assets/` file.
 */
import { describe, expect, it, vi } from 'vitest'
import { unpersistedFiles, type DrawingFileData } from '@shared/drawingAssets'
import {
  MAX_COMPONENT_ELEMENTS_BYTES,
  assertSupportedComponentElements,
  captureComponentSelection,
  componentFragmentJson,
  insertComponent,
  type ComponentElementApi,
  type ComponentEngine,
  type ComponentTarget,
} from './componentData'

const rect = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'rectangle', ...over })
const image = (id: string, fileId: string) => ({ id, type: 'image', fileId })
const bytes = (dataURL = 'data:image/png;base64,AA=='): DrawingFileData => ({ mimeType: 'image/png', dataURL })

/** The element package's two functions, as the capture uses them. */
function fakeElementApi(selected: unknown[]): ComponentElementApi {
  return {
    getSelectedElements: vi.fn(() => selected),
    deepCopyElement: vi.fn((el: unknown) => ({ ...(el as object) })),
  } as unknown as ComponentElementApi
}

function fakeCanvas(over: { selected?: Record<string, true>; scene?: unknown[]; files?: Record<string, unknown> } = {}) {
  const addFiles = vi.fn()
  const insertElements = vi.fn()
  return {
    addFiles,
    insertElements,
    api: {
      getAppState: () => ({ selectedElementIds: over.selected ?? {} }),
      getSceneElements: () => over.scene ?? [],
      getFiles: () => over.files ?? {},
      addFiles,
      insertElements,
    } as unknown as ComponentTarget,
  }
}

/** `restoreElements` as the engine's own: hand back what it was given. */
const engine: ComponentEngine = { restoreElements: vi.fn((elements: unknown) => elements) } as unknown as ComponentEngine

describe('assertSupportedComponentElements — the web app’s four checks', () => {
  it('an empty selection is not a component', () => {
    expect(() => assertSupportedComponentElements([])).toThrow('A component must contain at least one element')
  })

  it('every element needs an id and a type', () => {
    expect(() => assertSupportedComponentElements([{ type: 'rectangle' }])).toThrow(/valid id and type/)
    expect(() => assertSupportedComponentElements([{ id: 'a' }])).toThrow(/valid id and type/)
  })

  it('a duplicate id is refused by its own id', () => {
    expect(() => assertSupportedComponentElements([rect('a'), rect('a')])).toThrow('Duplicate element id: a')
  })

  it('iframes and embeddables are still unsupported; an IMAGE is not (🔒 YAZ-1775 D5: it carries its bytes)', () => {
    expect(() => assertSupportedComponentElements([{ id: 'a', type: 'iframe' }])).toThrow(/do not support iframe/)
    expect(() => assertSupportedComponentElements([{ id: 'a', type: 'embeddable' }])).toThrow(/do not support embeddable/)
    expect(() => assertSupportedComponentElements([image('a', 'f1')])).not.toThrow()
  })

  it('a reference to something the selection does not carry is refused — it would insert broken', () => {
    expect(() => assertSupportedComponentElements([rect('a', { frameId: 'nope' })])).toThrow(/missing frame \(nope\)/)
    expect(() => assertSupportedComponentElements([{ id: 'a', type: 'text', containerId: 'nope' }])).toThrow(/missing container \(nope\)/)
    expect(() => assertSupportedComponentElements([rect('a', { boundElements: [{ type: 'text', id: 'nope' }] })])).toThrow(/missing bound text \(nope\)/)
  })

  it('a reference the selection DOES carry passes', () => {
    expect(() => assertSupportedComponentElements([rect('frame'), rect('a', { frameId: 'frame' })])).not.toThrow()
  })
})

describe('captureComponentSelection — the selection, deep-copied, with its bytes', () => {
  it('asks for bound text and elements in frames, the web app’s own options', () => {
    const element = fakeElementApi([rect('a')])
    const canvas = fakeCanvas({ selected: { a: true } })
    captureComponentSelection(element, canvas.api)
    expect(element.getSelectedElements).toHaveBeenCalledWith([], { selectedElementIds: { a: true } }, { includeBoundTextElement: true, includeElementsInFrames: true })
  })

  it('DEEP-COPIES every element, so editing the board afterwards cannot change the component', () => {
    const live = rect('a')
    const element = fakeElementApi([live])
    const captured = captureComponentSelection(element, fakeCanvas().api)
    expect(captured.elements[0]).toEqual(live)
    expect(captured.elements[0]).not.toBe(live)
  })

  it('carries only the files its own image elements name, out of the whole scene’s map', () => {
    const element = fakeElementApi([image('a', 'f1'), rect('b')])
    const captured = captureComponentSelection(element, fakeCanvas({ files: { f1: bytes(), f2: bytes('data:image/png;base64,BB==') } }).api)
    expect(captured.files).toEqual({ f1: bytes() })
  })

  it('refuses a selection whose image bytes the scene does not hold', () => {
    const element = fakeElementApi([image('a', 'f1')])
    expect(() => captureComponentSelection(element, fakeCanvas().api)).toThrow('Image data is missing for file f1')
  })

  it('refuses a selection past the web app’s elements ceiling', () => {
    const element = fakeElementApi([rect('a', { note: 'x'.repeat(MAX_COMPONENT_ELEMENTS_BYTES) })])
    expect(() => captureComponentSelection(element, fakeCanvas().api)).toThrow(/bytes or smaller/)
  })
})

describe('componentFragmentJson — the bytes that land in the library (🔒 YAZ-1775 D5)', () => {
  it('is a whole Excalidraw document with an EMPTY appState and the bytes embedded', () => {
    const json = componentFragmentJson({ elements: [image('a', 'f1')], files: { f1: bytes() } })
    expect(JSON.parse(json)).toEqual({ type: 'excalidraw', version: 2, source: 'yaseen-draw', elements: [image('a', 'f1')], appState: {}, files: { f1: bytes() } })
  })

  it('is pretty-printed with a trailing newline, like every other file this app writes', () => {
    const json = componentFragmentJson({ elements: [rect('a')], files: {} })
    expect(json.endsWith('\n')).toBe(true)
    expect(json).toContain('\n  "type": "excalidraw"')
  })
})

describe('insertComponent — an INDEPENDENT copy, at the viewport centre', () => {
  it('restores with repairBindings and hands the elements to the engine’s own insert door', () => {
    const canvas = fakeCanvas()
    insertComponent(engine, canvas.api, componentFragmentJson({ elements: [rect('a')], files: {} }))
    expect(engine.restoreElements).toHaveBeenCalledWith([rect('a')], null, { repairBindings: true })
    // `insertElements` is the paste path: it duplicates ids and centres on the viewport, which is
    // what makes two inserts of one component two independent copies.
    expect(canvas.insertElements).toHaveBeenCalledWith([rect('a')])
  })

  it('adds the embedded bytes BEFORE the elements that name them, each carrying its own id', () => {
    const canvas = fakeCanvas()
    insertComponent(engine, canvas.api, componentFragmentJson({ elements: [image('a', 'f1')], files: { f1: bytes() } }))
    expect(canvas.addFiles).toHaveBeenCalledWith([{ ...bytes(), id: 'f1', created: expect.any(Number) }])
    expect(canvas.addFiles.mock.invocationCallOrder[0]).toBeLessThan(canvas.insertElements.mock.invocationCallOrder[0])
  })

  it('adds nothing at all for a component with no images', () => {
    const canvas = fakeCanvas()
    insertComponent(engine, canvas.api, componentFragmentJson({ elements: [rect('a')], files: {} }))
    expect(canvas.addFiles).not.toHaveBeenCalled()
  })

  it('leaves the inserted bytes reported as UNPERSISTED, which is how they become an `assets/` file (🔒 YAZ-1775 D3, through YAZ-1811)', () => {
    const canvas = fakeCanvas()
    insertComponent(engine, canvas.api, componentFragmentJson({ elements: [image('a', 'f1')], files: { f1: bytes() } }))
    // What the engine now holds, and what the scene references — YAZ-1811's own function on both.
    const files: Record<string, DrawingFileData> = Object.fromEntries((canvas.addFiles.mock.calls[0][0] as { id: string }[]).map((f) => [f.id, bytes()]))
    expect(unpersistedFiles(files, new Set(['f1']), new Set()).map((f) => f.fileId)).toEqual(['f1'])
    // …and nothing once the save has confirmed it: a second insert of the same component in the
    // same vault writes no second asset (the store is content-addressed, 🔒 YAZ-1775 D3).
    expect(unpersistedFiles(files, new Set(['f1']), new Set(['f1']))).toEqual([])
  })

  it('drops a soft-deleted element the engine restored rather than inserting a ghost', () => {
    const canvas = fakeCanvas()
    const restoring: ComponentEngine = { restoreElements: () => [rect('a'), { ...rect('b'), isDeleted: true }] } as unknown as ComponentEngine
    insertComponent(restoring, canvas.api, componentFragmentJson({ elements: [rect('a'), rect('b')], files: {} }))
    expect(canvas.insertElements).toHaveBeenCalledWith([rect('a')])
  })

  it('refuses a fragment whose image bytes are missing — a component must insert in ANY vault', () => {
    expect(() => insertComponent(engine, fakeCanvas().api, JSON.stringify({ elements: [image('a', 'f1')], files: {} }))).toThrow(/image data is missing/)
  })
})
