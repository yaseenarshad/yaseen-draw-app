import { describe, expect, it } from 'vitest'
import { DEFAULT_CANVAS_PREFS, type CanvasPrefs } from './types'
import { appStateToPrefs, CANVAS_PREF_KEYS, changedPrefKeys, isCanvasPrefs, prefsEqual, prefsToAppState, sanitizeCanvasPrefs, type EngineAppStateSlice } from './canvasPrefs'

const prefs = (over: Partial<CanvasPrefs> = {}): CanvasPrefs => ({ ...DEFAULT_CANVAS_PREFS, ...over })

describe('DEFAULT_CANVAS_PREFS', () => {
  it('is the engine`s own defaults (🔒 D9: the fork`s appState.ts / constants.ts)', () => {
    expect(DEFAULT_CANVAS_PREFS).toEqual({
      gridModeEnabled: false,
      objectsSnapModeEnabled: false,
      snapToMidpoints: true,
      arrowBinding: true,
      selectOn: 'wrap',
      toolLock: false,
      zenModeEnabled: false,
      writingMode: false,
      writingStrokeWidth: 0.5,
      vectorStrokeWidth: 2,
      framesVisible: true,
      defaultFontFamily: 10,
      defaultRoughness: 0,
      defaultTextAlign: 'center',
    })
  })

  it('is the FOURTEEN keys D9 names, and no more', () => {
    expect(CANVAS_PREF_KEYS).toHaveLength(14)
    // The round-4 amendment removed the properties-toolbar pref: the toolbar mode is a constant.
    expect(CANVAS_PREF_KEYS).not.toContain('propertiesToolbar')
  })
})

describe('isCanvasPrefs (strict — the IPC boundary)', () => {
  it('accepts a complete, valid record', () => {
    expect(isCanvasPrefs(prefs())).toBe(true)
  })

  it('rejects anything that is not a plain object', () => {
    for (const bad of [null, undefined, 3, 'x', [], [DEFAULT_CANVAS_PREFS]]) expect(isCanvasPrefs(bad)).toBe(false)
  })

  it('rejects a MISSING field — a partial is the loader`s business, not the bridge`s', () => {
    const { framesVisible: _drop, ...partial } = prefs()
    expect(isCanvasPrefs(partial)).toBe(false)
  })

  it('rejects a field of the wrong type or outside its vocabulary', () => {
    expect(isCanvasPrefs({ ...prefs(), gridModeEnabled: 'yes' })).toBe(false)
    expect(isCanvasPrefs({ ...prefs(), selectOn: 'contain' })).toBe(false) // the ENGINE's word, not ours
    expect(isCanvasPrefs({ ...prefs(), defaultTextAlign: 'justify' })).toBe(false)
    expect(isCanvasPrefs({ ...prefs(), defaultRoughness: 3 })).toBe(false)
    expect(isCanvasPrefs({ ...prefs(), writingStrokeWidth: 0 })).toBe(false)
    expect(isCanvasPrefs({ ...prefs(), vectorStrokeWidth: Number.NaN })).toBe(false)
    expect(isCanvasPrefs({ ...prefs(), defaultFontFamily: 10.5 })).toBe(false)
  })
})

describe('sanitizeCanvasPrefs (lenient — the state file)', () => {
  it('keeps every valid field and defaults only the bad ones', () => {
    expect(sanitizeCanvasPrefs({ gridModeEnabled: true, selectOn: 'overlap', defaultRoughness: 7, zenModeEnabled: 'no' })).toEqual(
      prefs({ gridModeEnabled: true, selectOn: 'overlap' }),
    )
  })

  it('answers the defaults for junk — a store from before a key existed still loads whole', () => {
    for (const junk of [null, undefined, 42, 'x', []]) expect(sanitizeCanvasPrefs(junk)).toEqual(DEFAULT_CANVAS_PREFS)
  })

  it('never returns the shared default object itself', () => {
    expect(sanitizeCanvasPrefs({})).not.toBe(DEFAULT_CANVAS_PREFS)
  })
})

