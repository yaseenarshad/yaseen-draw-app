/**
 * The boards of the README demo vault: what an ordinary person keeps on a whiteboard — a week plan,
 * a soup recipe, a garden, a trip, a roadmap. Everyday content that reads in a second; no real name,
 * no real data. Each function returns a `Sketch` (Excalidraw) or draw.io XML. `roadmap(version)`
 * draws the same board at three moments, so the vault's git history has something to show in
 * Version history.
 */
import { CLEAN, INK, MUTED, PALETTE, Sketch } from './sketch.mjs'

const title = (s, text, sub, x = 0, y = -120) => {
  s.text('title', x, y, text, 40)
  if (sub) s.text('subtitle', x, y + 58, sub, 20, { color: MUTED })
}
/** A sticky note: a filled, rounded rectangle with its text inside. */
const sticky = (s, id, x, y, label, color, { w = 200, h = 96, size = 20, angle = 0 } = {}) =>
  s.rect(id, x, y, w, h, { fill: PALETTE[color].fill, stroke: PALETTE[color].stroke, strokeWidth: 1, label, size, angle })

// ---------------------------------------------------------------- Home / Week plan
const WEEK = { width: 136, gap: 10, top: 62, row: 88, note: 76 }
/** Where a note sits in the week: `day` 0…6, `row` 0…2 — `[x, y, width, height]` on the board. */
export const weekSlot = (day, row) => [day * (WEEK.width + WEEK.gap) + 8, WEEK.top + row * WEEK.row, WEEK.width - 16, WEEK.note]

export function weekPlan() {
  const s = new Sketch()
  title(s, 'Week plan', 'Who is where, and what is for dinner')
  const days = [
    ['Mon', [['Swim\n7:00', 'blue'], ['Pasta night', 'green']]],
    ['Tue', [['Dentist\n15:30', 'violet'], ['Library\nbooks', 'yellow']]],
    ['Wed', [['Football\npractice', 'blue'], ['Soup and\nbread', 'green'], ['Call\nGrandma', 'pink']]],
    ['Thu', [['Piano\nlesson', 'violet']]],
    ['Fri', [['Pizza and\na movie', 'pink'], ['Pack the\nbags', 'yellow']]],
    ['Sat', [['Market\n9:00', 'green'], ['Bike ride', 'blue'], ['Grandma\nvisits', 'pink']]],
    ['Sun', [['Pancakes', 'green']]],
  ]
  days.forEach(([name, notes], d) => {
    const x = d * (WEEK.width + WEEK.gap)
    const weekend = d >= 5
    s.rect(`day${d}-zone`, x, 0, WEEK.width, WEEK.top + 3 * WEEK.row, { fill: weekend ? PALETTE.yellow.soft : PALETTE.gray.soft, stroke: weekend ? PALETTE.yellow.stroke : PALETTE.gray.stroke, dashed: true, strokeWidth: 1 })
    s.rect(`day${d}-head`, x + 8, 8, WEEK.width - 16, 44, { color: weekend ? 'yellow' : 'gray', label: name, size: 22 })
    notes.forEach(([label, color], row) => {
      const [nx, ny, w, h] = weekSlot(d, row)
      sticky(s, `day${d}-note${row}`, nx, ny, label, color, { w, h, size: 18 })
    })
  })
  s.margin()
  return s
}

