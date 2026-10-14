/**
 * Excalidraw scene builders for the README demo vault: shapes with their label BOUND inside them,
 * arrows BOUND to the shapes they join, closed polygons, frames with children. Everything is
 * deterministic — an element's `seed` comes from its id — so a board built twice is the same bytes
 * and Version history sees only the shapes a version really changed.
 *
 * Text is measured with the real advance widths of the two fonts used (measured once in the app's
 * own renderer at 100 px), so a label's box is the size the engine would have given it.
 */
import { fracIndex } from '../../lib/seedDemoVault.mjs'

export const INK = '#1e1e1e'
export const MUTED = '#868e96'
/** Excalidraw's own palette: `fill` for a shape, `stroke` for its outline or coloured text, `soft` for a zone behind shapes. */
export const PALETTE = {
  blue: { fill: '#a5d8ff', stroke: '#1971c2', soft: '#e7f5ff' },
  green: { fill: '#b2f2bb', stroke: '#2f9e44', soft: '#ebfbee' },
  yellow: { fill: '#ffec99', stroke: '#f08c00', soft: '#fff9db' },
  red: { fill: '#ffc9c9', stroke: '#e03131', soft: '#fff5f5' },
  violet: { fill: '#d0bfff', stroke: '#6741d9', soft: '#f3f0ff' },
  orange: { fill: '#ffd8a8', stroke: '#e8590c', soft: '#fff4e6' },
  teal: { fill: '#96f2d7', stroke: '#099268', soft: '#e6fcf5' },
  pink: { fill: '#fcc2d7', stroke: '#c2255c', soft: '#fff0f6' },
  gray: { fill: '#e9ecef', stroke: '#495057', soft: '#f8f9fa' },
}

export const HAND = 5 // Excalifont
export const CLEAN = 6 // Nunito

// Advance widths at 100 px, measured with canvas `measureText` in the app's renderer.
const W_HAND = {"0":66.4,"1":42.7,"2":70,"3":60.8,"4":58.5,"5":61.8,"6":64,"7":55.8,"8":63.6,"9":62.9," ":40,"!":31.4,"\"":37.1,"#":78.3,"$":72.1,"%":92.8,"&":71.8,"'":21.8,"(":44.1,")":40.2,"*":52.5,"+":55,",":25.7,"-":41.1,".":27.4,"/":56.1,":":26.4,";":29.8,"<":55,"=":55,">":55,"?":46.6,"@":82.9,"A":67.6,"B":76.1,"C":62.9,"D":78,"E":70.7,"F":66.1,"G":78,"H":57.3,"I":54.5,"J":56.9,"K":61.3,"L":54.3,"M":76.6,"N":63.2,"O":76.7,"P":69.8,"Q":76.8,"R":73.6,"S":62.2,"T":85.7,"U":73,"V":59.2,"W":78.6,"X":62.8,"Y":56.4,"Z":83.2,"[":47.2,"\\":58.9,"]":49.7,"^":51,"_":67,"`":60,"a":57.6,"b":55.5,"c":50.4,"d":60.5,"e":53.7,"f":49.7,"g":55.5,"h":56.7,"i":24.4,"j":32.8,"k":53.3,"l":22.5,"m":66.3,"n":52.6,"o":60,"p":53.7,"q":53.9,"r":41.2,"s":54.3,"t":55.3,"u":54.8,"v":52.5,"w":69.3,"x":59.1,"y":53,"z":57.2,"{":50.4,"|":29.9,"}":54.4,"~":66.9,"—":93.5,"–":70.2,"→":100,"✓":76.4,"·":20,"’":30.4,"“":41.2,"”":42.8,"…":70.9,"×":55}
const W_CLEAN = {"0":60,"1":60,"2":60,"3":60,"4":60,"5":60,"6":60,"7":60,"8":60,"9":60," ":26.1,"!":23.3,"\"":40.5,"#":60,"$":60,"%":93.3,"&":70.1,"'":22.6,"(":32.6,")":32.6,"*":45.1,"+":60,",":23.3,"-":42.7,".":23.3,"/":29,":":23.3,";":23.3,"<":60,"=":60,">":60,"?":44.7,"@":94.7,"A":73.3,"B":67.9,"C":67.5,"D":74.7,"E":58.6,"F":55.1,"G":72.9,"H":76.4,"I":26.2,"J":33.1,"K":63.4,"L":54.8,"M":85.8,"N":74.1,"O":77.1,"P":63.7,"Q":77.1,"R":67.3,"S":61.8,"T":60.7,"U":73.1,"V":69.4,"W":110.4,"X":65.5,"Y":60.1,"Z":59.3,"[":32.4,"\\":29,"]":32.4,"^":60,"_":50,"`":36.1,"a":53.3,"b":58.7,"c":46.5,"d":58.7,"e":53.4,"f":34,"g":59,"h":57.2,"i":23.7,"j":24.1,"k":50.8,"l":30.1,"m":86.1,"n":57.2,"o":56,"p":58.7,"q":58.7,"r":36.5,"s":48.3,"t":35.8,"u":56.5,"v":51.8,"w":84.4,"x":53,"y":51.7,"z":46.6,"{":36.1,"|":27,"}":36.1,"~":60,"—":100,"–":50,"→":100,"✓":76.4,"·":23.3,"’":23.3,"“":40.5,"”":40.5,"…":70,"×":60}

