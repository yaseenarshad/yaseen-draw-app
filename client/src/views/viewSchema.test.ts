import { describe, expect, it } from 'vitest'
import { ViewParseError, parseViews, serializeViews, updateViews } from './viewSchema'

/** Yasin's real file, verbatim (trailing newline included). */
const YASIN_BASE = `views:
  - type: table
    name: Table
    order:
      - file.name
    sort:
      - property: formula.Untitled
        direction: ASC
  - type: cards
    name: View
  - type: table
    name: View 2
    indentProperties: false
`

/** A community Obsidian view schema — formulas, nested filters, blank line, columnSize. */
const CHARS_BASE = `formulas:
  img2: file.embeds[0]
  info: race + " " + class + " (" + pronouns.join("/") + ")"

views:
  - type: table
    name: Table
    filters:
      and:
        - file.ext == "md"
        - or:
          - file.folder == "PF2 - Cronos/NPCs"
          - file.folder == "PF2 - Cronos/PCs"
    order:
      - file.name
      - aliases
      - tags
    sort:
      - property: formula.img2
        direction: ASC
    columnSize:
      file.name: 140
      note.aliases: 75
`

/** Comments, unknown keys at both levels, flow sequence, not-filter, properties, summaries. */
const KITCHEN_SINK = `# Top-level comment that must survive
foo: 1
filters:
  and:
    - file.ext == "md"
  not:
    - file.name == "draft"
properties:
  status:
    displayName: Status
    custom: true
summaries:
  price: Sum
views:
  - type: table
    name: Main
    # comment inside a view
    mystery: [1, 2]
    order:
      - file.name
  - type: board
    name: Kanban
    groupBy:
      property: status
      direction: DESC
`

/** Our board extension (4D, GRO-2138): `type: board` + `cardSize` are ours and round-trip untouched. */
const BOARD_SINK = `views:
  - type: board
    name: Kanban
    order:
      - file.name
      - status
    groupBy:
      property: status
    cardSize: small
`

/** Two-level grouping (YAZ-745): `groupBy` as an ordered list — first entry is the outer level. */
const NESTED_SINK = `views:
  - type: table
    name: Nested
    order:
      - file.name
    groupBy:
      - property: departments
        direction: ASC
      - property: process
`

/** Multiset difference of lines: those only in `a` (removed) and only in `b` (added), in order. */
function lineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const la = a.split('\n')
  const lb = b.split('\n')
  const countB = new Map<string, number>()
  for (const l of lb) countB.set(l, (countB.get(l) ?? 0) + 1)
  const countA = new Map<string, number>()
  for (const l of la) countA.set(l, (countA.get(l) ?? 0) + 1)
  const removed = la.filter((l) => (countB.get(l) ?? 0) < (countA.get(l) ?? 0) && countB.set(l, (countB.get(l) ?? 0) + 1))
  const added = lb.filter((l) => (countA.get(l) ?? 0) < (countB.get(l) ?? 0) && countA.set(l, (countA.get(l) ?? 0) + 1))
  return { removed, added }
}

describe('parseViews / serializeViews round-trip', () => {
  it.each([
    ['yasin', YASIN_BASE],
    ['kitchen sink', KITCHEN_SINK],
    ['board', BOARD_SINK],
    ['nested', NESTED_SINK],
  ])('%s fixture serialises byte-for-byte', (_name, text) => {
    expect(serializeViews(parseViews(text))).toBe(text)
  })

  // Known, unavoidable normalisation: `yaml`'s stringifier has ONE global `indentSeq`
  // option, but the community sample mixes both styles — `order:` indents its items by two
  // (indentSeq: true) while `- or:` puts its items flush with the key (indentSeq: false).
  // The library cannot reproduce both in one document, so the two lines under `- or:`
  // gain two spaces. Everything else is byte-identical, the output is idempotent, and
  // the parsed definition is unchanged.
  it('chars fixture: identical except the nested `or:` list is re-indented by yaml', () => {
    const out = serializeViews(parseViews(CHARS_BASE))
    expect(lineDiff(CHARS_BASE, out)).toEqual({
      removed: ['          - file.folder == "PF2 - Cronos/NPCs"', '          - file.folder == "PF2 - Cronos/PCs"'],
      added: ['            - file.folder == "PF2 - Cronos/NPCs"', '            - file.folder == "PF2 - Cronos/PCs"'],
    })
    expect(serializeViews(parseViews(out))).toBe(out)
    expect(parseViews(out).def).toEqual(parseViews(CHARS_BASE).def)
  })
})