// ---------------------------------------------------------------- Home / Tomato soup recipe
export function soupRecipe() {
  const s = new Sketch()
  title(s, 'Simple tomato soup', 'Ready in 30 minutes · serves 4')

  // The bowl, from above.
  s.rect('photo', 0, 0, 300, 240, { fill: PALETTE.yellow.soft, stroke: PALETTE.yellow.stroke, strokeWidth: 1 })
  s.ellipse('plate', 36, 44, 228, 156, { fill: '#ffffff', stroke: PALETTE.gray.stroke })
  s.ellipse('soup', 62, 62, 176, 118, { fill: '#ff6b6b', stroke: PALETTE.red.stroke })
  s.ellipse('cream', 96, 82, 70, 30, { fill: '#ffa8a8', stroke: '#ffa8a8', strokeWidth: 1, angle: -0.2 })
  s.ellipse('basil1', 138, 116, 38, 20, { color: 'green', angle: 0.5 })
  s.ellipse('basil2', 164, 128, 34, 18, { color: 'green', angle: -0.4 })

  s.rect('ingredients', 340, 0, 290, 240, { fill: PALETTE.yellow.fill, stroke: PALETTE.yellow.stroke, strokeWidth: 1 })
  s.text('ingredients-head', 364, 16, 'Ingredients', 26)
  s.text('ingredients-list', 364, 62, '6 ripe tomatoes\n1 onion\n2 cloves of garlic\nFresh basil\nSalt and pepper', 22)

  sticky(s, 'tip1', 690, 6, 'Serve with\ngrilled cheese!', 'pink', { w: 230, h: 100, angle: 0.04 })
  sticky(s, 'tip2', 700, 132, 'Freeze the rest\nfor Friday', 'blue', { w: 230, h: 100, angle: -0.03 })

  const steps = [['1. Chop the onion\nand the garlic', 'orange'], ['2. Cook them\nfor 5 minutes', 'yellow'], ['3. Add tomatoes\nand 2 cups water', 'red'], ['4. Cook 20 min,\nthen blend', 'green']]
  steps.forEach(([label, color], i) => s.rect(`step${i}`, i * 245, 300, 205, 100, { color, label, size: 20 }))
  for (let i = 0; i < 3; i++) s.arrow(`next${i}`, { id: `step${i}`, side: 'r' }, { id: `step${i + 1}`, side: 'l' })
  s.margin()
  return s
}

// ---------------------------------------------------------------- Home / Garden layout
export function gardenLayout() {
  const s = new Sketch()
  title(s, 'Garden layout', 'Planting plan for this spring')
  s.rect('lawn', 0, 0, 980, 470, { fill: PALETTE.green.soft, stroke: PALETTE.green.stroke })
  s.line('path', [[290, 165], [578, 165], [578, 430]], { stroke: PALETTE.gray.stroke, strokeWidth: 4, dashed: true })
  s.rect('terrace', 24, 24, 266, 116, { color: 'gray', label: 'Terrace', size: 22 })
  s.rect('tomatoes', 330, 28, 180, 100, { color: 'red', label: 'Tomatoes', size: 20 })
  s.rect('herbs', 540, 28, 180, 100, { color: 'teal', label: 'Herbs', size: 20 })
  s.rect('carrots', 750, 28, 204, 100, { color: 'orange', label: 'Carrots', size: 20 })
  s.ellipse('tree', 50, 240, 170, 170, { color: 'green', label: 'Apple\ntree', size: 20 })
  s.ellipse('pond', 316, 206, 230, 134, { color: 'blue', label: 'Pond', size: 20 })
  s.rect('flowers', 612, 196, 150, 96, { color: 'pink', label: 'Flowers', size: 20 })
  s.rect('berries', 792, 180, 162, 112, { color: 'violet', label: 'Berries', size: 20 })
  s.rect('bench', 330, 384, 170, 54, { color: 'yellow', label: 'Bench', size: 18 })
  s.rect('compost', 612, 344, 150, 96, { color: 'yellow', label: 'Compost', size: 20 })
  s.rect('shed', 792, 330, 162, 112, { color: 'gray', label: 'Shed', size: 20 })
  s.margin()
  return s
}

// ---------------------------------------------------------------- columns of sticky notes
/** A board of columns, each a coloured header over its sticky notes. A note is `[id, text, row]`. */
function columns(s, cols, { width = 250, gap = 40, rows = 4 } = {}) {
  cols.forEach(({ id, name, color, notes }, c) => {
    const x = c * (width + gap)
    s.rect(`${id}-zone`, x, 0, width, 84 + rows * 112, { fill: PALETTE[color].soft, stroke: PALETTE[color].stroke, dashed: true, strokeWidth: 1 })
    s.rect(`${id}-head`, x + 16, 16, width - 32, 52, { color, label: name, size: 24 })
    for (const [noteId, text, row] of notes) sticky(s, noteId, x + 22, 88 + row * 112, text, color, { w: width - 44 })
  })
}

/**
 * Work / Product roadmap at version 1, 2 or 3 (3 = the file on disk). Between versions one note is
 * added (Billing page), one moves to another column (Dark mode) and one is dropped (Offline mode)
 * — one whole example each of what Version history marks green, amber and red. Three rows at most
 * and wide columns: the dialog shows the board as a picture as wide as its pane, and a taller board
 * would be cut at the bottom.
 */
