import { describe, expect, it } from 'vitest'
import { TEST_RECORDS } from '../testRecords'
import {
  OPERATORS_BY_TYPE, type OperatorId, type PropertyType, type Rule, countRules, exprToRule, fromGroup, inferType,
  operatorsFor, ruleToExpr, toGroup,
} from './filterRows'
import { canonicalKey } from './keys'

/** Every operator of every type, with a representative value, and the expression it must write (GRO-2135). */
const CASES: { type: PropertyType; property: string; op: OperatorId; value: string | string[]; expr: string }[] = [
  { type: 'text', property: 'note.status', op: 'is', value: 'idea', expr: 'note.status == "idea"' },
  { type: 'text', property: 'note.status', op: 'isNot', value: 'idea', expr: 'note.status != "idea"' },
  { type: 'text', property: 'note.status', op: 'isAnyOf', value: ['idea', 'drafting'], expr: '["idea", "drafting"].contains(note.status)' },
  { type: 'text', property: 'note.status', op: 'isNoneOf', value: ['idea', 'drafting'], expr: '!["idea", "drafting"].contains(note.status)' },
  { type: 'text', property: 'note.status', op: 'contains', value: 'id', expr: 'note.status.contains("id")' },
  { type: 'text', property: 'note.status', op: 'notContains', value: 'id', expr: '!note.status.contains("id")' },
  { type: 'text', property: 'note.status', op: 'startsWith', value: 'i', expr: 'note.status.startsWith("i")' },
  { type: 'text', property: 'note.status', op: 'endsWith', value: 'a', expr: 'note.status.endsWith("a")' },
  { type: 'text', property: 'note.status', op: 'isEmpty', value: '', expr: 'note.status.isEmpty()' },
  { type: 'text', property: 'note.status', op: 'isNotEmpty', value: '', expr: '!note.status.isEmpty()' },
  { type: 'number', property: 'note.priority', op: 'eq', value: '3', expr: 'note.priority == 3' },
  { type: 'number', property: 'note.priority', op: 'ne', value: '3', expr: 'note.priority != 3' },
  { type: 'number', property: 'note.priority', op: 'lt', value: '3', expr: '!note.priority.isEmpty() && note.priority < 3' },
  { type: 'number', property: 'note.priority', op: 'gt', value: '3', expr: '!note.priority.isEmpty() && note.priority > 3' },
  { type: 'number', property: 'note.priority', op: 'le', value: '3', expr: '!note.priority.isEmpty() && note.priority <= 3' },
  { type: 'number', property: 'note.priority', op: 'ge', value: '3', expr: '!note.priority.isEmpty() && note.priority >= 3' },
  { type: 'number', property: 'note.priority', op: 'isEmpty', value: '', expr: 'note.priority.isEmpty()' },
  { type: 'number', property: 'note.priority', op: 'isNotEmpty', value: '', expr: '!note.priority.isEmpty()' },
  { type: 'date', property: 'note.date', op: 'dateIs', value: '2026-08-01', expr: 'note.date == date("2026-08-01")' },
  { type: 'date', property: 'note.date', op: 'dateBefore', value: '2026-08-01', expr: '!note.date.isEmpty() && note.date < date("2026-08-01")' },
  { type: 'date', property: 'note.date', op: 'dateAfter', value: '2026-08-01', expr: '!note.date.isEmpty() && note.date > date("2026-08-01")' },
  { type: 'date', property: 'note.date', op: 'isEmpty', value: '', expr: 'note.date.isEmpty()' },
  { type: 'date', property: 'note.date', op: 'isNotEmpty', value: '', expr: '!note.date.isEmpty()' },
  { type: 'checkbox', property: 'note.published', op: 'checked', value: '', expr: 'note.published == true' },
  { type: 'checkbox', property: 'note.published', op: 'unchecked', value: '', expr: 'note.published == false' },
  { type: 'list', property: 'note.related', op: 'contains', value: 'x', expr: 'note.related.contains("x")' },
  { type: 'list', property: 'note.related', op: 'notContains', value: 'x', expr: '!note.related.contains("x")' },
  { type: 'list', property: 'note.related', op: 'hasAnyOf', value: ['x', 'y'], expr: 'note.related.containsAny("x", "y")' },
  { type: 'list', property: 'note.related', op: 'hasNoneOf', value: ['x', 'y'], expr: '!note.related.containsAny("x", "y")' },
  { type: 'list', property: 'note.related', op: 'hasAllOf', value: ['x', 'y'], expr: 'note.related.containsAll("x", "y")' },
  { type: 'list', property: 'note.related', op: 'isEmpty', value: '', expr: 'note.related.isEmpty()' },
  { type: 'list', property: 'note.related', op: 'isNotEmpty', value: '', expr: '!note.related.isEmpty()' },
  { type: 'tags', property: 'note.tags', op: 'contains', value: 'agentic', expr: 'note.tags.contains("agentic")' },
  { type: 'tags', property: 'note.tags', op: 'notContains', value: 'agentic', expr: '!note.tags.contains("agentic")' },
  { type: 'tags', property: 'note.tags', op: 'hasAnyOf', value: ['agentic', 'paper'], expr: 'note.tags.containsAny("agentic", "paper")' },
  { type: 'tags', property: 'note.tags', op: 'hasNoneOf', value: ['agentic', 'paper'], expr: '!note.tags.containsAny("agentic", "paper")' },
  { type: 'tags', property: 'note.tags', op: 'hasAllOf', value: ['agentic', 'paper'], expr: 'note.tags.containsAll("agentic", "paper")' },
  { type: 'tags', property: 'note.tags', op: 'isEmpty', value: '', expr: 'note.tags.isEmpty()' },
  { type: 'tags', property: 'note.tags', op: 'isNotEmpty', value: '', expr: '!note.tags.isEmpty()' },
  { type: 'link', property: 'note.owner', op: 'is', value: 'Agentic Agency', expr: 'note.owner == "Agentic Agency"' },
  { type: 'link', property: 'note.owner', op: 'isNot', value: 'Agentic Agency', expr: 'note.owner != "Agentic Agency"' },
  { type: 'link', property: 'note.owner', op: 'isAnyOf', value: ['Agentic Agency', 'VSL'], expr: '["Agentic Agency", "VSL"].contains(note.owner)' },
  { type: 'link', property: 'note.owner', op: 'isNoneOf', value: ['Agentic Agency', 'VSL'], expr: '!["Agentic Agency", "VSL"].contains(note.owner)' },
  { type: 'link', property: 'note.owner', op: 'isEmpty', value: '', expr: 'note.owner.isEmpty()' },
  { type: 'link', property: 'note.owner', op: 'isNotEmpty', value: '', expr: '!note.owner.isEmpty()' },
  { type: 'multi-link', property: 'note.people', op: 'contains', value: 'Yasin', expr: 'note.people.contains("Yasin")' },
  { type: 'multi-link', property: 'note.people', op: 'notContains', value: 'Yasin', expr: '!note.people.contains("Yasin")' },
  { type: 'multi-link', property: 'note.people', op: 'hasAnyOf', value: ['Yasin', 'Ada'], expr: 'note.people.containsAny("Yasin", "Ada")' },
  { type: 'multi-link', property: 'note.people', op: 'hasNoneOf', value: ['Yasin', 'Ada'], expr: '!note.people.containsAny("Yasin", "Ada")' },
  { type: 'multi-link', property: 'note.people', op: 'hasAllOf', value: ['Yasin', 'Ada'], expr: 'note.people.containsAll("Yasin", "Ada")' },
  { type: 'multi-link', property: 'note.people', op: 'isEmpty', value: '', expr: 'note.people.isEmpty()' },
  { type: 'multi-link', property: 'note.people', op: 'isNotEmpty', value: '', expr: '!note.people.isEmpty()' },
  { type: 'file', property: 'file.tags', op: 'hasTag', value: 'pillar', expr: 'file.hasTag("pillar")' },
  { type: 'file', property: 'file.folder', op: 'inFolder', value: 'Content Pillars', expr: 'file.inFolder("Content Pillars")' },
  { type: 'file', property: 'file.links', op: 'hasLink', value: 'Agentic Agency', expr: 'file.hasLink("Agentic Agency")' },
  { type: 'file', property: 'file.tags', op: 'hasAnyOf', value: ['pillar', 'vsl'], expr: 'file.tags.containsAny("pillar", "vsl")' },
  { type: 'file', property: 'file.tags', op: 'hasNoneOf', value: ['pillar', 'vsl'], expr: '!file.tags.containsAny("pillar", "vsl")' },
  { type: 'file', property: 'file.tags', op: 'hasAllOf', value: ['pillar', 'vsl'], expr: 'file.tags.containsAll("pillar", "vsl")' },
  { type: 'file', property: 'file.folder', op: 'isAnyOf', value: ['Content Pillars', 'VSL'], expr: '["Content Pillars", "VSL"].contains(file.folder)' },
  { type: 'file', property: 'file.folder', op: 'isNoneOf', value: ['Content Pillars', 'VSL'], expr: '!["Content Pillars", "VSL"].contains(file.folder)' },
  { type: 'select', property: 'note.status', op: 'is', value: 'Ready', expr: 'note.status == "Ready"' },
  { type: 'select', property: 'note.status', op: 'isNot', value: 'Ready', expr: 'note.status != "Ready"' },
  { type: 'select', property: 'note.status', op: 'isAnyOf', value: ['Ready', 'Done'], expr: '["Ready", "Done"].contains(note.status)' },
  { type: 'select', property: 'note.status', op: 'isNoneOf', value: ['Ready', 'Done'], expr: '!["Ready", "Done"].contains(note.status)' },
  { type: 'select', property: 'note.status', op: 'isEmpty', value: '', expr: 'note.status.isEmpty()' },
  { type: 'select', property: 'note.status', op: 'isNotEmpty', value: '', expr: '!note.status.isEmpty()' },
  { type: 'multi-select', property: 'note.labels', op: 'contains', value: 'Ready', expr: 'note.labels.contains("Ready")' },
  { type: 'multi-select', property: 'note.labels', op: 'notContains', value: 'Ready', expr: '!note.labels.contains("Ready")' },
  { type: 'multi-select', property: 'note.labels', op: 'hasAnyOf', value: ['Ready', 'Done'], expr: 'note.labels.containsAny("Ready", "Done")' },
  { type: 'multi-select', property: 'note.labels', op: 'hasNoneOf', value: ['Ready', 'Done'], expr: '!note.labels.containsAny("Ready", "Done")' },
  { type: 'multi-select', property: 'note.labels', op: 'hasAllOf', value: ['Ready', 'Done'], expr: 'note.labels.containsAll("Ready", "Done")' },
  { type: 'multi-select', property: 'note.labels', op: 'isEmpty', value: '', expr: 'note.labels.isEmpty()' },
  { type: 'multi-select', property: 'note.labels', op: 'isNotEmpty', value: '', expr: '!note.labels.isEmpty()' },
]

