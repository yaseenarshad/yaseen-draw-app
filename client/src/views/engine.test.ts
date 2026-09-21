import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { type ViewSet, type ViewDef, type FilterNode, parseViews } from './viewSchema'
import { type ViewResult, defaultLabel, makeResolver, propertyKeys, propertyLabel, resolverFor, runView } from './engine'
import { type Rule, fromGroup, ruleToExpr } from './view/filterRows'
import { DateValue, ErrorValue, FileValue } from './expr'
import { TEST_RECORDS } from './testRecords'

/** Yasin's real base (also in viewSchema.test.ts): `formula.Untitled` is a dangling sort key. */
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

const yasin = parseViews(YASIN_BASE).def

/** Path order of TEST_RECORDS, by basename. */
const PATH_ORDER = [
  'Agentic Agency', 'The Levels of an Agency', 'Creator Economy', 'The Gold In Your Archive',
  'Attribution', 'Tech & Silicon Valley', 'List of Topics', 'VSL-v1',
]
const AGENTIC = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'

const names = (r: ViewResult): string[] => r.rows.map(row => row.record.basename)
const labels = (r: ViewResult): string[] => r.groups!.map(g => g.label)

/** Runs Yasin's Table view with per-test overrides on the view and the definition. */
function run(view: Partial<ViewDef> = {}, def: Partial<ViewSet> = {}, opts: { thisFile?: string | null } = {}): ViewResult {
  const d: ViewSet = { ...yasin, ...def }
  const v: ViewDef = { ...d.views[0], ...view }
  d.views = [v, ...d.views.slice(1)]
  return runView(d, v, TEST_RECORDS, opts)
}

describe('runView: rows and values (GRO-2133)', () => {
  it("Yasin's Table view → 8 rows with file.name, no groups, no errors", () => {
    const r = run()
    expect(r.rows).toHaveLength(8)
    expect(r.total).toBe(8)
    expect(r.groups).toBe(null)
    expect(r.errors).toEqual([])
    expect(r.rows[0].values).toEqual({ 'file.name': 'Agentic Agency.md' })
    expect(r.rows[0].file).toBeInstanceOf(FileValue)
    expect(r.rows[0].record).toBe(TEST_RECORDS[0])
    expect(r.summaries).toEqual({})
  })

  it('sorting by the dangling formula.Untitled keeps stable path order and reports no error (an unknown formula is an evaluator ErrorValue, not a compile error)', () => {
    const r = run({ order: ['file.name', 'formula.Untitled'] })
    expect(names(r)).toEqual(PATH_ORDER)
    expect(r.errors).toEqual([])
    const cell = r.rows[0].values['formula.Untitled']
    expect(cell).toBeInstanceOf(ErrorValue)
    expect((cell as ErrorValue).message).toMatch(/unknown formula Untitled/)
  })

  it('values: file.*, bare and note.-prefixed properties, formulas; a formula compile error is one EngineError + ErrorValue cells', () => {
    const r = run(
      { order: ['file.name', 'status', 'note.priority', 'formula.ppu', 'formula.bad', 'formula.rel', 'file.nope'], sort: [] },
      { formulas: { ppu: 'priority * 2', bad: '1 +', rel: 'file("Agentic Agency").properties.priority' } },
    )
    const v = r.rows[0].values
    expect(v['file.name']).toBe('Agentic Agency.md')
    expect(v.status).toBe('idea')
    expect(v['note.priority']).toBe(2)
    expect(v['formula.ppu']).toBe(4)
    expect(v['formula.rel']).toBe(2)
    expect(v['formula.bad']).toBeInstanceOf(ErrorValue)
    expect(v['file.nope']).toBeInstanceOf(ErrorValue)
    expect(r.rows[4].values['note.priority']).toBe(null) // Attribution has no frontmatter
    expect(r.rows[0].values.date).toBeUndefined() // not in order
    expect(r.errors).toEqual([{ where: 'formula.bad', message: expect.stringMatching(/./) }])
  })

  it('dates come through fromYaml', () => {
    const r = run({ order: ['date'], sort: [] })
    expect(r.rows[0].values.date).toEqual(new DateValue(new Date(2026, 7, 1).getTime(), false))
  })
})