export function roadmap(version = 3) {
  const s = new Sketch()
  title(s, 'Product roadmap', 'What we build, in order')
  const now = [['onboarding', 'Welcome tour', 0], ['search', 'Faster search', 1]]
  const next = [['folders', 'Shared folders', 0]]
  const later = [['api', 'Public API', 0]]
  if (version >= 2) now.push(['billing', 'Billing page', 2])
  if (version >= 3) next.push(['dark', 'Dark mode', 1]) // moved up from "Later"
  else later.push(['offline', 'Offline mode', 1], ['dark', 'Dark mode', 2]) // "Offline mode" is dropped in version 3
  columns(s, [
    { id: 'now', name: 'Now', color: 'green', notes: now },
    { id: 'next', name: 'Next', color: 'blue', notes: next },
    { id: 'later', name: 'Later', color: 'violet', notes: later },
  ], { width: 280, gap: 50, rows: 3 })
  // No margin here: Version history draws the whole board as a picture, and air would shrink it.
  return s
}
/** Every shape the roadmap ever had, in one order, so the three versions agree on each shape's index. */
export function roadmapOrder() {
  const ids = [...new Set([3, 2, 1].flatMap((v) => roadmap(v).ids()))]
  return new Map(ids.map((id, i) => [id, i]))
}

// ---------------------------------------------------------------- Ideas
export function weekendProjects() {
  const s = new Sketch()
  title(s, 'Weekend projects', 'Small jobs around the house')
  columns(s, [
    { id: 'todo', name: 'To do', color: 'orange', notes: [['t1', 'Fix the\nbike brakes', 0], ['t2', 'Paint the\nfence', 1], ['t3', 'Build a\nbird house', 2]] },
    { id: 'doing', name: 'Doing', color: 'blue', notes: [['d1', 'Plant\nthe herbs', 0], ['d2', 'Sort the\nholiday photos', 1]] },
    { id: 'done', name: 'Done', color: 'green', notes: [['f1', 'Clean the\ngutters', 0], ['f2', 'Hang the\nshelves', 1], ['f3', 'Wash the car', 2]] },
  ], { rows: 3 })
  s.margin()
  return s
}

export function birthdayParty() {
  const s = new Sketch()
  title(s, 'Birthday party', 'Everyone adds two ideas', 0, -130)
  s.ellipse('question', 290, 170, 340, 150, { fill: '#ffffff', stroke: INK, strokeWidth: 4, label: 'What makes a great\n8th birthday?', size: 24 })
  const notes = [
    ['hunt', 0, 10, 'Treasure hunt\nin the garden', 'yellow', -0.05],
    ['pizza', 240, -20, 'Build your\nown pizza', 'green', 0.03],
    ['movie', 480, -10, 'Backyard\nmovie night', 'pink', -0.03],
    ['bubbles', 720, 20, 'Giant\nbubbles', 'blue', 0.05],
    ['cake', -10, 195, 'Chocolate cake\nwith 8 candles', 'teal', 0.04],
    ['sleepover', 710, 190, 'Sleepover with\nthree friends', 'orange', -0.04],
    ['balloons', 10, 380, 'Water\nballoons', 'violet', 0.03],
    ['shirts', 250, 400, 'Paint your\nown T-shirt', 'yellow', -0.02],
    ['magic', 490, 390, 'Magic show\nby Grandpa', 'green', 0.04],
    ['games', 730, 370, 'Sack race and\nmusical chairs', 'pink', -0.05],
  ]
  for (const [id, x, y, label, color, angle] of notes) sticky(s, id, x, y, label, color, { w: 200, h: 110, angle })
  // Dot votes: the three ideas that won.
  const votes = { hunt: 3, pizza: 2, sleepover: 2 }
  for (const [id, n] of Object.entries(votes)) {
    const [, x, y] = notes.find((note) => note[0] === id)
    for (let i = 0; i < n; i++) s.ellipse(`${id}-vote${i}`, x + 150 - i * 22, y + 82, 16, 16, { fill: PALETTE.red.stroke, stroke: PALETTE.red.stroke, strokeWidth: 1, rough: 0 })
  }
  s.margin()
  return s
}

