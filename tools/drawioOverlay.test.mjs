import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { drawioConfig } from '../client/src/diagrams/drawioProtocol.ts'
import { DRAWIO_TAG } from './packDrawio.mjs'

/**
 * OUR draw.io overlay (🔒 YAZ-1802 D12a / D12b): the scripts parse, `PostConfig.js` behaves, and every
 * draw.io action the host or the overlay names exists in the pinned bundle. PostConfig runs in a
 * `vm` context against a STAND-IN draw.io — the handful of globals and graph calls it touches — so
 * the keymap's rules are pinned without a browser; the real editor is Yasin's feel pass.
 */
const OVERLAY_JS = fileURLToPath(new URL('../desktop/drawio-overlay/js/', import.meta.url))
const APP_MIN_JS = fileURLToPath(new URL(`../desktop/.cache/drawio/${DRAWIO_TAG}/js/app.min.js`, import.meta.url))

/** The globals PostConfig.js patches, each prototype method standing in for draw.io's original. */
function loadPostConfig({ fetchFonts = async () => ({ ok: true, text: async () => '@font-face {}' }) } = {}) {
  const posted = []
  const fontCss = []
  const listeners = []
  function Graph() {}
  Graph.prototype.isZoomWheelEvent = (evt) => evt.ctrlKey === true
  function EditorUi() {}
  EditorUi.prototype.createUi = function () {}
  EditorUi.prototype.installKeyboardShortcuts = function () {}
  function Menus() {}
  Menus.prototype.createPopupMenu = (menu) => menu.items.push('zoomIn', 'zoomOut')
  const env = {
    Graph,
    EditorUi,
    Menus,
    mxSettings: { getSidebarWidth: () => 208 },
    mxEvent: { CELLS_RESIZED: 'cellsResized', isMetaDown: (e) => e.metaKey === true, isAltDown: (e) => e.altKey === true, isShiftDown: (e) => e.shiftKey === true },
    mxConstants: {
      STYLE_SHAPE: 'shape',
      STYLE_FILLCOLOR: 'fillColor',
      STYLE_STROKECOLOR: 'strokeColor',
      STYLE_FONTCOLOR: 'fontColor',
      STYLE_LABEL_BACKGROUNDCOLOR: 'labelBackgroundColor',
      STYLE_IMAGE_BORDER: 'imageBorder',
      STYLE_FONTSIZE: 'fontSize',
      STYLE_FONTSTYLE: 'fontStyle',
      FONT_STRIKETHROUGH: 8,
      DEFAULT_FONTSIZE: 11,
      NONE: 'none',
    },
    Editor: { configureFontCss: (css) => fontCss.push(css) },
    fetch: fetchFonts,
    console: { error: vi.fn() },
    parent: { postMessage: (data, origin) => posted.push({ ...JSON.parse(data), origin }) },
    addEventListener: (type, listener) => listeners.push({ type, listener }),
  }
  env.window = env
  createContext(env)
  runInContext(readFileSync(`${OVERLAY_JS}PostConfig.js`, 'utf8'), env)
  /** A `message` event as the page sees it — from the host (`window.parent`) unless told otherwise; true when a listener stopped it. */
  const message = (data, source = env.parent) => {
    const evt = { data: JSON.stringify(data), source, stopImmediatePropagation: vi.fn() }
    for (const l of listeners) if (l.type === 'message') l.listener(evt)
    return evt.stopImmediatePropagation.mock.calls.length > 0
  }
  return { env, posted, fontCss, message }
}

function geometry(x, y, width, height, relative = false) {
  return { x, y, width, height, relative, clone: () => geometry(x, y, width, height, relative) }
}

/** A cell as the stand-in graph keeps it: the raw style, parsed as `getCellStyle` would hand it over. */
function cell(raw, { label = '', edge = false, children = 0, locked = false, geo = geometry(0, 0, 100, 50) } = {}) {
  const style = Object.fromEntries(raw.split(';').filter((p) => p.includes('=')).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]))
  return { raw, style, label, edge, children, locked, geo }
}