describe('runView: filters (GRO-2133)', () => {
  it.each<[string, number]>([
    ['file.hasTag("agentic")', 2],
    ['file.hasTag("ads")', 0],
    ['file.hasTag("attribution")', 1],
    ['file.inFolder("Content Pillars/2. Creator Economy")', 2],
    ['file.hasLink("Agentic Agency")', 2],
    ['note.published == true', 1],
    ['published == true', 1],
    ['status == "idea"', 2],
    ['priority >= 2', 2],
    ['file.ext == "md"', 8],
  ])('%s → %i rows', (filter, count) => {
    const r = run({ filters: filter, sort: [] })
    expect(r.rows).toHaveLength(count)
    expect(r.total).toBe(count)
    expect(r.errors).toEqual([])
  })

  it('file.hasLink matches through the resolver: List of Topics and The Levels of an Agency', () => {
    expect(names(run({ filters: 'file.hasLink("Agentic Agency")', sort: [] }))).toEqual(['The Levels of an Agency', 'List of Topics'])
    expect(names(run({ filters: 'file.hasLink("Content Pillars/1. Agentic Agency/Agentic Agency.md")', sort: [] }))).toEqual([
      'The Levels of an Agency', 'List of Topics',
    ])
  })

  it('and / or / not nest; not = none of the children', () => {
    expect(run({ filters: { and: ['file.inFolder("Content Pillars")', { not: ['status == "idea"'] }] }, sort: [] }).rows).toHaveLength(5)
    expect(run({ filters: { or: ['status == "idea"', 'status == "drafting"'] }, sort: [] }).rows).toHaveLength(3)
    expect(run({ filters: { not: ['status == "idea"', 'status == "published"'] }, sort: [] }).rows).toHaveLength(4)
    expect(run({ filters: { and: [{ or: ['status == "idea"', 'status == "published"'] }, 'file.hasProperty("date")'] }, sort: [] }).rows).toHaveLength(2)
    const both = { and: ['file.inFolder("Content Pillars")'], not: ['status == "idea"'] } as unknown as FilterNode
    expect(run({ filters: both, sort: [] }).rows).toHaveLength(5)
  })

  it('a view filter is AND-ed with the base filter', () => {
    const r = run({ filters: 'status == "idea"', sort: [] }, { filters: 'file.inFolder("Content Pillars")' })
    expect(names(r)).toEqual(['Agentic Agency', 'The Gold In Your Archive'])
    expect(run({ sort: [] }, { filters: 'file.inFolder("Content Pillars")' }).rows).toHaveLength(7)
  })

  it('a non-boolean or error result fails the row', () => {
    expect(run({ filters: 'nope()', sort: [] }).rows).toHaveLength(0)
    expect(run({ filters: 'null', sort: [] }).rows).toHaveLength(0)
    expect(run({ filters: '"yes"', sort: [] }).rows).toHaveLength(8)
  })

  it('a compile error excludes every row and is reported once with its path', () => {
    const r = run({ filters: { and: ['1 +', 'file.ext == "md"'] }, sort: [] })
    expect(r.rows).toHaveLength(0)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].where).toBe('views[0].filters[0]')
    expect(r.errors[0].message).toMatch(/./)
    const nested = run({ filters: { or: ['status == "idea"', { not: ['(('] }] }, sort: [] })
    expect(nested.rows).toHaveLength(0)
    expect(nested.errors.map(e => e.where)).toEqual(['views[0].filters[1][0]'])
    const base = run({ sort: [] }, { filters: '1 +' })
    expect(base.rows).toHaveLength(0)
    expect(base.errors.map(e => e.where)).toEqual(['filters'])
    const top = run({ filters: '1 +', sort: [] })
    expect(top.errors.map(e => e.where)).toEqual(['views[0].filters'])
  })

  it('a malformed filter node is an error, not a crash', () => {
    const r = run({ filters: { nope: [] } as unknown as FilterNode, sort: [] })
    expect(r.rows).toHaveLength(0)
    expect(r.errors.map(e => e.where)).toEqual(['views[0].filters'])
  })

  it('`this` is the record at opts.thisFile: backlinks to Agentic Agency', () => {
    const r = run({ filters: 'file.hasLink(this)', sort: [] }, {}, { thisFile: AGENTIC })
    expect(names(r)).toEqual(['The Levels of an Agency', 'List of Topics'])
    expect(run({ filters: 'file.hasLink(this)', sort: [] }, {}, { thisFile: null }).rows).toHaveLength(0)
    expect(run({ filters: 'file.hasLink(this)', sort: [] }, {}, { thisFile: '/vault/nope.md' }).rows).toHaveLength(0)
    expect(run({ filters: 'this.basename == "Agentic Agency"', sort: [] }, {}, { thisFile: AGENTIC }).rows).toHaveLength(8)
  })
})