/** Where the note goes on the Picnic board: bare canvas right of the drawing — `[x, y]` on the board. */
export const PICNIC_NOTE = [440, 100]
/** The one word the size keys are shown on, and a point on the "Blanket" box. */
export const PICNIC_WORD = [450, 140]
export const PICNIC_BLANKET = [55, 282]
/**
 * Ideas / Picnic: a small drawing with a note beside it, as plain text — `'title'` its first line
 * only (the board in the vault: the hero writes the rest), `'lines'` the five lines the formatting
 * pictures start from, `'word'` the one word the size keys are shown on. The note is in the
 * engine's "Normal" font, where bold reads at a glance. `view` is the canvas the board's margin is
 * cut for (the close-up pictures use a smaller window, and a text's properties bar sits lower than
 * a shape's).
 */
export function picnic({ note = 'title', view } = {}) {
  const s = new Sketch()
  s.text('title', 0, 0, 'Picnic', 40)
  s.text('subtitle', 0, 54, 'Sunday · by the lake', 20, { color: MUTED })
  s.ellipse('lake', 0, 104, 200, 86, { color: 'blue', label: 'Lake', size: 20 })
  s.rect('trunk', 282, 176, 16, 44, { color: 'orange', sharp: true })
  s.ellipse('tree', 240, 90, 100, 100, { color: 'green' })
  s.rect('blanket', 0, 250, 110, 64, { color: 'gray', label: 'Blanket', size: 20 })
  s.rect('basket', 126, 250, 110, 64, { color: 'orange', label: 'Basket', size: 20 })
  s.rect('frisbee', 252, 250, 110, 64, { color: 'pink', label: 'Frisbee', size: 20 })
  s.ellipse('sun', 760, -6, 60, 60, { color: 'yellow' })
  if (note === 'title') s.text('note', ...PICNIC_NOTE, 'Picnic on Sunday', 30, { family: CLEAN })
  if (note === 'lines') s.text('note', ...PICNIC_NOTE, 'Picnic on Sunday\nMeet at 11 by the lake\nBlanket\nLemonade\nFrisbee', 24, { family: CLEAN })
  if (note === 'word') s.text('note', ...PICNIC_WORD, 'Sunny!', 28)
  s.margin(view ? { view, inset: { top: 124, right: 30, bottom: 74, left: 30 } } : undefined)
  return s
}

// ---------------------------------------------------------------- Trips
export function packingList() {
  const s = new Sketch()
  title(s, 'Packing list', 'Lisbon · four days · one small bag each')
  const groups = [
    ['Clothes', 'blue', [['T-shirts × 4', true], ['Light jacket', true], ['Walking shoes', false], ['Swimsuit', false]]],
    ['Bag', 'orange', [['Passports', true], ['Phone charger', true], ['Sun cream', false], ['Guide book', false]]],
    ['Before we go', 'green', [['Water the plants', false], ['Empty the fridge', false], ['Cat to the neighbours', false], ['Lock the bikes', true]]],
  ]
  groups.forEach(([name, color, items], g) => {
    const x = g * 330
    s.rect(`g${g}-zone`, x, 0, 300, 300, { fill: PALETTE[color].soft, stroke: PALETTE[color].stroke, dashed: true, strokeWidth: 1 })
    s.rect(`g${g}-head`, x + 16, 16, 268, 50, { color, label: name, size: 24 })
    items.forEach(([label, done], i) => {
      s.rect(`g${g}-box${i}`, x + 24, 92 + i * 50, 24, 24, { fill: done ? PALETTE.green.stroke : '#ffffff', stroke: done ? PALETTE.green.stroke : INK, sharp: true })
      s.text(`g${g}-item${i}`, x + 62, 90 + i * 50, label, 22, { color: done ? MUTED : INK })
    })
  })
  s.margin()
  return s
}

