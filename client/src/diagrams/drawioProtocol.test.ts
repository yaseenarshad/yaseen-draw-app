import { describe, expect, it } from 'vitest'
import { DRAWIO_ORIGIN, drawioAdaptiveColors, drawioConfig, drawioFrameUrl, readDrawioMessage } from './drawioProtocol'

describe('drawioFrameUrl (🔒 YAZ-1802 D4)', () => {
  it('is the drawio origin in embed + JSON + configure mode, with every door to the network shut', () => {
    const url = new URL(drawioFrameUrl('light'))
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(`${DRAWIO_ORIGIN}/index.html`)
    const p = Object.fromEntries(url.searchParams)
    expect(p).toMatchObject({ embed: '1', proto: 'json', configure: '1', noSaveBtn: '1', noExitBtn: '1', saveAndExit: '0' })
    expect(p).toMatchObject({ offline: '1', stealth: '1', lockdown: '1', plugins: '0', pwa: '0', gapi: '0', db: '0', od: '0', gh: '0', gl: '0', tr: '0' })
    expect(p).toMatchObject({ pv: '0', dark: '0' })
  })

  it('carries the app theme at mount', () => {
    expect(new URL(drawioFrameUrl('dark')).searchParams.get('dark')).toBe('1')
  })
})

describe('drawioAdaptiveColors (🔒 YAZ-1802 D16)', () => {
  it('is the dark-mode colour setting in draw.io’s own words: adapt → auto, keep → none', () => {
    expect(drawioAdaptiveColors('adapt')).toBe('auto')
    expect(drawioAdaptiveColors('keep')).toBe('none')
  })
})

describe('drawioConfig (🔒 YAZ-1802 D3 / D12a / D12b / D16)', () => {
  type Shortcut = { keyCode: string | number; control?: boolean; shift?: boolean; action: string | null }
  const config = drawioConfig('adapt') as { defaultFonts: string[]; presetColors: string[]; defaultColors: string[]; keyboardShortcuts: Shortcut[] }

  it('starts draw.io on the dark-mode colour setting', () => {
    expect(config).toMatchObject({ defaultAdaptiveColors: 'auto' })
    expect(drawioConfig('keep')).toMatchObject({ defaultAdaptiveColors: 'none' })
  })

  it('saves plain XML, page view and grid off, and leaves guides a per-diagram toggle', () => {
    expect(config).toMatchObject({ compressXml: false, defaultPageVisible: false, defaultGridEnabled: false, zoomWheel: false })
    expect(config).not.toHaveProperty('enablePositionGuides')
  })

  it('offers our fonts first and draws colours without a #', () => {
    expect(config.defaultFonts).toEqual(['Assistant', 'Inter', 'Roboto', 'IBM Plex Mono', 'Liberation Serif'])
    for (const colour of [...config.presetColors, ...config.defaultColors]) expect(colour).toMatch(/^(none|[0-9A-F]{6})$/)
  })

  it('lays the open-colour palette out as draw.io draws it, twelve to a row: a column per family, lightest first', () => {
    const column = (i: number) => [0, 1, 2, 3, 4].map((row) => config.defaultColors[row * 12 + i])
    expect(column(1)).toEqual(['FFF5F5', 'FFC9C9', 'FF8787', 'FA5252', 'E03131']) // red
    expect(column(11)).toEqual(['F8F1EE', 'EADDD7', 'D2BAB0', 'A18072', '846358']) // bronze
    expect(config.defaultColors.slice(60)).toEqual(['none', 'FFFFFF', '1E1E1E'])
  })

  it('binds the Excalidraw tool letters and clears draw.io’s clashing S and F — with nothing selected', () => {
    const bare = Object.fromEntries(config.keyboardShortcuts.filter((s) => typeof s.keyCode === 'string').map((s) => [s.keyCode, s.action]))
    expect(bare).toEqual({ R: 'insertRectangle', O: 'insertEllipse', T: 'insertText', A: 'insertEdge', D: 'insertEdge', L: 'insertEdge', W: 'insertFreehand', P: 'insertFreehand', S: null, F: null })
    expect(config.keyboardShortcuts).toContainEqual({ keyCode: 220, control: true, action: 'removeFormat' })
  })

  it('clears draw.io’s own ⌘K, ⌘, ⌘⇧O and zoom keys, so the app menu gets them on every platform', () => {
    const cleared = config.keyboardShortcuts.filter((s) => s.action === null && s.control === true)
    expect(cleared.filter((s) => s.shift !== true).map((s) => s.keyCode)).toEqual(expect.arrayContaining([75, 188, 48, 187, 189]))
    expect(cleared).toContainEqual({ keyCode: 79, control: true, shift: true, action: null })
  })
})

describe('readDrawioMessage — only THAT iframe, only the drawio origin (🔒 YAZ-1802 D4)', () => {
  const frame = {}
  const msg = (data: unknown, over: Partial<{ source: unknown; origin: string }> = {}) => readDrawioMessage({ source: frame, origin: DRAWIO_ORIGIN, data, ...over }, frame)

  it('reads the protocol events', () => {
    expect(msg('{"event":"yaseenReady"}')).toEqual({ event: 'yaseenReady' })
    expect(msg('{"event":"configure"}')).toEqual({ event: 'configure' })
    expect(msg('{"event":"init"}')).toEqual({ event: 'init' })
    expect(msg('{"event":"load","xml":"<mxfile/>","scale":1}')).toEqual({ event: 'load', xml: '<mxfile/>' })
    expect(msg('{"event":"autosave","xml":"<mxfile/>"}')).toEqual({ event: 'autosave', xml: '<mxfile/>' })
    expect(msg('{"event":"save","xml":"<mxfile/>","exit":false}')).toEqual({ event: 'save', xml: '<mxfile/>' })
  })

  it('reads a forwarded app shortcut only when it is one the host knows', () => {
    expect(msg('{"event":"shortcut","command":"toggleSidebar"}')).toEqual({ event: 'shortcut', command: 'toggleSidebar' })
    expect(msg('{"event":"shortcut","command":"closeTab"}')).toBeNull()
    expect(msg('{"event":"shortcut"}')).toBeNull()
    expect(msg('{"event":"shortcut","command":"toggleSidebar"}', { origin: 'https://app.diagrams.net' })).toBeNull()
  })

  it('ignores another window, another origin, a missing frame, non-strings, junk and unknown events', () => {
    expect(msg('{"event":"init"}', { source: {} })).toBeNull()
    expect(msg('{"event":"init"}', { origin: 'app://yaseen' })).toBeNull()
    expect(msg('{"event":"init"}', { origin: 'https://app.diagrams.net' })).toBeNull()
    expect(readDrawioMessage({ source: null, origin: DRAWIO_ORIGIN, data: '{"event":"init"}' }, null)).toBeNull()
    expect(msg({ event: 'init' })).toBeNull()
    expect(msg('not json')).toBeNull()
    expect(msg('{"event":"exit"}')).toBeNull()
    expect(msg('{"event":"autosave"}')).toBeNull()
    expect(msg('null')).toBeNull()
  })
})