describe('runView: filters built by the Filter model (YAZ-1225)', () => {
  /** One model-built rule as the whole filter; every case must evaluate error-free. */
  const byRule = (rule: Rule): ViewResult => run({ filters: ruleToExpr(rule), sort: [] })

  it.each<{ rule: Rule; rows: string[] }>([
    { rule: { property: 'note.status', op: 'is', value: 'idea' }, rows: ['Agentic Agency', 'The Gold In Your Archive'] },
    { rule: { property: 'note.status', op: 'contains', value: 'ish' }, rows: ['Creator Economy', 'VSL-v1'] },
    { rule: { property: 'note.status', op: 'isNotEmpty', value: '' }, rows: ['Agentic Agency', 'The Levels of an Agency', 'Creator Economy', 'The Gold In Your Archive', 'VSL-v1'] },
    { rule: { property: 'note.priority', op: 'gt', value: '1' }, rows: ['Agentic Agency', 'Creator Economy'] },
    { rule: { property: 'note.priority', op: 'isEmpty', value: '' }, rows: ['The Gold In Your Archive', 'Attribution', 'Tech & Silicon Valley', 'List of Topics', 'VSL-v1'] },
    // D5 (YAZ-1218): ordering operators carry an emptiness guard, so an undated note never
    // matches `dateBefore` — the Notion/Airtable behavior. `toNumber(null)` is 0 without it.
    { rule: { property: 'note.date', op: 'dateBefore', value: '2026-08-01' }, rows: ['Creator Economy'] },
    { rule: { property: 'note.date', op: 'isNotEmpty', value: '' }, rows: ['Agentic Agency', 'Creator Economy'] },
    { rule: { property: 'note.published', op: 'checked', value: '' }, rows: ['Creator Economy'] },
    { rule: { property: 'note.published', op: 'unchecked', value: '' }, rows: ['Agentic Agency'] },
    // A list `contains` matches whole elements via equals; a scalar value falls to the string method.
    { rule: { property: 'note.tags', op: 'contains', value: 'pillar' }, rows: ['Agentic Agency'] },
    { rule: { property: 'note.tags', op: 'contains', value: 'creator' }, rows: ['The Gold In Your Archive'] },
    // A link value equals its plain target name (the 1B matrix's link `is`).
    { rule: { property: 'note.related', op: 'is', value: 'Agentic Agency' }, rows: ['The Levels of an Agency'] },
    { rule: { property: 'file.tags', op: 'hasTag', value: 'pillar' }, rows: ['Agentic Agency'] },
    { rule: { property: 'file.links', op: 'hasLink', value: 'Agentic Agency' }, rows: ['The Levels of an Agency', 'List of Topics'] },
  ])('$rule.property $rule.op "$rule.value"', ({ rule, rows }) => {
    const r = byRule(rule)
    expect(r.errors).toEqual([])
    expect(names(r)).toEqual(rows)
  })

  it('fromGroup conjunctions narrow through runView: or, and, not', () => {
    const idea = ruleToExpr({ property: 'note.status', op: 'is', value: 'idea' })
    const drafting = ruleToExpr({ property: 'note.status', op: 'is', value: 'drafting' })
    expect(run({ filters: fromGroup({ conj: 'or', items: [idea, drafting] }), sort: [] }).rows).toHaveLength(3)
    expect(run({ filters: fromGroup({ conj: 'and', items: [idea, 'file.inFolder("Content Pillars")'] }), sort: [] }).rows).toHaveLength(2)
    expect(run({ filters: fromGroup({ conj: 'not', items: [idea] }), sort: [] }).rows).toHaveLength(6)
  })

  it('a multi-link list filters by containment through equals (link ↔ string)', () => {
    const records = TEST_RECORDS.map(r =>
      r.basename === 'List of Topics' ? { ...r, properties: { people: ['[[Agentic Agency]]', '[[Yasin]]'] } } : r,
    )
    const v: ViewDef = { ...yasin.views[0], filters: ruleToExpr({ property: 'note.people', op: 'contains', value: 'Yasin' }), sort: [] }
    const d: ViewSet = { ...yasin, views: [v, ...yasin.views.slice(1)] }
    const r = runView(d, v, records, {})
    expect(r.errors).toEqual([])
    expect(names(r)).toEqual(['List of Topics'])
  })
})

describe('runView: sort and limit (GRO-2133)', () => {
  it('date DESC puts the two dated notes first and the rest (nulls) last in path order', () => {
    const r = run({ sort: [{ property: 'date', direction: 'DESC' }] })
    expect(names(r)).toEqual(['Agentic Agency', 'Creator Economy', ...PATH_ORDER.filter(n => n !== 'Agentic Agency' && n !== 'Creator Economy')])
    const asc = run({ sort: [{ property: 'note.date', direction: 'ASC' }] })
    expect(names(asc).slice(0, 2)).toEqual(['Creator Economy', 'Agentic Agency'])
    expect(names(asc).slice(2)).toEqual(PATH_ORDER.filter(n => n !== 'Agentic Agency' && n !== 'Creator Economy'))
  })

  it('numbers numeric, strings natural + case-insensitive, booleans false < true, multi-key priority', () => {
    expect(names(run({ sort: [{ property: 'priority', direction: 'DESC' }] })).slice(0, 3)).toEqual([
      'Creator Economy', 'Agentic Agency', 'The Levels of an Agency',
    ])
    expect(names(run({ sort: [{ property: 'file.name', direction: 'DESC' }] }))).toEqual([...PATH_ORDER].sort((a, b) => b.localeCompare(a, undefined, { sensitivity: 'base' })))
    expect(names(run({ sort: [{ property: 'published', direction: 'ASC' }] })).slice(0, 2)).toEqual(['Agentic Agency', 'Creator Economy'])
    expect(names(run({ sort: [{ property: 'published', direction: 'DESC' }] })).slice(0, 2)).toEqual(['Creator Economy', 'Agentic Agency'])
    // status ASC, then priority DESC inside each status
    expect(names(run({ sort: [{ property: 'status', direction: 'ASC' }, { property: 'priority', direction: 'DESC' }] }))).toEqual([
      'The Levels of an Agency', 'Agentic Agency', 'The Gold In Your Archive', 'Creator Economy', 'VSL-v1',
      'Attribution', 'Tech & Silicon Valley', 'List of Topics',
    ])
  })

  it('natural string order: Note 2 before Note 10', () => {
    const recs = ['Note 10', 'Note 2', 'note 1'].map((b, i) => ({ ...TEST_RECORDS[0], path: `/vault/${i}/${b}.md`, basename: b, name: `${b}.md` }))
    const r = runView({ views: [] }, { type: 'table', name: 'T', sort: [{ property: 'file.basename', direction: 'ASC' }] }, recs, {})
    expect(r.rows.map(x => x.record.basename)).toEqual(['note 1', 'Note 2', 'Note 10'])
  })

  it('limit applies after sort; total is the pre-limit count', () => {
    const r = run({ limit: 3 })
    expect(r.rows).toHaveLength(3)
    expect(r.total).toBe(8)
    expect(names(run({ sort: [{ property: 'date', direction: 'DESC' }], limit: 1 }))).toEqual(['Agentic Agency'])
    expect(run({ filters: 'status == "idea"', limit: 5 }).total).toBe(2)
    expect(run({ limit: 0 }).rows).toHaveLength(8) // 0 / negative / NaN → no limit
  })
})