/** Trips / Trip to Lisbon: five frames — the slides Present steps through. */
export function lisbonTrip() {
  const s = new Sketch()
  const W = 800
  const H = 450
  // Far enough apart that Present shows one slide at a time, with nothing of its neighbours.
  const at = (i) => [(i % 3) * (W + 560), Math.floor(i / 3) * (H + 340)]
  const heading = (id, x, y, text, sub) => {
    s.text(`${id}-heading`, x + 60, y + 44, text, 44)
    if (sub) s.text(`${id}-sub`, x + 60, y + 110, sub, 22, { color: MUTED })
  }
  const move = (x, y, pts) => pts.map(([px, py]) => [x + px, y + py])

  let [x, y] = at(0)
  s.frame('slide-title', x, y, W, H, 'Lisbon', 1, () => {
    s.text('t-name', x + 64, y + 96, 'Lisbon', 104, { color: PALETTE.orange.stroke })
    s.text('t-line', x + 70, y + 250, 'Our four days in May', 30)
    s.text('t-meta', x + 70, y + 312, 'Two grown-ups, two kids, no car', 20, { color: MUTED })
    // The sun over three houses on a hill.
    s.ellipse('t-sun', x + 650, y + 50, 96, 96, { color: 'yellow' })
    const houses = [[500, 240, 'pink'], [585, 200, 'blue'], [670, 262, 'yellow']]
    houses.forEach(([hx, top, color], i) => {
      s.rect(`t-house${i}`, x + hx, y + top, 78, 390 - top, { color, sharp: true })
      s.line(`t-roof${i}`, move(x, y, [[hx - 8, top], [hx + 39, top - 44], [hx + 86, top]]), { color: 'orange', closed: true })
      s.rect(`t-door${i}`, x + hx + 27, y + 346, 24, 44, { color: 'gray', sharp: true })
    })
    s.line('t-ground', move(x, y, [[470, 390], [770, 390]]), { strokeWidth: 2 })
  })

  ;[x, y] = at(1)
  s.frame('slide-day1', x, y, W, H, 'Day 1', 2, () => {
    heading('d1', x, y, 'Day 1 · The old town', 'Slow start. Lots of hills.')
    const notes = [['Tram 28\nup the hill', 'yellow'], ['Castle and\nthe big view', 'orange'], ['Custard tarts\nat 4 pm', 'pink']]
    notes.forEach(([label, color], i) => sticky(s, `d1-note${i}`, x + 60 + i * 235, y + 200, label, color, { w: 205, h: 160, size: 26, angle: [-0.03, 0.02, -0.02][i] }))
  })

  ;[x, y] = at(2)
  s.frame('slide-day2', x, y, W, H, 'Day 2', 3, () => {
    heading('d2', x, y, 'Day 2 · By the river', 'One thing in the morning, one after lunch.')
    const steps = [['Morning\nTile museum', 'blue'], ['Afternoon\nBoat tour', 'teal'], ['Evening\nGrilled fish', 'green']]
    steps.forEach(([label, color], i) => s.rect(`d2-step${i}`, x + 60 + i * 245, y + 210, 190, 130, { color, label, size: 24 }))
    s.arrow('d2-arrow0', { id: 'd2-step0', side: 'r' }, { id: 'd2-step1', side: 'l' })
    s.arrow('d2-arrow1', { id: 'd2-step1', side: 'r' }, { id: 'd2-step2', side: 'l' })
  })

  ;[x, y] = at(3)
  s.frame('slide-day3', x, y, W, H, 'Day 3', 4, () => {
    heading('d3', x, y, 'Day 3 · Day trip to Sintra', 'Train from the main station.')
    const plan = [['Train at 9:10', 'blue'], ['Palace and gardens', 'orange'], ['Back by 6 pm', 'violet']]
    plan.forEach(([label, color], i) => {
      s.ellipse(`d3-dot${i}`, x + 64, y + 190 + i * 74, 36, 36, { color })
      s.text(`d3-item${i}`, x + 122, y + 188 + i * 74, label, 30)
    })
    // A palace on its hill.
    s.ellipse('d3-hill', x + 500, y + 300, 260, 130, { color: 'green' })
    s.rect('d3-wall', x + 560, y + 236, 140, 84, { color: 'yellow', sharp: true })
    s.rect('d3-tower1', x + 548, y + 196, 40, 124, { color: 'yellow', sharp: true })
    s.rect('d3-tower2', x + 672, y + 196, 40, 124, { color: 'yellow', sharp: true })
    s.line('d3-roof1', move(x, y, [[542, 196], [568, 160], [594, 196]]), { color: 'red', closed: true })
    s.line('d3-roof2', move(x, y, [[666, 196], [692, 160], [718, 196]]), { color: 'red', closed: true })
  })

  ;[x, y] = at(4)
  s.frame('slide-budget', x, y, W, H, 'Budget', 5, () => {
    heading('b', x, y, 'What it costs')
    const bars = [['Flights', 150, 'blue'], ['Hotel', 230, 'violet'], ['Food', 130, 'orange'], ['Fun', 70, 'pink']]
    bars.forEach(([name, h, color], i) => {
      s.rect(`b-bar${i}`, x + 90 + i * 100, y + 380 - h, 70, h, { color, sharp: true })
      s.text(`b-name${i}`, x + 125 + i * 100, y + 392, name, 20, { anchor: 'center', color: MUTED })
    })
    s.line('b-axis', move(x, y, [[70, 380], [500, 380]]), { strokeWidth: 2 })
    s.text('b-number', x + 550, y + 170, '1,160', 72, { color: PALETTE.green.stroke })
    s.text('b-caption', x + 554, y + 266, 'euros for all four,\neverything in', 22)
  })
  s.margin()
  return s
}