describe('ruleToExpr / exprToRule round trip (GRO-2135)', () => {
  it.each(CASES)('$type · $op → $expr → back', ({ type, property, op, value, expr }) => {
    const rule: Rule = { property, op, value }
    expect(ruleToExpr(rule)).toBe(expr)
    expect(exprToRule(expr)).toEqual(rule)
    expect(operatorsFor(property, type).map(o => o.id)).toContain(op)
  })

  it('covers every operator listed for every type', () => {
    const covered = new Set(CASES.map(c => `${c.type}:${c.op}`))
    for (const [type, ops] of Object.entries(OPERATORS_BY_TYPE)) {
      if (type === 'file') continue
      for (const op of ops) expect(covered.has(`${type}:${op}`), `${type}:${op}`).toBe(true)
    }
  })

  it('escapes quotes and backslashes in values and reads them back', () => {
    const rule: Rule = { property: 'note.title', op: 'is', value: 'say "hi" \\ now' }
    expect(ruleToExpr(rule)).toBe('note.title == "say \\"hi\\" \\\\ now"')
    expect(exprToRule(ruleToExpr(rule))).toEqual(rule)
  })

  it('a property name that is not an identifier uses note["…"] and reads back canonically', () => {
    const rule: Rule = { property: 'note.my prop', op: 'isEmpty', value: '' }
    expect(ruleToExpr(rule)).toBe('note["my prop"].isEmpty()')
    expect(exprToRule(ruleToExpr(rule))).toEqual(rule)
  })

  it('a bare property and a negative / non-numeric number value', () => {
    expect(ruleToExpr({ property: 'status', op: 'is', value: 'x' })).toBe('note.status == "x"')
    expect(exprToRule('status == "x"')).toEqual({ property: 'note.status', op: 'is', value: 'x' })
    expect(ruleToExpr({ property: 'note.n', op: 'lt', value: '-2' })).toBe('!note.n.isEmpty() && note.n < -2')
    expect(ruleToExpr({ property: 'note.n', op: 'gt', value: 'abc' })).toBe('!note.n.isEmpty() && note.n > 0')
  })

  it('an UNGUARDED ordering comparison (hand-written) still reads back as its rule (D5)', () => {
    expect(exprToRule('note.n < -2')).toEqual({ property: 'note.n', op: 'lt', value: '-2' })
    expect(exprToRule('note.date > date("2026-08-01")')).toEqual({ property: 'note.date', op: 'dateAfter', value: '2026-08-01' })
  })

  it('returns null for expressions the builder cannot show', () => {
    for (const src of [
      'note.a == note.b',
      'note.a == "x" && note.b == "y"',
      'note.a.contains("x", "y")',
      'note.a != true',
      'note.a >= date("2026-01-01")',
      'file.hasTag("a", "b")',
      'this.file.name == "x"',
      'note.a.lower() == "x"',
      '!file.hasTag("x")',
      'note.a ==',
      '',
      // Guard forms that are NOT the one ruleToExpr writes (D5): wrong property, non-ordering right side.
      '!note.a.isEmpty() && note.b < 3',
      '!note.a.isEmpty() && note.a == "x"',
      'note.a.isEmpty() && note.a < 3',
      // Value-list forms outside the D5 grammar (YAZ-1467).
      '[1, "a"].contains(note.status)',
      '["a"].contains("b")',
      '["a"].contains(note.a, note.b)',
      'note.a.containsAny("x", 3)',
      'note.a.containsAll(note.b)',
    ]) expect(exprToRule(src), src).toBeNull()
  })

  it('no picks yet is still a row, not a raw expression (YAZ-1467)', () => {
    const rule: Rule = { property: 'note.status', op: 'isAnyOf', value: [] }
    expect(ruleToExpr(rule)).toBe('[].contains(note.status)')
    expect(exprToRule('[].contains(note.status)')).toEqual(rule)
  })

  it('the value-list operators are offered per type, and never for number / date / checkbox (YAZ-1467)', () => {
    const optionOps: OperatorId[] = ['isAnyOf', 'isNoneOf', 'hasAnyOf', 'hasNoneOf', 'hasAllOf']
    const offered = (type: PropertyType) => OPERATORS_BY_TYPE[type].filter(id => optionOps.includes(id))
    for (const type of ['text', 'link', 'select'] as const) expect(offered(type), type).toEqual(['isAnyOf', 'isNoneOf'])
    for (const type of ['list', 'tags', 'multi-link', 'multi-select'] as const) {
      expect(offered(type), type).toEqual(['hasAnyOf', 'hasNoneOf', 'hasAllOf'])
    }
    for (const type of ['number', 'date', 'checkbox'] as const) expect(offered(type), type).toEqual([])
  })
})