describe('runView: group by (GRO-2133 D6)', () => {
  it('status ASC → drafting, idea, published, then No value last', () => {
    const r = run({ groupBy: { property: 'status' } })
    expect(labels(r)).toEqual(['drafting', 'idea', 'published', 'No value'])
    expect(r.groups!.map(g => g.key)).toEqual(['drafting', 'idea', 'published', null])
    expect(r.groups![3].rows.map(x => x.record.basename)).toEqual(['Attribution', 'Tech & Silicon Valley', 'List of Topics'])
    expect(r.groups![1].rows.map(x => x.record.basename)).toEqual(['Agentic Agency', 'The Gold In Your Archive'])
    expect(r.rows).toHaveLength(8) // flat rows still returned
  })

  it('priority DESC → 3, 2, 1, No value', () => {
    const r = run({ groupBy: { property: 'note.priority', direction: 'DESC' } })
    expect(labels(r)).toEqual(['3', '2', '1', 'No value'])
    expect(r.groups!.map(g => g.key)).toEqual([3, 2, 1, null])
    expect(r.groups![3].rows).toHaveLength(5)
  })

  it('lists fan out per element (YAZ-671 D1); empty string, empty list and null are No value', () => {
    const r = run({ groupBy: { property: 'tags' } })
    // 'agentic, pillar' fans into 'agentic' and 'pillar' — the row joins each group once, no combination group
    expect(labels(r)).toEqual(['agentic', 'agentic/levels', 'creator', 'pillar', 'No value'])
    expect(r.groups![0].key).toBe('agentic')
    expect(r.groups!.every(g => g.fannedOut)).toBe(true)
    const recs = [
      { ...TEST_RECORDS[0], path: '/vault/a.md', properties: { k: '' } },
      { ...TEST_RECORDS[0], path: '/vault/b.md', properties: { k: [] } },
      { ...TEST_RECORDS[0], path: '/vault/c.md', properties: { k: null } },
      { ...TEST_RECORDS[0], path: '/vault/d.md', properties: { k: 'x' } },
    ]
    const g = runView({ views: [] }, { type: 'table', name: 'T', groupBy: { property: 'k' } }, recs, {})
    expect(labels(g)).toEqual(['x', 'No value'])
    expect(g.groups![1].rows).toHaveLength(3)
    expect(g.groups!.every(x => x.fannedOut)).toBe(false) // no list seen → scalar grouping
  })

  it('fan-out edges: duplicates count once, empty elements drop, an all-empty list is No value', () => {
    const rec = (name: string, k: unknown) => ({ ...TEST_RECORDS[0], path: `/vault/${name}.md`, basename: name, properties: { k } })
    const recs = [
      rec('dup', ['a', 'a']),
      rec('mixed', ['a', null, '']),
      rec('allEmpty', [null, '']),
      rec('two', ['a', 'b']),
    ]
    const g = runView({ views: [] }, { type: 'table', name: 'T', groupBy: { property: 'k' } }, recs, {})
    expect(labels(g)).toEqual(['a', 'b', 'No value'])
    // dup joins 'a' once, not twice; mixed drops its empty elements
    expect(g.groups![0].rows.map(r => r.record.basename)).toEqual(['dup', 'mixed', 'two'])
    expect(g.groups![1].rows.map(r => r.record.basename)).toEqual(['two'])
    expect(g.groups![2].rows.map(r => r.record.basename)).toEqual(['allEmpty'])
  })

  it('a row in two groups is counted in both; the footer stays de-duplicated (YAZ-671 D2)', () => {
    const rec = (name: string, k: unknown) => ({ ...TEST_RECORDS[0], path: `/vault/${name}.md`, basename: name, properties: { k } })
    const recs = [rec('both', ['a', 'b']), rec('onlyA', ['a'])]
    const g = runView(
      { views: [] },
      { type: 'table', name: 'T', groupBy: { property: 'k' }, summaries: { 'file.name': 'Count' } },
      recs,
      {},
    )
    expect(g.groups!.map(x => x.summaries['file.name'])).toEqual([2, 1]) // per group, duplicates included
    expect(g.summaries['file.name']).toBe(2) // footer: each row once
    expect(g.total).toBe(2)
    expect(g.rows).toHaveLength(2)
  })

  it('links fan out per target and group by exact target (YAZ-673 Q1)', () => {
    const rec = (name: string, k: unknown) => ({ ...TEST_RECORDS[0], path: `/vault/${name}.md`, basename: name, properties: { k } })
    const recs = [rec('spans', ['[[Lead Gen]]', '[[Sales]]']), rec('one', ['[[Lead Gen]]'])]
    const g = runView({ views: [] }, { type: 'table', name: 'T', groupBy: { property: 'k' } }, recs, {})
    expect(labels(g)).toEqual(['[[Lead Gen]]', '[[Sales]]'])
    expect(g.groups![0].rows.map(r => r.record.basename)).toEqual(['spans', 'one'])
    expect(g.groups![1].rows.map(r => r.record.basename)).toEqual(['spans'])
  })

  it('groups by a formula and a file field; limit applies before grouping', () => {
    const r = run({ groupBy: { property: 'formula.half' }, limit: 4 }, { formulas: { half: 'if(priority, priority > 1)' } })
    expect(labels(r)).toEqual(['false', 'true', 'No value'])
    expect(r.groups!.reduce((n, g) => n + g.rows.length, 0)).toBe(4)
    expect(run({ groupBy: { property: 'file.folder' } }).groups!.map(g => g.rows.length)).toEqual([1, 2, 2, 1, 1, 1])
  })
})

