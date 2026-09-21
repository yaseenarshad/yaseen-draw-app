import { describe, expect, it } from 'vitest'
import { DateValue, DurationValue, ErrorValue, FileValue, LinkValue, RegexValue, fromYaml, isTruthy, render } from './index'

const rec = {
  path: 'Notes/Foo.md', name: 'Foo.md', basename: 'Foo', folder: 'Notes', ext: 'md', size: 10,
  ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [],
}

describe('fromYaml', () => {
  it('detects wiki links', () => {
    expect(fromYaml('[[Foo]]')).toEqual(new LinkValue('Foo'))
    expect(fromYaml('[[Foo|Display]]')).toEqual(new LinkValue('Foo', 'Display'))
    expect(fromYaml('[[Foo')).toBe('[[Foo')
    expect(fromYaml('see [[Foo]]')).toBe('see [[Foo]]')
  })

  it('detects ISO-ish dates', () => {
    const d = fromYaml('2026-08-21') as DateValue
    expect(d).toBeInstanceOf(DateValue)
    expect(d.hasTime).toBe(false)
    expect(d.ms).toBe(new Date(2026, 7, 21).getTime())

    const t = fromYaml('2026-08-21 14:30') as DateValue
    expect(t.hasTime).toBe(true)
    expect(t.ms).toBe(new Date(2026, 7, 21, 14, 30).getTime())
    expect((fromYaml('2026-08-21T14:30:15') as DateValue).ms).toBe(new Date(2026, 7, 21, 14, 30, 15).getTime())
    expect((fromYaml('2026-08-21T14:30:15Z') as DateValue).ms).toBe(Date.UTC(2026, 7, 21, 14, 30, 15))
    expect(fromYaml('2026-13-01')).toBe('2026-13-01')
    expect(fromYaml('not a date')).toBe('not a date')
  })

  it('converts JS Dates, recurses into arrays and objects, passes the rest through', () => {
    expect(fromYaml(new Date(1000))).toEqual(new DateValue(1000, true))
    expect(fromYaml(['[[A]]', '2026-01-01', 3])).toEqual([new LinkValue('A'), new DateValue(new Date(2026, 0, 1).getTime(), false), 3])
    expect(fromYaml({ a: '[[A]]', n: null })).toEqual({ a: new LinkValue('A'), n: null })
    expect(fromYaml(undefined)).toBe(null)
    expect(fromYaml(true)).toBe(true)
    expect(fromYaml(42)).toBe(42)
  })
})

describe('render', () => {
  it('formats every value kind', () => {
    expect(render('s')).toBe('s')
    expect(render(1.5)).toBe('1.5')
    expect(render(true)).toBe('true')
    expect(render(null)).toBe('')
    expect(render(new DateValue(new Date(2026, 7, 21).getTime(), false))).toBe('2026-08-21')
    expect(render(new DateValue(new Date(2026, 7, 21, 9, 5).getTime(), true))).toBe('2026-08-21 09:05')
    expect(render(new DateValue(new Date(2026, 7, 21, 9, 5, 7).getTime(), true))).toBe('2026-08-21 09:05:07')
    expect(render(new DurationValue(26 * 3600e3 + 90e3))).toBe('1d 2h 1m 30s')
    expect(render(new DurationValue(0))).toBe('0s')
    expect(render(new DurationValue(-3600e3))).toBe('-1h')
    expect(render(new LinkValue('Foo'))).toBe('[[Foo]]')
    expect(render(new LinkValue('Foo', 'Bar'))).toBe('[[Foo|Bar]]')
    expect(render(new FileValue(rec))).toBe('[[Foo]]')
    expect(render(new RegexValue(/a+/g))).toBe('/a+/g')
    expect(render(new ErrorValue('boom'))).toBe('#ERROR: boom')
    expect(render([1, 'a', null, [2, 3]])).toBe('1, a, , 2, 3')
    expect(render({ a: 1 })).toBe('{"a":1}')
  })
})

describe('isTruthy', () => {
  it('matches the documented table', () => {
    for (const v of [null, false, 0, '', [], new ErrorValue('x'), NaN]) expect(isTruthy(v)).toBe(false)
    for (const v of [true, 1, -1, 'a', [0], {}, new DateValue(0, false), new DurationValue(0), new LinkValue('x')]) {
      expect(isTruthy(v)).toBe(true)
    }
  })
})