describe('inferType', () => {
  it('reads the first non-empty value across the records, defaulting to text', () => {
    expect(inferType('note.status', TEST_RECORDS)).toBe('text')
    expect(inferType('status', TEST_RECORDS)).toBe('text')
    expect(inferType('note.priority', TEST_RECORDS)).toBe('number')
    expect(inferType('note.published', TEST_RECORDS)).toBe('checkbox')
    expect(inferType('note.date', TEST_RECORDS)).toBe('date')
    expect(inferType('note.tags', TEST_RECORDS)).toBe('tags')
    expect(inferType('note.pillar', TEST_RECORDS)).toBe('text') // VSL-v1 has pillar: null, skipped
    expect(inferType('note.nothing', TEST_RECORDS)).toBe('text')
    expect(inferType('formula.x', TEST_RECORDS)).toBe('text')
  })

  it('file fields by name; file.tags / file.folder / file.links are the file type with their own operator list', () => {
    expect(inferType('file.name', TEST_RECORDS)).toBe('text')
    expect(inferType('file.size', TEST_RECORDS)).toBe('number')
    expect(inferType('file.mtime', TEST_RECORDS)).toBe('date')
    expect(inferType('file.tags', TEST_RECORDS)).toBe('file')
    expect(operatorsFor('file.tags', 'file').map(o => o.id)).toEqual(['hasTag', 'hasAnyOf', 'hasNoneOf', 'hasAllOf'])
    expect(operatorsFor('file.folder', 'file').map(o => o.id)).toEqual(['inFolder', 'isAnyOf', 'isNoneOf'])
    expect(operatorsFor('file.links', 'file').map(o => o.id)).toEqual(['hasLink'])
  })

  it('a non-tags list is list; canonicalKey prefixes bare keys only', () => {
    const records = [{ ...TEST_RECORDS[0], properties: { things: [] } }, { ...TEST_RECORDS[1], properties: { things: ['a'] } }]
    expect(inferType('note.things', records)).toBe('list')
    expect(canonicalKey('x')).toBe('note.x')
    expect(canonicalKey('note.x')).toBe('note.x')
    expect(canonicalKey('file.name')).toBe('file.name')
    expect(canonicalKey('formula.f')).toBe('formula.f')
  })
})