describe('runView: nested group by (YAZ-745)', () => {
  const rec = (name: string, properties: Record<string, unknown>) =>
    ({ ...TEST_RECORDS[0], path: `/vault/${name}.md`, basename: name, properties }) as IndexRecord
  const T = (groupBy: ViewDef['groupBy'], recs: IndexRecord[], extra: Partial<ViewDef> = {}, def: Partial<ViewSet> = {}, opts: Parameters<typeof runView>[3] = {}) =>
    runView({ views: [], ...def }, { type: 'table', name: 'T', groupBy, ...extra }, recs, opts)

  it('two levels: rows sit under the innermost group; outer rows span the branch', () => {
    const recs = [
      rec('a1', { dept: '1 Lead Gen', proc: '2 Paid' }),
      rec('a2', { dept: '1 Lead Gen', proc: '1 Cross' }),
      rec('a3', { dept: '1 Lead Gen', proc: '2 Paid' }),
      rec('b1', { dept: '2 Nurture', proc: '3 Email' }),
    ]
    const r = T([{ property: 'dept' }, { property: 'proc' }], recs)
    expect(r.groups!.map(g => g.label)).toEqual(['1 Lead Gen', '2 Nurture'])
    const lead = r.groups![0]
    expect(lead.rows.map(x => x.record.basename)).toEqual(['a1', 'a2', 'a3'])
    expect(lead.direct).toEqual([])
    expect(lead.children!.map(c => c.label)).toEqual(['1 Cross', '2 Paid'])
    expect(lead.children![1].rows.map(x => x.record.basename)).toEqual(['a1', 'a3'])
    expect(lead.children![0].children).toBeUndefined() // two levels only
    expect(r.groups![1].children!.map(c => c.label)).toEqual(['3 Email'])
  })

  it('each level has its own direction', () => {
    const recs = [rec('x', { dept: 'A', proc: 'p1' }), rec('y', { dept: 'B', proc: 'p2' }), rec('z', { dept: 'A', proc: 'p2' })]
    const r = T([{ property: 'dept', direction: 'DESC' }, { property: 'proc', direction: 'DESC' }], recs)
    expect(r.groups!.map(g => g.label)).toEqual(['B', 'A'])
    expect(r.groups![1].children!.map(c => c.label)).toEqual(['p2', 'p1'])
  })

  it('an inner value equal to its outer value merges: the row is direct, no child (merge rule)', () => {
    const recs = [rec('solo', { dept: '3 Sales', proc: '3 Sales' }), rec('sub', { dept: '3 Sales', proc: '3.1 Close' })]
    const r = T([{ property: 'dept' }, { property: 'proc' }], recs)
    expect(r.groups!.map(g => g.label)).toEqual(['3 Sales'])
    expect(r.groups![0].direct!.map(x => x.record.basename)).toEqual(['solo'])
    expect(r.groups![0].children!.map(c => c.label)).toEqual(['3.1 Close'])
    expect(r.groups![0].rows).toHaveLength(2)
  })

  it('No value applies per level, last at each level; a No-value outer can still nest', () => {
    const recs = [rec('noInner', { dept: 'A' }), rec('inner', { dept: 'A', proc: 'p' }), rec('noOuter', { proc: 'q' })]
    const r = T([{ property: 'dept' }, { property: 'proc' }], recs)
    expect(r.groups!.map(g => g.label)).toEqual(['A', 'No value'])
    const a = r.groups![0]
    expect(a.children!.map(c => c.label)).toEqual(['p', 'No value'])
    expect(a.children![1].key).toBe(null)
    expect(a.children![1].rows.map(x => x.record.basename)).toEqual(['noInner'])
    const nv = r.groups![1]
    expect(nv.key).toBe(null)
    expect(nv.children!.map(c => c.label)).toEqual(['q'])
  })

  it('the Problems case: a formula outer climbs the linked page parent; parentless merges to a plain top group', () => {
    const fnPage = (name: string, parent: string | null) => rec(name, { parent })
    const problem = (name: string, fn: string) => rec(name, { function: `[[${fn}]]` })
    const pages = [fnPage('1 Lead Gen', null), fnPage('1.2 Paid', '[[1 Lead Gen]]'), fnPage('3 Sales', null)]
    const probs = [problem('p1', '1.2 Paid'), problem('p2', '3 Sales'), problem('p3', '1.2 Paid')]
    const r = runView(
      { views: [], formulas: { top: 'if(function.asFile().properties.parent, function.asFile().properties.parent, function)' } },
      { type: 'table', name: 'T', groupBy: [{ property: 'formula.top' }, { property: 'function' }] },
      probs,
      { resolve: resolverFor([...pages, ...probs]) },
    )
    expect(r.errors).toEqual([])
    expect(r.groups!.map(g => g.label)).toEqual(['[[1 Lead Gen]]', '[[3 Sales]]'])
    expect(r.groups![0].direct).toEqual([])
    expect(r.groups![0].children!.map(c => c.label)).toEqual(['[[1.2 Paid]]'])
    expect(r.groups![0].children![0].rows.map(x => x.record.basename)).toEqual(['p1', 'p3'])
    expect(r.groups![1].direct!.map(x => x.record.basename)).toEqual(['p2'])
    expect(r.groups![1].children).toEqual([])
  })

  it('a list at the inner level fans within the outer; the outer stays deduped (YAZ-671 per level)', () => {
    const recs = [rec('multi', { dept: 'A', proc: ['p1', 'p2'] }), rec('one', { dept: 'A', proc: 'p1' })]
    const r = T([{ property: 'dept' }, { property: 'proc' }], recs)
    const a = r.groups![0]
    expect(a.children!.map(c => c.label)).toEqual(['p1', 'p2'])
    expect(a.children![0].rows.map(x => x.record.basename)).toEqual(['multi', 'one'])
    expect(a.children![1].rows.map(x => x.record.basename)).toEqual(['multi'])
    expect(a.children!.every(c => c.fannedOut)).toBe(true)
    expect(a.fannedOut).toBe(false)
    expect(a.rows).toHaveLength(2)
  })

  it('a list at the outer level fans the whole branch across outers', () => {
    const recs = [rec('span', { dept: ['A', 'B'], proc: 'p' }), rec('only', { dept: 'A', proc: 'p' })]
    const r = T([{ property: 'dept' }, { property: 'proc' }], recs)
    expect(r.groups!.map(g => g.label)).toEqual(['A', 'B'])
    expect(r.groups![0].rows).toHaveLength(2)
    expect(r.groups![1].rows.map(x => x.record.basename)).toEqual(['span'])
    expect(r.groups!.every(g => g.fannedOut)).toBe(true)
    expect(r.groups![1].children![0].rows.map(x => x.record.basename)).toEqual(['span'])
  })

  it('a one-entry list behaves exactly like the single object; flat groups carry no children/direct; an empty list means no grouping', () => {
    const rObj = run({ groupBy: { property: 'status' } })
    const rList = run({ groupBy: [{ property: 'status' }] })
    expect(rList.groups!.map(g => g.label)).toEqual(rObj.groups!.map(g => g.label))
    expect(rObj.groups![0].children).toBeUndefined()
    expect(rObj.groups![0].direct).toBeUndefined()
    expect(rList.groups![0].children).toBeUndefined()
    expect(run({ groupBy: [] }).groups).toBe(null)
  })

  it('summaries: an outer covers every row beneath it, a child covers its own rows', () => {
    const recs = [rec('a', { dept: 'A', proc: 'p1' }), rec('b', { dept: 'A', proc: 'p2' }), rec('c', { dept: 'A' })]
    const r = T([{ property: 'dept' }, { property: 'proc' }], recs, { summaries: { 'file.name': 'Count' } })
    expect(r.groups![0].summaries['file.name']).toBe(3)
    expect(r.groups![0].children!.map(c => c.summaries['file.name'])).toEqual([1, 1, 1])
  })

  it('entries beyond two are ignored in v1', () => {
    const recs = [rec('a', { dept: 'A', proc: 'p', extra: 'x' })]
    const r = T([{ property: 'dept' }, { property: 'proc' }, { property: 'extra' }], recs)
    expect(r.groups![0].children![0].label).toBe('p')
    expect(r.groups![0].children![0].children).toBeUndefined()
  })
})

