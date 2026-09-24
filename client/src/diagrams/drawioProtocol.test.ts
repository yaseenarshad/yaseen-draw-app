import { describe, expect, it } from 'vitest'
import { DRAWIO_ORIGIN, drawioConfig, drawioFrameUrl, readDrawioMessage } from './drawioProtocol'

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

describe('drawioConfig (🔒 YAZ-1802 D3 / D12)', () => {
  it('saves plain XML, page view and grid off, guides off', () => {
    expect(drawioConfig()).toMatchObject({ compressXml: false, defaultPageVisible: false, defaultGridEnabled: false, enablePositionGuides: false, enableDistanceGuides: false, enableSizeGuides: false, zoomWheel: false })
  })

  it('offers our fonts first and draws colours without a #', () => {
    const config = drawioConfig() as { defaultFonts: string[]; presetColors: string[]; defaultColors: string[] }
    expect(config.defaultFonts[0]).toBe('Assistant')
    for (const colour of [...config.presetColors, ...config.defaultColors]) expect(colour).toMatch(/^(none|[0-9A-F]{6})$/)
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