const LINE_HEIGHT = 1.25

/** A text's box at `size` px in `family`. */
export function measure(str, size, family = HAND) {
  const table = family === CLEAN ? W_CLEAN : W_HAND
  const lines = String(str).split('\n')
  const widthOf = (line) => [...line].reduce((sum, ch) => sum + (table[ch] ?? 60), 0) * (size / 100)
  return { width: Math.ceil(Math.max(...lines.map(widthOf))), height: Math.ceil(lines.length * size * LINE_HEIGHT) }
}

/** A stable positive 31-bit number from a string (FNV-1a): an element's `seed` and `versionNonce`. */
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 0) % 2147483646) + 1
}

/**
 * One board being drawn. Elements are kept in the order they were added (the z-order); `elements()`
 * hands them back with their fractional index — from `order`, an id → position map, when a board's
 * versions must agree on every shape's index.
 */
export class Sketch {
  #els = []
  #byId = new Map()
  #frame = null
  /** @param {{ updated?: number, rough?: number, family?: number }} options */
  constructor({ updated = 1, rough = 1, family = HAND } = {}) {
    this.updated = updated
    this.rough = rough
    this.family = family
  }

  #add(id, element) {
    if (this.#byId.has(id)) throw new Error(`duplicate element id: ${id}`)
    const el = {
      id, angle: 0, strokeColor: INK, backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
      roughness: this.rough, opacity: 100, groupIds: [], frameId: this.#frame, roundness: null, seed: hash(id), version: 1,
      versionNonce: hash(`${id}#nonce`), isDeleted: false, boundElements: null, updated: this.updated, link: null, locked: false,
      ...element,
    }
    this.#els.push(el)
    this.#byId.set(id, el)
    return el
  }
  #bind(id, ref) {
    const el = this.#byId.get(id)
    if (el === undefined) throw new Error(`no element ${id} to bind to`)
    el.boundElements = [...(el.boundElements ?? []), ref]
  }

  /**
   * A rectangle, ellipse or diamond. `label` is bound inside it, centred.
   * @param {'rectangle'|'ellipse'|'diamond'} type
   */
  shape(type, id, x, y, width, height, { color, fill, stroke, label, size = 20, textColor = INK, dashed = false, sharp = false, angle = 0, strokeWidth = 2, opacity = 100, rough, family, fillStyle = 'solid' } = {}) {
    const tone = color ? PALETTE[color] : null
    const el = this.#add(id, {
      type, x, y, width, height, angle, strokeWidth, opacity, fillStyle,
      strokeColor: stroke ?? tone?.stroke ?? INK,
      backgroundColor: fill ?? tone?.fill ?? 'transparent',
      strokeStyle: dashed ? 'dashed' : 'solid',
      roundness: type === 'rectangle' && !sharp ? { type: 3 } : type === 'diamond' && !sharp ? { type: 2 } : null,
      ...(rough !== undefined && { roughness: rough }),
    })
    if (label !== undefined) {
      const fam = family ?? this.family
      const box = measure(label, size, fam)
      // A label must sit inside its shape: an ellipse or a diamond has less room than its box.
      const room = type === 'rectangle' ? 1 : type === 'ellipse' ? 0.74 : 0.56
      if (box.width > width * room - 12 || box.height > height * room - 6) throw new Error(`label of ${id} (${box.width}×${box.height}) does not fit its ${type} (${width}×${height})`)
      this.#add(`${id}-label`, {
        type: 'text', x: x + (width - box.width) / 2, y: y + (height - box.height) / 2, ...box, angle, strokeColor: textColor, strokeWidth: 1, roughness: 0,
        text: label, originalText: label, fontSize: size, fontFamily: fam, textAlign: 'center', verticalAlign: 'middle', containerId: id, autoResize: true, lineHeight: LINE_HEIGHT,
      })
      this.#bind(id, { id: `${id}-label`, type: 'text' })
    }
    return el
  }
  rect(id, x, y, w, h, opts) {
    return this.shape('rectangle', id, x, y, w, h, opts)
  }
  ellipse(id, x, y, w, h, opts) {
    return this.shape('ellipse', id, x, y, w, h, opts)
  }
  diamond(id, x, y, w, h, opts) {
    return this.shape('diamond', id, x, y, w, h, opts)
  }

  /** Free text. `anchor` says what `x` is: the text's left edge, its centre or its right edge. */
  text(id, x, y, str, size = 20, { color = INK, anchor = 'left', family, angle = 0, opacity = 100 } = {}) {
    const fam = family ?? this.family
    const box = measure(str, size, fam)
    const left = anchor === 'center' ? x - box.width / 2 : anchor === 'right' ? x - box.width : x
    return this.#add(id, {
      type: 'text', x: left, y, ...box, angle, opacity, strokeColor: color, strokeWidth: 1, roughness: 0, text: str, originalText: str, fontSize: size, fontFamily: fam,
      textAlign: anchor, verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: LINE_HEIGHT,
    })
  }

  /** The point on `side` ('t' 'r' 'b' 'l') of shape `id`, `at` (0…1) along it, `gap` px outside. */
  edge(id, side, at = 0.5, gap = 6) {
    const el = this.#byId.get(id)
    if (el === undefined) throw new Error(`no element ${id}`)
    const { x, y, width: w, height: h } = el
    if (side === 't') return { point: [x + w * at, y - gap], fixed: [at, 0] }
    if (side === 'b') return { point: [x + w * at, y + h + gap], fixed: [at, 1] }
    if (side === 'l') return { point: [x - gap, y + h * at], fixed: [0, at] }
    return { point: [x + w + gap, y + h * at], fixed: [1, at] }
  }

  /**
   * An arrow (or, with `head: null` on both ends, a line) through absolute points. An end given as
   * `{ id, side, at }` starts on that shape's edge and is bound to it; `via` adds bends between.
   */
  arrow(id, from, to, { via = [], color, stroke, label, size = 16, dashed = false, strokeWidth = 2, head = 'arrow', tail = null, curved = true, labelColor, rough } = {}) {
    const end = (spec) => (Array.isArray(spec) ? { point: spec, bind: null } : (() => {
      const { point, fixed } = this.edge(spec.id, spec.side, spec.at ?? 0.5, spec.gap ?? 6)
      return { point, bind: { elementId: spec.id, fixedPoint: fixed, mode: 'orbit' } }
    })())
    const a = end(from)
    const b = end(to)
    const abs = [a.point, ...via, b.point]
    const [ox, oy] = abs[0]
    const points = abs.map(([px, py]) => [px - ox, py - oy])
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const tone = color ? PALETTE[color] : null
    this.#add(id, {
      type: 'arrow', x: ox, y: oy, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points,
      strokeColor: stroke ?? tone?.stroke ?? INK, strokeWidth, strokeStyle: dashed ? 'dashed' : 'solid', roundness: curved ? { type: 2 } : null,
      lastCommittedPoint: null, startBinding: a.bind, endBinding: b.bind, startArrowhead: tail, endArrowhead: head, elbowed: false,
      ...(rough !== undefined && { roughness: rough }),
    })
    if (a.bind) this.#bind(a.bind.elementId, { id, type: 'arrow' })
    if (b.bind) this.#bind(b.bind.elementId, { id, type: 'arrow' })
    if (label !== undefined) {
      const box = measure(label, size, this.family)
      // The label sits on the middle of the arrow's middle segment.
      const i = Math.floor((abs.length - 1) / 2)
      const mid = abs.length % 2 === 1 ? abs[i] : [(abs[i][0] + abs[i + 1][0]) / 2, (abs[i][1] + abs[i + 1][1]) / 2]
      this.#add(`${id}-label`, {
        type: 'text', x: mid[0] - box.width / 2, y: mid[1] - box.height / 2, ...box, strokeColor: labelColor ?? stroke ?? tone?.stroke ?? INK, strokeWidth: 1, roughness: 0,
        text: label, originalText: label, fontSize: size, fontFamily: this.family, textAlign: 'center', verticalAlign: 'middle', containerId: id, autoResize: true, lineHeight: LINE_HEIGHT,
      })
      this.#bind(id, { id: `${id}-label`, type: 'text' })
    }
  }

  /** A line through absolute points; `closed` joins it back to its start so `fill` paints the inside. */
  line(id, pts, { color, fill, stroke, closed = false, dashed = false, strokeWidth = 2, curved = false, opacity = 100, rough } = {}) {
    const abs = closed ? [...pts, pts[0]] : pts
    const [ox, oy] = abs[0]
    const points = abs.map(([px, py]) => [px - ox, py - oy])
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const tone = color ? PALETTE[color] : null
    return this.#add(id, {
      type: 'line', x: ox, y: oy, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points, opacity,
      strokeColor: stroke ?? tone?.stroke ?? INK, backgroundColor: fill ?? (closed ? tone?.fill : undefined) ?? 'transparent', strokeWidth,
      strokeStyle: dashed ? 'dashed' : 'solid', roundness: curved ? { type: 2 } : null, lastCommittedPoint: null, startBinding: null, endBinding: null,
      startArrowhead: null, endArrowhead: null, polygon: closed,
      ...(rough !== undefined && { roughness: rough }),
    })
  }

  /** A frame (a slide, for Present) holding everything `draw` adds; `order` is its place in the deck. */
  frame(id, x, y, width, height, name, order, draw) {
    this.#frame = id
    draw()
    this.#frame = null
    return this.#add(id, { type: 'frame', x, y, width, height, name, roughness: 0, strokeWidth: 2, strokeColor: '#bbb', customData: { presentationOrder: order } })
  }

  /**
   * Air around the drawing. The app opens a board fitted edge to edge to everything on it, toolbar
   * or not, so the board carries its own margin: one locked, invisible rectangle the shape of the
   * capture window's canvas (`view`), sized so the drawing lands inside `inset` — clear of the
   * toolbar above and the zoom buttons below — and never opens past 100%.
   */
  margin({ view = { width: 947, height: 645 }, inset = { top: 100, right: 40, bottom: 78, left: 40 } } = {}) {
    const boxes = this.#els.map((el) => {
      if (!el.points) return [el.x, el.y, el.x + el.width, el.y + el.height]
      const xs = el.points.map((p) => el.x + p[0])
      const ys = el.points.map((p) => el.y + p[1])
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    })
    const [x1, y1, x2, y2] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
    const room = { width: view.width - inset.left - inset.right, height: view.height - inset.top - inset.bottom }
    const zoom = Math.min(room.width / (x2 - x1), room.height / (y2 - y1), 1)
    const el = this.#add('margin', {
      type: 'rectangle', strokeColor: 'transparent', roughness: 0, locked: true,
      x: Math.round(x1 - inset.left / zoom - (room.width / zoom - (x2 - x1)) / 2),
      y: Math.round(y1 - inset.top / zoom - (room.height / zoom - (y2 - y1)) / 2),
      width: Math.round(view.width / zoom), height: Math.round(view.height / zoom),
    })
    // Under everything else.
    this.#els.unshift(this.#els.pop())
    return el
  }

  ids() {
    return this.#els.map((el) => el.id)
  }
  /** The scene's elements, indexed by their position — or by `order`'s, so versions of a board agree. */
  elements(order) {
    return this.#els.map((el, i) => {
      const at = order ? order.get(el.id) : i
      if (at === undefined) throw new Error(`element ${el.id} is missing from the order map`)
      const { id, type, ...rest } = el
      return { id, type, index: fracIndex(at), ...rest }
    })
  }
}