describe('propertyKeys / propertyLabel (GRO-2133)', () => {
  it('propertyKeys: view.order when set, else file.name + sorted note keys', () => {
    expect(propertyKeys(yasin, yasin.views[0], TEST_RECORDS)).toEqual(['file.name'])
    expect(propertyKeys(yasin, yasin.views[1], TEST_RECORDS)).toEqual([
      'file.name', 'note.cover', 'note.date', 'note.pillar', 'note.priority', 'note.published', 'note.related', 'note.status', 'note.tags', 'note.views',
    ])
    expect(propertyKeys(yasin, yasin.views[1], [])).toEqual(['file.name'])
  })

  it('propertyKeys: a DECLARED column is a column before any member carries it (YAZ-1549)', () => {
    expect(propertyKeys(yasin, yasin.views[1], [], ['status', 'owner'])).toEqual(['file.name', 'note.owner', 'note.status'])
    // seen and declared merge, once each
    expect(propertyKeys(yasin, yasin.views[1], TEST_RECORDS, ['status', 'owner'])).toContain('note.owner')
    expect(propertyKeys(yasin, yasin.views[1], TEST_RECORDS, ['status']).filter((k) => k === 'note.status')).toHaveLength(1)
    // an explicit order still wins
    expect(propertyKeys(yasin, { ...yasin.views[1], order: ['file.name'] }, TEST_RECORDS, ['status'])).toEqual(['file.name'])
  })

  it('propertyLabel: displayName (bare or note.-prefixed key) else the default label (YAZ-1513)', () => {
    const def: ViewSet = { properties: { status: { displayName: 'STATUS' }, 'note.views': { displayName: 'Views' }, 'file.name': { displayName: 'Title' } }, views: [] }
    expect(propertyLabel(def, 'status')).toBe('STATUS')
    expect(propertyLabel(def, 'note.status')).toBe('STATUS')
    expect(propertyLabel(def, 'views')).toBe('Views')
    expect(propertyLabel(def, 'note.views')).toBe('Views')
    expect(propertyLabel(def, 'file.name')).toBe('Title')
    // no displayName: the default label, never the raw key
    expect(propertyLabel(def, 'note.priority')).toBe('Priority')
    expect(propertyLabel(def, 'priority')).toBe('Priority')
    expect(propertyLabel(def, 'formula.x')).toBe('X')
    expect(propertyLabel({ views: [] }, 'note.status')).toBe('Status')
    expect(propertyLabel({ views: [] }, 'file.name')).toBe('Name')
  })

  it('defaultLabel (YAZ-1513/1549): the file-field table, else the last dotted segment in sentence case with _ as spaces', () => {
    expect(defaultLabel('file.name')).toBe('Name')
    // the file fields have their own table (YAZ-1549)
    expect(['file.basename', 'file.path', 'file.folder', 'file.ext', 'file.size', 'file.ctime', 'file.mtime', 'file.tags', 'file.links', 'file.embeds'].map(defaultLabel)).toEqual([
      'Base name', 'Path', 'Folder', 'Extension', 'Size', 'Created', 'Modified', 'Tags', 'Links', 'Embeds',
    ])
    expect(defaultLabel('file.unknown')).toBe('Unknown')
    expect(defaultLabel('note.kpi_category')).toBe('Kpi category')
    expect(defaultLabel('kpi_category')).toBe('Kpi category')
    expect(defaultLabel('note.status')).toBe('Status')
    expect(defaultLabel('formula.score_total')).toBe('Score total')
    // an already-capitalised or non-letter start is left alone
    expect(defaultLabel('note.KPIs')).toBe('KPIs')
    expect(defaultLabel('note.2024_goals')).toBe('2024 goals')
  })
})