describe('prefsToAppState', () => {
  it('maps every key onto the engine`s own name, defaults included', () => {
    expect(prefsToAppState(prefs())).toEqual({
      gridModeEnabled: false,
      objectsSnapModeEnabled: false,
      isMidpointSnappingEnabled: true,
      isBindingEnabled: true,
      boxSelectionMode: 'contain',
      activeTool: { type: 'selection', customType: null, fromSelection: false, lastActiveTool: null, locked: false },
      zenModeEnabled: false,
      writingMode: false,
      currentItemWritingStrokeWidth: 0.5,
      currentItemVectorStrokeWidth: 2,
      currentItemFontFamily: 10,
      currentItemRoughness: 0,
      currentItemTextAlign: 'center',
    })
  })

  it('never emits framesVisible — that one goes through updateFrameRendering', () => {
    expect(prefsToAppState(prefs({ framesVisible: false }))).not.toHaveProperty('frameRendering')
    expect(prefsToAppState(prefs(), ['framesVisible'])).toEqual({})
  })

  it('translates selectOn into the engine`s boxSelectionMode both ways', () => {
    expect(prefsToAppState(prefs({ selectOn: 'wrap' }), ['selectOn'])).toEqual({ boxSelectionMode: 'contain' })
    expect(prefsToAppState(prefs({ selectOn: 'overlap' }), ['selectOn'])).toEqual({ boxSelectionMode: 'overlap' })
  })

  it('emits ONLY the keys it is asked for', () => {
    expect(prefsToAppState(prefs({ gridModeEnabled: true }), ['gridModeEnabled'])).toEqual({ gridModeEnabled: true })
  })

  it('emits a WHOLE activeTool for toolLock — a partial one would wipe the held tool', () => {
    const out = prefsToAppState(prefs({ toolLock: true }), ['toolLock'])
    expect(out.activeTool).toEqual({ type: 'selection', customType: null, fromSelection: false, lastActiveTool: null, locked: true })
  })
})

describe('appStateToPrefs', () => {
  const full: EngineAppStateSlice = {
    gridModeEnabled: true,
    objectsSnapModeEnabled: true,
    isMidpointSnappingEnabled: false,
    isBindingEnabled: false,
    boxSelectionMode: 'overlap',
    activeTool: { locked: true },
    zenModeEnabled: true,
    writingMode: true,
    currentItemWritingStrokeWidth: 1.5,
    currentItemVectorStrokeWidth: 4,
    frameRendering: { outline: false, name: false },
    currentItemFontFamily: 5,
    currentItemRoughness: 2,
    currentItemTextAlign: 'left',
  }

  it('reads every key back off the engine', () => {
    expect(appStateToPrefs(full, DEFAULT_CANVAS_PREFS)).toEqual({
      gridModeEnabled: true,
      objectsSnapModeEnabled: true,
      snapToMidpoints: false,
      arrowBinding: false,
      selectOn: 'overlap',
      toolLock: true,
      zenModeEnabled: true,
      writingMode: true,
      writingStrokeWidth: 1.5,
      vectorStrokeWidth: 4,
      framesVisible: false,
      defaultFontFamily: 5,
      defaultRoughness: 2,
      defaultTextAlign: 'left',
    })
  })

  it('round-trips through prefsToAppState', () => {
    const start = prefs({ gridModeEnabled: true, selectOn: 'overlap', toolLock: true, writingStrokeWidth: 0.75, defaultFontFamily: 5, defaultRoughness: 1, defaultTextAlign: 'right' })
    const back = appStateToPrefs({ ...(prefsToAppState(start) as EngineAppStateSlice), frameRendering: { outline: start.framesVisible, name: start.framesVisible } }, DEFAULT_CANVAS_PREFS)
    expect(back).toEqual(start)
  })

  it('falls back per field: an appState missing a key never overwrites the stored value', () => {
    const stored = prefs({ writingMode: true, gridModeEnabled: true, framesVisible: false })
    expect(appStateToPrefs({}, stored)).toEqual(stored)
  })

  it('treats a half-applied frameRendering as "no answer" rather than as a preference', () => {
    const stored = prefs({ framesVisible: false })
    expect(appStateToPrefs({ frameRendering: { outline: true } }, stored).framesVisible).toBe(false)
    expect(appStateToPrefs({ frameRendering: null }, stored).framesVisible).toBe(false)
    expect(appStateToPrefs({ frameRendering: { outline: true, name: true } }, stored).framesVisible).toBe(true)
  })

  it('ignores a value the engine could not have meant', () => {
    const stored = prefs({ defaultRoughness: 1, vectorStrokeWidth: 3 })
    expect(appStateToPrefs({ currentItemRoughness: 9, currentItemVectorStrokeWidth: -1, boxSelectionMode: undefined }, stored)).toEqual(stored)
  })
})

describe('prefsEqual / changedPrefKeys (the anti-ping-pong rule)', () => {
  it('equal by VALUE, not identity', () => {
    expect(prefsEqual(prefs(), prefs())).toBe(true)
    expect(prefsEqual(prefs(), prefs({ zenModeEnabled: true }))).toBe(false)
  })

  it('names only what moved, in key order', () => {
    expect(changedPrefKeys(prefs(), prefs())).toEqual([])
    expect(changedPrefKeys(prefs(), prefs({ defaultTextAlign: 'left', gridModeEnabled: true }))).toEqual(['gridModeEnabled', 'defaultTextAlign'])
  })
})