describe('inferType with column typing (D4)', () => {
  it('assigned kind wins over values', () => {
    expect(inferType('note.status', TEST_RECORDS, { assigned: 'date', dominant: 'text' })).toBe('date')
    expect(inferType('note.status', TEST_RECORDS, { assigned: 'link', dominant: null })).toBe('link')
    expect(inferType('note.status', TEST_RECORDS, { assigned: 'multi-link', dominant: null })).toBe('multi-link')
  })

  it('dominant kind fills in when nothing is assigned', () => {
    expect(inferType('note.status', TEST_RECORDS, { assigned: null, dominant: 'number' })).toBe('number')
  })

  it('typing with neither falls back to value sniffing; null typing keeps old behavior', () => {
    expect(inferType('note.status', TEST_RECORDS, { assigned: null, dominant: null })).toBe('text')
    expect(inferType('note.priority', TEST_RECORDS, null)).toBe('number')
  })

  it('the tags property stays the tags pseudo-type even when the ladder says list', () => {
    expect(inferType('note.tags', TEST_RECORDS, { assigned: 'list', dominant: 'list' })).toBe('tags')
    expect(inferType('note.tags', TEST_RECORDS, { assigned: null, dominant: 'list' })).toBe('tags')
  })

  it('file and formula keys ignore typing', () => {
    expect(inferType('file.size', TEST_RECORDS, { assigned: 'text', dominant: null })).toBe('number')
    expect(inferType('formula.x', TEST_RECORDS, { assigned: 'date', dominant: null })).toBe('text')
  })
})

describe('filter groups', () => {
  it('toGroup normalises absent / string / map nodes; fromGroup always writes the map form', () => {
    expect(toGroup(undefined)).toEqual({ conj: 'and', items: [] })
    expect(toGroup('a')).toEqual({ conj: 'and', items: ['a'] })
    expect(toGroup({ or: ['a', 'b'] })).toEqual({ conj: 'or', items: ['a', 'b'] })
    expect(toGroup({ not: ['a'] })).toEqual({ conj: 'not', items: ['a'] })
    expect(fromGroup({ conj: 'and', items: [] })).toBeUndefined()
    expect(fromGroup({ conj: 'not', items: ['a'] })).toEqual({ not: ['a'] })
  })

  it('countRules counts leaves through nesting', () => {
    expect(countRules(undefined)).toBe(0)
    expect(countRules('a')).toBe(1)
    expect(countRules({ and: ['a', { or: ['b', 'c'] }, { not: ['d'] }] })).toBe(4)
  })
})
