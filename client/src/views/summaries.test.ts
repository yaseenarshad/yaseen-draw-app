import { describe, expect, it } from 'vitest'
import { runView } from './engine'
import { DateValue, DurationValue, ErrorValue, type Value } from './expr'
import { BUILTIN_SUMMARIES, summarize } from './summaries'
import { TEST_RECORDS } from './testRecords'

const d = (y: number, m: number, day: number) => new DateValue(new Date(y, m - 1, day).getTime(), false)

/** Numbers 4, 1, 2, 5 (mean 3, population variance 2.5) among nulls, strings and an empty string. */
const mixed: Value[] = [4, null, 'x', 1, 2, 5, null, '']
const dates: Value[] = [d(2026, 8, 1), null, d(2026, 7, 15), 'x', d(2026, 8, 3)]
const bools: Value[] = [true, false, true, null, 'x']

describe('built-in summaries (GRO-2134)', () => {
  it('lists the documented kinds', () => {
    expect(BUILTIN_SUMMARIES).toEqual([
      'Count', 'Empty', 'Filled', 'Unique', 'Average', 'Max', 'Median', 'Min', 'Range', 'Stddev', 'Sum', 'Earliest', 'Latest', 'Checked', 'Unchecked',
    ])
  })

  it('Count / Empty / Filled / Unique work on any type', () => {
    expect(summarize('Count', mixed)).toBe(8)
    expect(summarize('Empty', mixed)).toBe(3)
    expect(summarize('Filled', mixed)).toBe(5)
    expect(summarize('Unique', mixed)).toBe(5)
    expect(summarize('Unique', [1, 1, '1', [1], [1], null])).toBe(2)
    expect(summarize('Count', [])).toBe(0)
    expect(summarize('Unique', [])).toBe(0)
  })

  it('number kinds ignore non-numbers and give null when there are none', () => {
    expect(summarize('Sum', mixed)).toBe(12)
    expect(summarize('Average', mixed)).toBe(3)
    expect(summarize('Median', mixed)).toBe(3)
    expect(summarize('Median', [3, 1, 2])).toBe(2)
    expect(summarize('Min', mixed)).toBe(1)
    expect(summarize('Max', mixed)).toBe(5)
    expect(summarize('Range', mixed)).toBe(4)
    expect(summarize('Stddev', mixed)).toBeCloseTo(Math.sqrt(2.5), 10)
    expect(summarize('Stddev', [7])).toBe(0)
    for (const k of ['Sum', 'Average', 'Median', 'Min', 'Max', 'Range', 'Stddev']) {
      expect(summarize(k, ['a', null, true])).toBe(null)
      expect(summarize(k, [])).toBe(null)
    }
  })

  it('Earliest / Latest / Range on dates; Range is a duration', () => {
    expect(summarize('Earliest', dates)).toEqual(d(2026, 7, 15))
    expect(summarize('Latest', dates)).toEqual(d(2026, 8, 3))
    expect(summarize('Range', dates)).toEqual(new DurationValue(d(2026, 8, 3).ms - d(2026, 7, 15).ms))
    expect(summarize('Earliest', [1, 'x'])).toBe(null)
    expect(summarize('Latest', [])).toBe(null)
  })

  it('Checked / Unchecked count booleans only', () => {
    expect(summarize('Checked', bools)).toBe(2)
    expect(summarize('Unchecked', bools)).toBe(1)
    expect(summarize('Checked', [1, 'true', null])).toBe(0)
  })

  it('kind lookup is case-insensitive for built-ins', () => {
    expect(summarize('sum', mixed)).toBe(12)
    expect(summarize('AVERAGE', mixed)).toBe(3)
  })
})

describe('custom summaries (GRO-2134)', () => {
  it('evaluates def.summaries expressions with `values` bound to the column', () => {
    const custom = { Mean2: 'values.mean().round(2)', Total: '"n=" + values.length', Bad: '1 +' }
    expect(summarize('Mean2', [1.234, 2.345], custom)).toBe(1.79)
    expect(summarize('Total', mixed, custom)).toBe('n=8')
    expect(summarize('Mean2', ['a'], custom)).toBe(null)
    const bad = summarize('Bad', mixed, custom)
    expect(bad).toBeInstanceOf(ErrorValue)
    expect((bad as ErrorValue).message).toMatch(/Bad/)
  })

  it('unknown kinds are an ErrorValue', () => {
    const v = summarize('Nope', mixed)
    expect(v).toBeInstanceOf(ErrorValue)
    expect((v as ErrorValue).message).toMatch(/unknown summary kind/)
    expect(summarize('Nope', mixed, { Other: 'values.sum()' })).toBeInstanceOf(ErrorValue)
  })

  it('built-ins win over a custom summary of the same name', () => {
    expect(summarize('Sum', [1, 2], { Sum: 'values.sum() * 10' })).toBe(3)
  })
})

describe('summaries through runView (GRO-2134)', () => {
  const def = {
    summaries: { Pct: '(values.filter(value == "published").length / values.length * 100).round()' },
    views: [
      {
        type: 'table',
        name: 'T',
        order: ['file.name', 'status'],
        groupBy: { property: 'status' },
        summaries: { priority: 'Sum', 'file.name': 'Count', status: 'Pct', date: 'Latest', published: 'Checked' },
      },
    ],
  }

  it('fills result.summaries over all rows and group.summaries per group', () => {
    const r = runView(def, def.views[0], TEST_RECORDS, {})
    expect(r.errors).toEqual([])
    expect(r.summaries).toEqual({ priority: 6, 'file.name': 8, status: 25, date: d(2026, 8, 1), published: 1 })
    const byLabel = Object.fromEntries(r.groups!.map(g => [g.label, g.summaries]))
    expect(byLabel.idea).toEqual({ priority: 2, 'file.name': 2, status: 0, date: d(2026, 8, 1), published: 0 })
    expect(byLabel.drafting).toEqual({ priority: 1, 'file.name': 1, status: 0, date: null, published: 0 })
    expect(byLabel.published).toEqual({ priority: 3, 'file.name': 2, status: 100, date: d(2026, 7, 15), published: 1 })
    expect(byLabel['No value']).toEqual({ priority: null, 'file.name': 3, status: 0, date: null, published: 0 })
  })

  it('summaries run after limit', () => {
    const r = runView(def, { ...def.views[0], groupBy: undefined, limit: 2 }, TEST_RECORDS, {})
    expect(r.groups).toBe(null)
    expect(r.summaries['file.name']).toBe(2)
    expect(r.summaries.priority).toBe(3)
  })
})