// ---------------------------------------------------------------- Work / Launch funnel
export function launchFunnel() {
  const s = new Sketch()
  title(s, 'Launch funnel', 'Spring campaign · where people drop off', 0, -140)

  // Where the visitors come from.
  const sources = [['newsletter', 'Newsletter', 'violet'], ['social', 'Social posts', 'pink'], ['partners', 'Partner blogs', 'gray']]
  sources.forEach(([id, label, color], i) => s.rect(id, 60 + i * 230, -40, 180, 60, { color, label, size: 20 }))

  // The funnel: four layers, each narrower than the one above.
  const CX = 380
  const layers = [
    ['visitors', 'Visitors', 'blue', '12,400', 'saw the launch page'],
    ['signups', 'Sign-ups', 'teal', '3,100', 'made an account'],
    ['trials', 'Free trials', 'yellow', '860', 'tried it for a week'],
    ['paying', 'Paying', 'orange', '240', 'paid in month one'],
  ]
  const TOP = 70
  const H = 86
  const GAP = 12
  const widthAt = (i) => 680 - i * 130
  layers.forEach(([id, label, color, count, caption], i) => {
    const y = TOP + i * (H + GAP)
    const [w1, w2] = [widthAt(i), widthAt(i) - 110]
    s.line(id, [[CX - w1 / 2, y], [CX + w1 / 2, y], [CX + w2 / 2, y + H], [CX - w2 / 2, y + H]], { color, closed: true })
    s.text(`${id}-name`, CX, y + 27, label, 26, { anchor: 'center' })
    s.text(`${id}-count`, 800, y + 8, count, 34, { color: PALETTE[color].stroke })
    s.text(`${id}-caption`, 800, y + 54, caption, 18, { color: MUTED })
  })
  sources.forEach(([id], i) => s.arrow(`${id}-in`, { id, side: 'b' }, [CX - 150 + i * 150, TOP - 10], { stroke: MUTED }))

  // The goal under the funnel, and the note someone left beside it.
  s.ellipse('goal', CX - 150, 492, 300, 90, { color: 'green', label: 'Goal: 300 a month', size: 20 })
  s.arrow('to-goal', [CX, TOP + 4 * (H + GAP) - 6], { id: 'goal', side: 't' })
  sticky(s, 'note', 790, 468, 'Biggest drop is\nsign-up → trial.\nFix the first screen!', 'yellow', { w: 260, h: 120, angle: 0.04 })
  s.margin()
  return s
}

// ---------------------------------------------------------------- draw.io diagrams
const esc = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const DIAGRAM_TONES = {
  blue: ['#dae8fc', '#6c8ebf'],
  green: ['#d5e8d4', '#82b366'],
  yellow: ['#fff2cc', '#d6b656'],
  red: ['#f8cecc', '#b85450'],
  violet: ['#e1d5e7', '#9673a6'],
  orange: ['#ffe6cc', '#d79b00'],
  gray: ['#f5f5f5', '#666666'],
}
const FONT = 'fontFamily=Assistant;fontSize=16;fontColor=#1e1e1e;'