describe('parseViews def', () => {
  it('exposes typed view fields', () => {
    const { def } = parseViews(YASIN_BASE)
    expect(def.views).toHaveLength(3)
    expect(def.views[0].sort?.[0].property).toBe('formula.Untitled')
    expect(def.views[0].sort?.[0].direction).toBe('ASC')
    expect(def.views[0].order).toEqual(['file.name'])
    expect(def.views[1].type).toBe('cards')
    expect(def.views[2].indentProperties).toBe(false)
  })

  it('exposes formulas, nested filters and columnSize', () => {
    const { def } = parseViews(CHARS_BASE)
    expect(def.formulas?.img2).toBe('file.embeds[0]')
    expect(def.views[0].filters).toEqual({
      and: ['file.ext == "md"', { or: ['file.folder == "PF2 - Cronos/NPCs"', 'file.folder == "PF2 - Cronos/PCs"'] }],
    })
    expect(def.views[0].columnSize).toEqual({ 'file.name': 140, 'note.aliases': 75 })
  })

  it('our board extension parses as a typed view', () => {
    const { def } = parseViews(BOARD_SINK)
    expect(def.views[0].type).toBe('board')
    expect(def.views[0].cardSize).toBe('small')
    expect(def.views[0].groupBy).toEqual({ property: 'status' })
  })

  it('a two-level groupBy parses as an ordered list (YAZ-745)', () => {
    const { def } = parseViews(NESTED_SINK)
    expect(def.views[0].groupBy).toEqual([{ property: 'departments', direction: 'ASC' }, { property: 'process' }])
  })

  it('keeps unknown keys at the top level and inside views', () => {
    const { def } = parseViews(KITCHEN_SINK)
    expect(def.foo).toBe(1)
    expect(def.views[0].mystery).toEqual([1, 2])
    expect(def.filters).toEqual({ and: ['file.ext == "md"'], not: ['file.name == "draft"'] })
    expect(def.properties?.status.displayName).toBe('Status')
    expect(def.properties?.status.custom).toBe(true)
    expect(def.summaries).toEqual({ price: 'Sum' })
    expect(def.views[1].groupBy).toEqual({ property: 'status', direction: 'DESC' })
  })
})

describe('updateViews', () => {
  it('renaming a view changes only that line; comments and unknown keys survive', () => {
    const before = parseViews(KITCHEN_SINK)
    const after = updateViews(before, (def) => {
      def.views[0].name = 'Renamed'
    })
    expect(after.def.views[0].name).toBe('Renamed')
    expect(after.def.foo).toBe(1)
    expect(before.def.views[0].name).toBe('Main') // input def untouched
    const out = serializeViews(after)
    expect(lineDiff(KITCHEN_SINK, out)).toEqual({ removed: ['    name: Main'], added: ['    name: Renamed'] })
    expect(out).toContain('# Top-level comment that must survive')
    expect(out).toContain('    # comment inside a view')
    expect(out).toContain('    mystery: [1, 2]')
  })

  it('adding limit to a view inserts exactly one line', () => {
    const after = updateViews(parseViews(YASIN_BASE), (def) => {
      def.views[0].limit = 10
    })
    const out = serializeViews(after)
    expect(lineDiff(YASIN_BASE, out)).toEqual({ removed: [], added: ['    limit: 10'] })
    expect(out.split('\n')).toHaveLength(YASIN_BASE.split('\n').length + 1)
  })

  it('deleting a key removes its line', () => {
    const after = updateViews(parseViews(YASIN_BASE), (def) => {
      delete def.views[2].indentProperties
    })
    expect(lineDiff(YASIN_BASE, serializeViews(after))).toEqual({ removed: ['    indentProperties: false'], added: [] })
  })

  it('switching groupBy between object and list forms round-trips cleanly (YAZ-745)', () => {
    const after = updateViews(parseViews(KITCHEN_SINK), (def) => {
      def.views[1].groupBy = [{ property: 'status', direction: 'DESC' }, { property: 'priority' }]
    })
    const out = serializeViews(after)
    expect(parseViews(out).def.views[1].groupBy).toEqual([{ property: 'status', direction: 'DESC' }, { property: 'priority' }])
    expect(serializeViews(parseViews(out))).toBe(out)
    expect(out).toContain('# Top-level comment that must survive')
  })

  it('an array that changed length is replaced as a whole', () => {
    const after = updateViews(parseViews(YASIN_BASE), (def) => {
      def.views[0].order = ['file.name', 'tags']
    })
    const out = serializeViews(after)
    expect(after.def.views[0].order).toEqual(['file.name', 'tags'])
    expect(lineDiff(YASIN_BASE, out)).toEqual({ removed: [], added: ['      - tags'] })
    expect(serializeViews(parseViews(out))).toBe(out)
  })
})

describe('parse errors', () => {
  it('invalid YAML → ViewParseError with a line number', () => {
    const bad = 'views:\n  - type: table\n    name: [unclosed\n'
    expect(() => parseViews(bad)).toThrow(ViewParseError)
    try {
      parseViews(bad)
    } catch (e) {
      expect(e).toBeInstanceOf(ViewParseError)
      expect(typeof (e as ViewParseError).line).toBe('number')
    }
  })

  it('views: 3 → ViewParseError mentioning views', () => {
    expect(() => parseViews('views: 3\n')).toThrow(/views/)
    expect(() => parseViews('views: 3\n')).toThrow(ViewParseError)
  })

  it('a view without a string type/name → ViewParseError', () => {
    expect(() => parseViews('views:\n  - name: X\n')).toThrow(ViewParseError)
    expect(() => parseViews('views:\n  - type: table\n')).toThrow(ViewParseError)
    expect(() => parseViews('views:\n  - table\n')).toThrow(ViewParseError)
  })

  it('empty string → ViewParseError (Obsidian requires views)', () => {
    expect(() => parseViews('')).toThrow(ViewParseError)
    expect(() => parseViews('')).toThrow(/views/)
  })

  it('a non-map root → ViewParseError', () => {
    expect(() => parseViews('- a\n- b\n')).toThrow(ViewParseError)
  })
})
