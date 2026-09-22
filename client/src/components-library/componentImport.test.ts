/**
 * IMPORT JSON's parser (YAZ-1833). The engine's `restoreElements` is a stub — the port's own seam
 * (`componentData.ts`'s rule) — so what is pinned here is the ENVELOPE table, the deleted filter,
 * the image bytes an import carries, and that every refusal happens BEFORE anything is written.
 */
import { describe, expect, it, vi } from 'vitest'
import { MAX_COMPONENT_ELEMENTS_BYTES } from './componentData'
import type { ComponentEngine } from './componentData'
import { IMPORTED_COMPONENT_NAME, importedComponentName, importedElements, parseImportedComponentJson } from './componentImport'

const rect = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'rectangle', ...over })
const image = (id: string, fileId: string) => ({ id, type: 'image', fileId })
const png = { mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', id: 'f1' }

/** Restore is the engine's; here it is identity, which is what makes the rules visible. */
const engine = (restore: (els: readonly unknown[]) => unknown[] = (els) => [...els]): ComponentEngine =>
  ({ restoreElements: vi.fn((els: unknown) => restore(els as readonly unknown[])) }) as unknown as ComponentEngine

const scene = (elements: unknown[], files: Record<string, unknown> = {}) => JSON.stringify({ type: 'excalidraw', version: 2, source: 'x', elements, appState: {}, files })

describe('importedElements — the envelope table, ported verbatim', () => {
  it('takes the three scene/clipboard envelopes', () => {
    for (const type of ['excalidraw', 'excalidraw/clipboard', 'excalidraw-api/clipboard']) {
      expect(importedElements({ type, elements: [rect('a')] })).toEqual([rect('a')])
    }
  })

  it('takes the web app’s own saved-component envelope, and checks its version and count', () => {
    expect(importedElements({ type: 'growprofit/saved-component', schemaVersion: 1, elements: [rect('a')], elementCount: 1 })).toEqual([rect('a')])
    expect(() => importedElements({ type: 'growprofit/saved-component', schemaVersion: 2, elements: [] })).toThrow('Unsupported component schema version: 2')
    expect(() => importedElements({ type: 'growprofit/saved-component', schemaVersion: 1, elements: [rect('a')], elementCount: 2 })).toThrow(
      'Component element count does not match its payload',
    )
    expect(() => importedElements({ type: 'growprofit/saved-component', schemaVersion: 1 })).toThrow('The component JSON must contain an elements array')
  })

  it('takes a ONE-item Excalidraw Library, in either of its two shapes', () => {
    expect(importedElements({ type: 'excalidrawlib', version: 2, libraryItems: [{ elements: [rect('a')] }] })).toEqual([rect('a')])
    expect(importedElements({ type: 'excalidrawlib', version: 1, library: [[rect('b')]] })).toEqual([rect('b')])
    expect(() => importedElements({ type: 'excalidrawlib', version: 3, libraryItems: [] })).toThrow('Unsupported Excalidraw Library version')
    expect(() => importedElements({ type: 'excalidrawlib', version: 2, libraryItems: [] })).toThrow('The Library JSON does not contain a component')
    expect(() => importedElements({ type: 'excalidrawlib', version: 2, libraryItems: [{ elements: [] }, { elements: [] }] })).toThrow('Import one Library item at a time')
    expect(() => importedElements({ type: 'excalidrawlib', version: 2, libraryItems: [{ name: 'no elements' }] })).toThrow('The Library item does not contain valid elements')
  })

  it('refuses anything else, including a bare array and a null', () => {
    expect(() => importedElements([rect('a')])).toThrow('Unsupported component JSON envelope')
    expect(() => importedElements(null)).toThrow('Unsupported component JSON envelope')
    expect(() => importedElements({ type: 'excalidraw-library-but-not' })).toThrow('Unsupported component JSON envelope')
  })
})

describe('parseImportedComponentJson', () => {
  it('restores with repairBindings, exactly as the web app did', () => {
    const e = engine()
    parseImportedComponentJson(e, scene([rect('a')]))
    expect(e.restoreElements).toHaveBeenCalledWith([rect('a')], null, { repairBindings: true })
  })

  it('drops SOFT-DELETED elements, both the ones in the file and the ones restore produced', () => {
    const imported = parseImportedComponentJson(engine(), scene([rect('a'), rect('gone', { isDeleted: true })]))
    expect(imported.elements).toEqual([rect('a')])
  })

  it('KEEPS images and carries their bytes — the whole point of importing a board (🔒 D5)', () => {
    const imported = parseImportedComponentJson(engine(), scene([image('i1', 'f1'), image('i2', 'f2')], { f1: png, f2: { ...png, id: 'f2' }, f3: png }))
    expect(imported.elements).toHaveLength(2)
    // Only what the elements NAME travels; an unreferenced file in the source is not the component's.
    expect(Object.keys(imported.files)).toEqual(['f1', 'f2'])
  })

  it('refuses an image whose bytes are NOT in the file — a component that cannot insert is not saved', () => {
    expect(() => parseImportedComponentJson(engine(), scene([image('i1', 'f1')], {}))).toThrow('Image data is missing for file f1')
  })

  it('a file that is not JSON, and an empty one, are refusals with a readable sentence', () => {
    expect(() => parseImportedComponentJson(engine(), '')).toThrow('This file is not valid JSON')
    expect(() => parseImportedComponentJson(engine(), 'not json at all')).toThrow('This file is not valid JSON')
  })

  it('an EMPTY scene, and a scene that is only deleted elements, are refusals', () => {
    expect(() => parseImportedComponentJson(engine(), scene([]))).toThrow('A component must contain at least one element')
    expect(() => parseImportedComponentJson(engine(), scene([rect('gone', { isDeleted: true })]))).toThrow('A component must contain at least one element')
  })

  it('keeps the four support assertions — duplicate ids, embeddables, dangling references', () => {
    expect(() => parseImportedComponentJson(engine(), scene([rect('a'), rect('a')]))).toThrow('Duplicate element id: a')
    expect(() => parseImportedComponentJson(engine(), scene([{ id: 'e', type: 'embeddable' }]))).toThrow('Saved components do not support embeddable elements yet')
    expect(() => parseImportedComponentJson(engine(), scene([rect('a', { frameId: 'nope' })]))).toThrow('Element a references a missing frame (nope)')
  })

  it('keeps the size ceiling on the ELEMENTS', () => {
    const fat = [rect('a', { note: 'x'.repeat(MAX_COMPONENT_ELEMENTS_BYTES) })]
    expect(() => parseImportedComponentJson(engine(), scene(fat))).toThrow(/bytes or smaller/)
  })
})

describe('importedComponentName', () => {
  it('is the file’s own base name', () => {
    expect(importedComponentName('03 Legacy embedded')).toBe('03 Legacy embedded')
    expect(importedComponentName('  Spaced  ')).toBe('Spaced')
  })

  it('falls back when the base name has nothing in it', () => {
    expect(importedComponentName('')).toBe(IMPORTED_COMPONENT_NAME)
    expect(importedComponentName('   ')).toBe(IMPORTED_COMPONENT_NAME)
  })
})
