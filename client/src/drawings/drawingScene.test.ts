import { describe, expect, it } from 'vitest'
import { DRAWING_SOURCE, EMPTY_SCENE, EMPTY_SCENE_JSON, parseSceneText } from './drawingScene'

/**
 * `parseSceneText` is 2D's acceptance criterion in one function: "corrupt and empty files show a
 * readable error, never a blank pane". Every throw path below is a file a user can really hand it.
 */
describe('parseSceneText', () => {
  it('reads the elements, appState and files of a real scene', () => {
    const scene = parseSceneText(JSON.stringify({ type: 'excalidraw', elements: [{ id: 'a' }], appState: { gridSize: 20 }, files: { f1: { mimeType: 'image/png' } } }))
    expect(scene.elements).toEqual([{ id: 'a' }])
    expect(scene.appState).toEqual({ gridSize: 20 })
    expect(scene.files).toEqual({ f1: { mimeType: 'image/png' } })
  })

  it('defaults a missing appState / files to empty objects — the engine then uses its own', () => {
    const scene = parseSceneText(JSON.stringify({ elements: [] }))
    expect(scene.appState).toEqual({})
    expect(scene.files).toEqual({})
  })

  it('treats an ARRAY appState / files as absent, exactly as it treats an array scene', () => {
    // `typeof [] === 'object'`: without the array check these would be adopted as prefs and images.
    const scene = parseSceneText(JSON.stringify({ elements: [], appState: [], files: [] }))
    expect(scene.appState).toEqual({})
    expect(scene.files).toEqual({})
  })

  it.each([
    ['an empty file', ''],
    ['whitespace only', '   '],
    ['truncated JSON', '{"elements": ['],
    ['not JSON at all', 'hello'],
  ])('throws on %s', (_label, text) => {
    expect(() => parseSceneText(text)).toThrow()
  })

  it.each([
    ['a bare array', '[]'],
    ['a JSON null', 'null'],
    ['a JSON string', '"scene"'],
    ['a JSON number', '42'],
  ])('throws "not an Excalidraw scene" on %s', (_label, text) => {
    expect(() => parseSceneText(text)).toThrow('not an Excalidraw scene')
  })

  it('throws when there is no elements ARRAY, whatever else the object carries', () => {
    expect(() => parseSceneText('{}')).toThrow('not an Excalidraw scene: no elements')
    expect(() => parseSceneText('{"elements": {}}')).toThrow('not an Excalidraw scene: no elements')
    expect(() => parseSceneText('{"elements": null}')).toThrow('not an Excalidraw scene: no elements')
  })
})

describe('the bytes a new drawing is born with', () => {
  it('EMPTY_SCENE_JSON parses back to an empty scene and ends with a newline', () => {
    expect(EMPTY_SCENE_JSON.endsWith('\n')).toBe(true)
    const scene = parseSceneText(EMPTY_SCENE_JSON)
    expect(scene.elements).toEqual([])
    expect(scene.appState).toEqual({})
    expect(scene.files).toEqual({})
  })

  it('carries the export shape `restore()` reads, stamped with this app as the source', () => {
    expect(EMPTY_SCENE.type).toBe('excalidraw')
    expect(EMPTY_SCENE.version).toBe(2)
    expect(EMPTY_SCENE.source).toBe(DRAWING_SOURCE)
  })
})