/** A draw.io file as the app saves one: plain XML, one endless page (no page view, no grid). */
class Diagram {
  #cells = []
  /** `label` may hold `\n`: draw.io labels are HTML. */
  node(id, label, x, y, w, h, tone, shape = 'box') {
    const [fill, stroke] = DIAGRAM_TONES[tone]
    const form = { box: 'rounded=1;arcSize=16;', pill: 'rounded=1;arcSize=50;', diamond: 'rhombus;' }[shape]
    const style = `${form}whiteSpace=wrap;html=1;strokeWidth=2;fillColor=${fill};strokeColor=${stroke};${FONT}`
    this.#cells.push(`        <mxCell id="${id}" value="${esc(label.replaceAll('\n', '<br>'))}" style="${style}" vertex="1" parent="1">\n          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" />\n        </mxCell>\n`)
    return this
  }
  text(id, label, x, y, w, h, size = 26) {
    this.#cells.push(`        <mxCell id="${id}" value="${esc(label)}" style="text;html=1;align=left;verticalAlign=middle;fontFamily=Assistant;fontSize=${size};fontStyle=1;fontColor=#1e1e1e;" vertex="1" parent="1">\n          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" />\n        </mxCell>\n`)
    return this
  }
  /** `ports` are draw.io's own exit / entry points, e.g. `exitX=0.5;exitY=1;entryX=0.5;entryY=0;`. */
  edge(id, source, target, { label = '', ports = '', dashed = false, tree = false } = {}) {
    const style = `edgeStyle=${tree ? 'elbowEdgeStyle;elbow=vertical' : 'orthogonalEdgeStyle'};rounded=1;html=1;strokeWidth=2;strokeColor=#495057;endArrow=${tree ? 'none' : 'block'};endFill=1;labelBackgroundColor=#ffffff;fontFamily=Assistant;fontSize=14;fontColor=#495057;${dashed ? 'dashed=1;' : ''}${ports}`
    this.#cells.push(`        <mxCell id="${id}" value="${esc(label)}" style="${style}" edge="1" parent="1" source="${source}" target="${target}">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>\n`)
    return this
  }
  xml(name) {
    return `<mxfile host="Yaseen Draw">\n  <diagram id="page-1" name="${esc(name)}">\n    <mxGraphModel grid="0" page="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" pageScale="1" pageWidth="1100" pageHeight="850" math="0" shadow="0">\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n${this.#cells.join('')}      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n`
  }
}

const RIGHT = 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;'
const DOWN = 'exitX=0.5;exitY=1;entryX=0.5;entryY=0;'

/** Work / Sign-up flow: a flowchart, left to right, with the two detours under it. */
export function signUpFlow() {
  const d = new Diagram()
  d.text('title', 'Sign-up flow', 40, 20, 400, 40)
  d.node('open', 'Open the app', 40, 150, 150, 60, 'green', 'pill')
  d.node('form', 'Enter email\nand password', 250, 145, 170, 70, 'blue')
  d.node('used', 'Email\nused before?', 480, 120, 150, 120, 'yellow', 'diamond')
  d.node('send', 'Send a\n6-digit code', 700, 145, 170, 70, 'blue')
  d.node('code', 'Code\ncorrect?', 940, 120, 150, 120, 'yellow', 'diamond')
  d.node('done', 'Welcome!', 1160, 150, 150, 60, 'green', 'pill')
  d.node('signin', 'Offer to\nsign in instead', 470, 330, 170, 70, 'violet')
  d.node('again', 'Send a\nnew code', 930, 330, 170, 70, 'red')
  d.edge('e1', 'open', 'form', { ports: RIGHT })
  d.edge('e2', 'form', 'used', { ports: RIGHT })
  d.edge('e3', 'used', 'send', { label: 'No', ports: RIGHT })
  d.edge('e4', 'send', 'code', { ports: RIGHT })
  d.edge('e5', 'code', 'done', { label: 'Yes', ports: RIGHT })
  d.edge('e6', 'used', 'signin', { label: 'Yes', ports: DOWN })
  d.edge('e7', 'code', 'again', { label: 'No', ports: DOWN })
  d.edge('e8', 'again', 'send', { ports: 'exitX=0;exitY=0.5;entryX=0.5;entryY=1;' })
  return d.xml('Sign-up flow')
}

/** Work / Team: roles only — no names, so no one is invented. */
export function teamChart() {
  const d = new Diagram()
  d.text('title', 'Who does what', 40, 20, 400, 40)
  d.node('lead', 'Founder', 580, 100, 180, 60, 'yellow')
  const teams = [
    ['product', 'Product', 'blue', ['Product designer', 'User researcher']],
    ['engineering', 'Engineering', 'green', ['Mobile developer', 'Backend developer']],
    ['marketing', 'Marketing', 'violet', ['Content writer', 'Community manager']],
  ]
  teams.forEach(([id, name, tone, roles], t) => {
    const x = 160 + t * 420
    d.node(id, name, x, 230, 180, 60, tone)
    d.edge(`${id}-up`, 'lead', id, { tree: true, ports: DOWN })
    roles.forEach((role, r) => {
      const rid = `${id}-role${r}`
      d.node(rid, role, x - 100 + r * 200, 360, 180, 56, 'gray')
      d.edge(`${rid}-up`, id, rid, { tree: true, ports: DOWN })
    })
  })
  return d.xml('Team')
}