describe('makeResolver (GRO-2132)', () => {
  const files = TEST_RECORDS.map(r => new FileValue(r))
  const resolve = makeResolver(files, '/vault')

  it('matches absolute path, root-relative path (± .md, ± leading slash), then basename; case-insensitive', () => {
    expect(resolve(AGENTIC)?.record.basename).toBe('Agentic Agency')
    expect(resolve('Content Pillars/1. Agentic Agency/Agentic Agency')?.record.path).toBe(AGENTIC)
    expect(resolve('Content Pillars/1. Agentic Agency/Agentic Agency.md')?.record.path).toBe(AGENTIC)
    expect(resolve('/Content Pillars/1. Agentic Agency/Agentic Agency.md')?.record.path).toBe(AGENTIC)
    expect(resolve('agentic agency')?.record.path).toBe(AGENTIC)
    expect(resolve('[[Agentic Agency]]')?.record.path).toBe(AGENTIC)
    expect(resolve('Agentic Agency#Heading')?.record.path).toBe(AGENTIC)
    expect(resolve('Agentic Agency|alias')?.record.path).toBe(AGENTIC)
    expect(resolve('VSL-v1')?.record.path).toBe('/vault/VSL-v1.md')
    expect(resolve('levels.png')).toBe(null)
    expect(resolve('Other/Agentic Agency')).toBe(null)
    expect(resolve('')).toBe(null)
  })

  it('duplicate basenames resolve to the shallowest folder; equal depth → first in the given order (GRO-2190)', () => {
    const dup = [
      { ...TEST_RECORDS[0], path: '/vault/b/Dup.md', basename: 'Dup', folder: 'b' },
      { ...TEST_RECORDS[0], path: '/vault/a/Dup.md', basename: 'Dup', folder: 'a' },
    ].map(r => new FileValue(r))
    expect(makeResolver(dup)('Dup')?.record.path).toBe('/vault/b/Dup.md') // equal depth: first given wins
    expect(makeResolver(dup)('a/Dup')?.record.path).toBe('/vault/a/Dup.md') // a path is never ambiguous
    // a shallower LATER file beats a deeper earlier one (Obsidian's shortest-path rule)
    const deep = [
      { ...TEST_RECORDS[0], path: '/vault/a/b/Dup.md', basename: 'Dup', folder: 'a/b' },
      { ...TEST_RECORDS[0], path: '/vault/z/Dup.md', basename: 'Dup', folder: 'z' },
    ].map(r => new FileValue(r))
    expect(makeResolver(deep)('Dup')?.record.path).toBe('/vault/z/Dup.md')
    expect(makeResolver(deep)('a/b/Dup')?.record.path).toBe('/vault/a/b/Dup.md')
    // the vault root is depth 0 and beats any folder
    const withRoot = [
      { ...TEST_RECORDS[0], path: '/vault/a/Dup.md', basename: 'Dup', folder: 'a' },
      { ...TEST_RECORDS[0], path: '/vault/Dup.md', basename: 'Dup', folder: '' },
    ].map(r => new FileValue(r))
    expect(makeResolver(withRoot)('Dup')?.record.path).toBe('/vault/Dup.md')
  })

  it('resolverFor memoizes per records array identity, per root and per alias mode (GRO-2190, GRO-2214)', () => {
    const r1 = resolverFor(TEST_RECORDS, '/vault')
    expect(resolverFor(TEST_RECORDS, '/vault')).toBe(r1)
    expect(resolverFor(TEST_RECORDS)).not.toBe(r1) // another root key → its own resolver
    expect(resolverFor(TEST_RECORDS, '/vault', { aliases: false })).not.toBe(r1) // name-only → its own
    expect(resolverFor([...TEST_RECORDS], '/vault')).not.toBe(r1) // a new snapshot → a fresh resolver
    expect(r1('Agentic Agency')?.record.path).toBe(AGENTIC)
    expect(r1(AGENTIC)?.record.path).toBe(AGENTIC)
  })
})