/** One editor: createUi + installKeyboardShortcuts run as draw.io would, on a stand-in graph and key handler. */
function openEditor(env) {
  let selection = []
  const listeners = {}
  const model = {
    isEdge: (c) => c.edge,
    isVertex: (c) => !c.edge,
    getStyle: (c) => c.raw,
    getChildCount: (c) => c.children,
    getGeometry: (c) => c.geo,
    setGeometry: (c, geo) => (c.geo = geo),
    beginUpdate() {},
    endUpdate() {},
  }
  const graph = {
    getModel: () => model,
    getCellStyle: (c) => c.style,
    convertValueToString: (c) => c.label,
    isSelectionEmpty: () => selection.length === 0,
    getSelectionCells: () => selection,
    getEditableCells: (cs) => cs.filter((c) => !c.locked),
    setCellStyles: (key, value, cs) => cs.forEach((c) => (c.style[key] = value)),
    toggleCellStyleFlags: (key, flag) => selection.forEach((c) => (c.style[key] = Number(c.style[key] ?? 0) ^ flag)),
    updateCellSize: vi.fn(),
    addListener: (name, listener) => (listeners[name] = listener),
    refresh: vi.fn(),
  }
  const bold = vi.fn()
  const keyHandler = {
    normalKeys: {},
    controlKeys: { 66: bold },
    controlShiftKeys: {},
    bindControlKey(code, f) {
      this.controlKeys[code] = f
    },
    bindControlShiftKey(code, f) {
      this.controlShiftKeys[code] = f
    },
    isControlDown: (evt) => evt.ctrlKey === true || evt.metaKey === true,
    // draw.io's own rule: a bare A–Z with cells selected is nothing (typing edits the label).
    getFunction(evt) {
      if (evt.keyCode >= 65 && evt.keyCode <= 90 && selection.length > 0 && !evt.shiftKey && !evt.altKey && !this.isControlDown(evt)) return null
      const table = this.isControlDown(evt) ? (evt.shiftKey ? this.controlShiftKeys : this.controlKeys) : this.normalKeys
      return table[evt.keyCode] ?? null
    },
  }
  const ui = { editor: { graph }, keyHandler, hsplitPosition: 208, setAdaptiveColors: vi.fn() }
  env.EditorUi.prototype.createUi.call(ui)
  env.EditorUi.prototype.installKeyboardShortcuts.call(ui)
  return {
    ui,
    bold,
    graph,
    select: (...cs) => (selection = cs),
    /** A keydown as draw.io's handler takes it; true when something was bound to it. */
    press(key, mods = {}) {
      const run = keyHandler.getFunction({ keyCode: key.toUpperCase().charCodeAt(0), ...mods })
      run?.call(keyHandler)
      return run != null
    },
    resized: (cs, previous) => listeners.cellsResized(graph, { getProperty: (name) => ({ cells: cs, previous })[name] }),
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

const RECT = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#1e1e1e;'
const NO_FILL_RECT = 'rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#1e1e1e;'
const TEXT = 'text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;fontSize=20;'
const AI_TITLE = 'rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=none;fontSize=32;'
const EDGE = 'edgeStyle=none;html=1;'
const FREEHAND = 'shape=stencil(eJzt);lineShape=1;strokeColor=#1e1e1e;'
const CLASSIC_FREEHAND = 'shape=stencil(eJzt);fillColor=none;strokeColor=#1e1e1e;'
const IMAGE = 'shape=image;aspect=fixed;image=data:image/png,x;'

describe('the overlay scripts', () => {
  it('every one parses', () => {
    const scripts = readdirSync(OVERLAY_JS).filter((name) => name.endsWith('.js'))
    expect(scripts).toContain('PostConfig.js')
    for (const name of scripts) execFileSync(process.execPath, ['--check', `${OVERLAY_JS}${name}`])
  })
})

describe('PostConfig.js (🔒 YAZ-1802 D12a / D12b), against a stand-in draw.io', () => {
  it('says yaseenReady once the font sheet is in draw.io — and still says it when the sheet will not load', async () => {
    const ok = loadPostConfig()
    await settle()
    expect(ok.fontCss).toEqual(['@font-face {}'])
    expect(ok.posted).toEqual([{ event: 'yaseenReady', origin: '*' }])

    const broken = loadPostConfig({ fetchFonts: async () => Promise.reject(new Error('offline')) })
    await settle()
    expect(broken.posted).toEqual([{ event: 'yaseenReady', origin: '*' }])
  })

  it('opens every diagram with the shapes panel collapsed, and ⌘-wheel zooms like ctrl-wheel', () => {
    const { env } = loadPostConfig()
    const { ui } = openEditor(env)
    expect(ui.hsplitPosition).toBe(0)
    expect(env.mxSettings.getSidebarWidth()).toBeNull()
    expect(env.Graph.prototype.isZoomWheelEvent({ metaKey: true })).toBe(true)
    expect(env.Graph.prototype.isZoomWheelEvent({ ctrlKey: true })).toBe(true)
    expect(env.Graph.prototype.isZoomWheelEvent({})).toBe(false)
  })

  it('ends the EMPTY canvas right-click menu with draw.io’s Grid toggle, and leaves a selection’s menu alone', () => {
    const { env } = loadPostConfig()
    const shape = cell(RECT)
    const editor = openEditor(env)
    const popup = () => {
      const menu = { items: [], addSeparator: () => menu.items.push('-') }
      env.Menus.prototype.createPopupMenu.call({ editorUi: editor.ui, addMenuItems: (m, names) => m.items.push(...names) }, menu, null, {})
      return menu.items
    }
    expect(popup()).toEqual(['zoomIn', 'zoomOut', '-', 'grid'])
    editor.select(shape)
    expect(popup()).toEqual(['zoomIn', 'zoomOut'])
  })

  describe('colour letters, with a selection — the Excalidraw fork’s rule', () => {
    it('fill a shape with the LIGHT shade and, with Shift, stroke it with the dark one — a no-fill rectangle gets filled too', () => {
      const { env } = loadPostConfig()
      const [shape, hollow] = [cell(RECT), cell(NO_FILL_RECT)]
      const editor = openEditor(env)
      editor.select(shape, hollow)
      expect(editor.press('r')).toBe(true)
      expect([shape.style.fillColor, hollow.style.fillColor]).toEqual(['#ffc9c9', '#ffc9c9'])
      editor.press('u', { shiftKey: true })
      expect([shape.style.strokeColor, shape.style.fillColor]).toEqual(['#1971c2', '#ffc9c9'])
    })

    it('give text the dark shade as its font colour and, with Shift, the light shade as its background — text being anything that LOOKS like text', () => {
      const { env } = loadPostConfig()
      const [text, title] = [cell(TEXT, { label: 'Note' }), cell(AI_TITLE, { label: 'Find the bottleneck' })]
      const editor = openEditor(env)
      editor.select(text, title)
      editor.press('g')
      expect([text.style.fontColor, title.style.fontColor]).toEqual(['#2f9e44', '#2f9e44'])
      editor.press('g', { shiftKey: true })
      expect([text.style.labelBackgroundColor, title.style.labelBackgroundColor]).toEqual(['#b2f2bb', '#b2f2bb'])
      expect(title.style.fillColor).toBe('none')
    })

    it('stroke lines and both freehand pens with the dark shade, and border an image — Shift or not', () => {
      const { env } = loadPostConfig()
      const cells = [cell(EDGE, { edge: true }), cell(FREEHAND), cell(CLASSIC_FREEHAND), cell(IMAGE)]
      const editor = openEditor(env)
      editor.select(...cells)
      editor.press('o')
      expect(cells.map((c) => c.style.strokeColor ?? c.style.imageBorder)).toEqual(['#e8590c', '#e8590c', '#e8590c', '#e8590c'])
      editor.press('v', { shiftKey: true })
      expect(cells.map((c) => c.style.strokeColor ?? c.style.imageBorder)).toEqual(['#6741d9', '#6741d9', '#6741d9', '#6741d9'])
      expect(cells[3].style.strokeColor).toBeUndefined()
    })

    it('t, b and w are one value wherever they land', () => {
      const { env } = loadPostConfig()
      const [shape, text] = [cell(RECT), cell(TEXT, { label: 'Note' })]
      const editor = openEditor(env)
      editor.select(shape, text)
      editor.press('t')
      expect([shape.style.fillColor, text.style.fontColor]).toEqual(['none', 'none'])
      editor.press('b')
      expect([shape.style.fillColor, text.style.fontColor]).toEqual(['#1e1e1e', '#1e1e1e'])
      editor.press('w', { shiftKey: true })
      expect([shape.style.strokeColor, text.style.labelBackgroundColor]).toEqual(['#ffffff', '#ffffff'])
    })

    it('leave a locked cell as it is', () => {
      const { env } = loadPostConfig()
      const locked = cell(RECT, { locked: true })
      const editor = openEditor(env)
      editor.select(locked)
      editor.press('r')
      expect(locked.style.fillColor).toBe('#ffffff')
    })
  })

  it('leaves a letter to draw.io with nothing selected (the configure reply’s tools) and with ⌘ or ⌥ held', () => {
    const { env } = loadPostConfig()
    const shape = cell(RECT)
    const editor = openEditor(env)
    editor.ui.keyHandler.normalKeys[82] = vi.fn()
    expect(editor.press('r')).toBe(true)
    expect(editor.ui.keyHandler.normalKeys[82]).toHaveBeenCalledOnce()
    editor.select(shape)
    editor.press('r', { metaKey: true })
    editor.press('r', { altKey: true })
    expect(shape.style.fillColor).toBe('#ffffff')
    // A letter that is no colour starts typing into the label, as draw.io intends.
    expect(editor.press('x')).toBe(false)
  })

  it('1–0 set a text’s font size and give anything else a new long side, aspect and centre kept', () => {
    const { env } = loadPostConfig()
    const text = cell(TEXT, { label: 'Note' })
    const shape = cell(RECT, { geo: geometry(0, 0, 100, 50) })
    const edge = cell(EDGE, { edge: true, geo: geometry(0, 0, 0, 0, true) })
    const editor = openEditor(env)
    editor.select(text, shape, edge)
    editor.press('3')
    expect(text.style.fontSize).toBe(20)
    expect(editor.graph.updateCellSize).toHaveBeenCalledWith(text, true)
    expect(shape.geo).toMatchObject({ x: 2, y: 1, width: 96, height: 48 })
    editor.press('0')
    expect(text.style.fontSize).toBe(128)
    expect(shape.geo).toMatchObject({ x: -462, y: -231, width: 1024, height: 512 })
    expect(edge.geo).toMatchObject({ width: 0, height: 0 })
    expect(editor.press('3', { shiftKey: true })).toBe(false)
  })

  it('⌘⇧X toggles strikethrough', () => {
    const { env } = loadPostConfig()
    const text = cell(TEXT, { label: 'Note' })
    const editor = openEditor(env)
    editor.select(text)
    editor.press('x', { metaKey: true, shiftKey: true })
    expect(text.style.fontStyle).toBe(8)
    editor.press('x', { metaKey: true, shiftKey: true })
    expect(text.style.fontStyle).toBe(0)
  })

  it('⌘B with nothing selected goes up to the host as the app’s sidebar key; with a selection it stays draw.io’s bold', async () => {
    const { env, posted } = loadPostConfig()
    await settle()
    const shape = cell(RECT)
    const editor = openEditor(env)
    editor.press('b', { metaKey: true })
    expect(posted.at(-1)).toEqual({ event: 'shortcut', command: 'toggleSidebar', origin: '*' })
    expect(editor.bold).not.toHaveBeenCalled()
    editor.select(shape)
    editor.press('b', { metaKey: true })
    expect(editor.bold).toHaveBeenCalledOnce()
    expect(posted.filter((m) => m.event === 'shortcut')).toHaveLength(1)
  })

  it('the host’s yaseenAdaptiveColors moves draw.io’s DEFAULT and re-draws — a file’s own value is kept, and draw.io never sees the message (🔒 YAZ-1802 D16)', () => {
    const { env, message } = loadPostConfig()
    const editor = openEditor(env)
    expect(message({ action: 'yaseenAdaptiveColors', value: 'none' })).toBe(true)
    expect(env.Graph.defaultAdaptiveColors).toBe('none')
    expect(editor.ui.setAdaptiveColors).toHaveBeenLastCalledWith('default')
    expect(editor.graph.refresh).toHaveBeenCalledOnce()
    editor.graph.adaptiveColors = 'none'
    message({ action: 'yaseenAdaptiveColors', value: 'auto' })
    expect(env.Graph.defaultAdaptiveColors).toBe('auto')
    expect(editor.ui.setAdaptiveColors).toHaveBeenLastCalledWith('none')
  })

  it('leaves every other message, and the same one from anywhere but the host, to draw.io', () => {
    const { env, message } = loadPostConfig()
    openEditor(env)
    expect(message({ action: 'load', xml: '<mxfile/>' })).toBe(false)
    expect(message({ action: 'yaseenAdaptiveColors', value: 'none' }, {})).toBe(false)
    expect(env.Graph.defaultAdaptiveColors).toBeUndefined()
  })

  it('a corner drag scales a text’s font with its height; a side drag and a shape’s label do not', () => {
    const { env } = loadPostConfig()
    const text = cell(TEXT, { label: 'Note', geo: geometry(0, 0, 200, 60) })
    const shape = cell(RECT, { label: 'Box', geo: geometry(0, 0, 200, 60) })
    const editor = openEditor(env)
    const before = geometry(0, 0, 100, 30)
    editor.resized([text, shape], [before, before])
    expect(text.style.fontSize).toBe(40)
    expect(shape.style.fontSize).toBeUndefined()
    text.geo = geometry(0, 0, 300, 60)
    editor.resized([text], [geometry(0, 0, 200, 60)])
    expect(text.style.fontSize).toBe(40)
  })
})

describe.skipIf(!existsSync(APP_MIN_JS))(`every draw.io action we name exists in the pinned ${DRAWIO_TAG}`, () => {
  it('the configure reply’s keyboard shortcuts, the Grid menu item and the live theme', () => {
    const app = readFileSync(APP_MIN_JS, 'utf8')
    const shortcuts = drawioConfig('adapt').keyboardShortcuts
    const named = [...new Set(shortcuts.map((s) => s.action).filter((a) => a !== null)), 'grid', 'darkMode', 'lightMode']
    for (const action of named) expect(app, action).toMatch(new RegExp(`(addAction|put)\\("${action}"`))
  })
})