describe('makeResolver: frontmatter aliases (Links E2, GRO-2214)', () => {
  /** `Costs/Customer Acquisition Cost.md` answers to `CAC`; `Attribution.md` has none. */
  const aliased = (over: Partial<IndexRecord> = {}): IndexRecord => ({
    ...TEST_RECORDS[0],
    path: '/vault/Costs/Customer Acquisition Cost.md',
    name: 'Customer Acquisition Cost.md',
    basename: 'Customer Acquisition Cost',
    folder: 'Costs',
    aliases: ['CAC', 'Acquisition Cost'],
    ...over,
  })
  const resolve = (records: IndexRecord[]) => makeResolver(records.map(r => new FileValue(r)), '/vault')

  it('an alias resolves to its note, case-insensitively, with `[[…]]` / `|alias` / `#heading` stripped', () => {
    const r = resolve([aliased()])
    const path = '/vault/Costs/Customer Acquisition Cost.md'
    expect(r('CAC')?.record.path).toBe(path)
    expect(r('cac')?.record.path).toBe(path)
    expect(r('[[CAC]]')?.record.path).toBe(path)
    expect(r('CAC|shown')?.record.path).toBe(path)
    expect(r('CAC#Heading')?.record.path).toBe(path)
    expect(r('Acquisition Cost')?.record.path).toBe(path)
    expect(r('Customer Acquisition Cost')?.record.path).toBe(path) // the real name still resolves
    expect(r('Costs/CAC')).toBe(null) // an alias is a NAME: it never joins a folder path
  })

  it('a real name ALWAYS beats an alias, whatever their depths', () => {
    const named = { ...TEST_RECORDS[0], path: '/vault/deep/deeper/CAC.md', name: 'CAC.md', basename: 'CAC', folder: 'deep/deeper' }
    // The aliased note sits shallower (Costs/) and comes first — the basename map still wins.
    expect(resolve([aliased(), named])('CAC')?.record.path).toBe('/vault/deep/deeper/CAC.md')
    expect(resolve([named, aliased()])('CAC')?.record.path).toBe('/vault/deep/deeper/CAC.md')
    // …and the root-relative path form of the named note is unaffected too.
    expect(resolve([aliased(), named])('deep/deeper/CAC')?.record.path).toBe('/vault/deep/deeper/CAC.md')
  })

  it('two notes claiming one alias: shallowest wins; equal depth → first in path order', () => {
    const deep = aliased({ path: '/vault/a/b/Deep.md', name: 'Deep.md', basename: 'Deep', folder: 'a/b', aliases: ['CAC'] })
    const shallow = aliased({ path: '/vault/z/Shallow.md', name: 'Shallow.md', basename: 'Shallow', folder: 'z', aliases: ['CAC'] })
    expect(resolve([deep, shallow])('CAC')?.record.path).toBe('/vault/z/Shallow.md') // a later shallower file wins
    const first = aliased({ path: '/vault/a/First.md', name: 'First.md', basename: 'First', folder: 'a', aliases: ['CAC'] })
    const second = aliased({ path: '/vault/b/Second.md', name: 'Second.md', basename: 'Second', folder: 'b', aliases: ['CAC'] })
    expect(resolve([first, second])('CAC')?.record.path).toBe('/vault/a/First.md')
  })

  it('`{ aliases: false }` builds the NAME-ONLY resolver the rename engine probes with', () => {
    const files = [aliased()].map(r => new FileValue(r))
    expect(makeResolver(files, '/vault', { aliases: false })('CAC')).toBe(null)
    expect(makeResolver(files, '/vault', { aliases: false })('Customer Acquisition Cost')?.record.basename).toBe('Customer Acquisition Cost')
  })

  it('aliases reach every resolver consumer for free — `file.hasLink` sees them', () => {
    const hub = { ...TEST_RECORDS[0], path: '/vault/Hub.md', name: 'Hub.md', basename: 'Hub', folder: '', links: ['CAC'] }
    const records = [hub, aliased()]
    // The hub links `[[CAC]]`; asked about the aliased note's REAL name, hasLink compares
    // RESOLVED paths — both sides land on the same note through the fourth map.
    const hasLink = (arg: string): string[] => {
      const view: ViewDef = { type: 'table', name: 'T', filters: `file.hasLink("${arg}")` }
      return names(runView({ views: [view] }, view, records, { root: '/vault' }))
    }
    expect(hasLink('Customer Acquisition Cost')).toEqual(['Hub'])
    expect(hasLink('CAC')).toEqual(['Hub'])
    expect(hasLink('Attribution')).toEqual([])
  })
})


/**
 * The rows a run walks and the snapshot its links resolve against are two different things
 * (🔒 D2, YAZ-819). A caller whose rows ARE the vault never notices, but a folder page's
 * contents pass only the MEMBERS as rows while injecting the whole-vault resolver, so a link
 * cell pointing at a page OUTSIDE the members still resolves.
 */
describe('runView: RunOptions.resolve (🔒 D2, YAZ-819)', () => {
  const view: ViewDef = { type: 'table', name: 'T', order: ['formula.out'] }
  const def: ViewSet = { formulas: { out: 'file("Attribution")' }, views: [view] }
  /** One record out of the eight: "Attribution" is deliberately NOT among them. */
  const members = [TEST_RECORDS[0]]

  it('injected: a target outside the rows resolves through the whole-vault resolver', () => {
    const r = runView(def, view, members, { resolve: resolverFor(TEST_RECORDS, '/vault') })
    const out = r.rows[0].values['formula.out']
    expect(out).toBeInstanceOf(FileValue)
    expect((out as FileValue).record.basename).toBe('Attribution')
  })

  it('omitted: today’s behaviour exactly — the resolver is built from the rows, so the same target misses', () => {
    expect(runView(def, view, members).rows[0].values['formula.out']).toBe(null)
    // …and over the full snapshot the default resolves it, which is every whole-vault caller.
    expect(runView(def, view, TEST_RECORDS).rows[0].values['formula.out']).toBeInstanceOf(FileValue)
  })
})
