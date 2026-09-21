import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluate } from './evaluator'
import { parse } from './parser'
import { DateValue, DurationValue, ErrorValue, FileValue, type FileRecordLike, LinkValue, type Scope, type Value } from './values'

const record: FileRecordLike = {
  path: 'Required Reading/Textbook Notes.md',
  name: 'Textbook Notes.md',
  basename: 'Textbook Notes',
  folder: 'Required Reading',
  ext: 'md',
  size: 1234,
  ctime: new Date(2026, 0, 1).getTime(),
  mtime: new Date(2026, 7, 1, 12).getTime(),
  properties: { status: 'todo', tags: ['School/Math', 'book'] },
  aliases: [],
  tags: ['School/Math', 'book'],
  links: ['Textbook', 'People/Alice'],
  embeds: ['cover.png'],
}

function scope(note: Record<string, unknown> = {}, extra: Partial<Scope> = {}): Scope {
  return { note, file: new FileValue(record), formulas: {}, this: null, ...extra }
}

const ev = (src: string, s: Scope = scope()): Value => evaluate(parse(src), s)
const err = (v: Value): string => {
  expect(v).toBeInstanceOf(ErrorValue)
  return (v as ErrorValue).message
}

describe('literals and scope', () => {
  it('evaluates literals', () => {
    expect(ev('42')).toBe(42)
    expect(ev('"s"')).toBe('s')
    expect(ev('true')).toBe(true)
    expect(ev('null')).toBe(null)
    expect(ev('[1, "a"]')).toEqual([1, 'a'])
    expect(ev('{"a": 1, b: [2]}')).toEqual({ a: 1, b: [2] })
  })

  it('bare identifiers and note.x read frontmatter through fromYaml', () => {
    const s = scope({ price: 12.5, author: '[[Alice]]', due: '2026-08-01' })
    expect(ev('price', s)).toBe(12.5)
    expect(ev('note.price', s)).toBe(12.5)
    expect(ev('author', s)).toEqual(new LinkValue('Alice'))
    expect(ev('due', s)).toBeInstanceOf(DateValue)
    expect(ev('note["price"]', s)).toBe(12.5)
  })

  it('missing property is null, not an error', () => {
    expect(ev('missing')).toBe(null)
    expect(ev('note.missing')).toBe(null)
    expect(ev('missing.isEmpty()')).toBe(true)
    expect(ev('missing.length')).toBe(null)
    expect(ev('missing[0]')).toBe(null)
    expect(ev('missing.lower()')).toBe(null)
  })

  it('file fields', () => {
    expect(ev('file.name')).toBe('Textbook Notes.md')
    expect(ev('file.basename')).toBe('Textbook Notes')
    expect(ev('file.path')).toBe(record.path)
    expect(ev('file.folder')).toBe('Required Reading')
    expect(ev('file.ext')).toBe('md')
    expect(ev('file.size')).toBe(1234)
    expect(ev('file.ctime')).toEqual(new DateValue(record.ctime, true))
    expect(ev('file.mtime')).toEqual(new DateValue(record.mtime, true))
    expect(ev('file.tags')).toEqual(['School/Math', 'book'])
    expect(ev('file.links')).toEqual([new LinkValue('Textbook'), new LinkValue('People/Alice')])
    expect(ev('file.embeds[0]')).toEqual(new LinkValue('cover.png'))
    expect(ev('file.properties.status')).toBe('todo')
    expect(ev('file.properties.tags')).toEqual(['School/Math', 'book'])
    expect(err(ev('file.nope'))).toMatch(/unknown field nope on file/)
  })

  it('file without a scope file is null; this mirrors file', () => {
    expect(ev('file', scope({}, { file: null }))).toBe(null)
    expect(ev('file.name', scope({}, { file: null }))).toBe(null)
    expect(ev('this.name', scope({}, { this: new FileValue({ ...record, name: 'Me.md' }) }))).toBe('Me.md')
    expect(ev('this')).toBe(null)
  })

  it('a frontmatter property named file/note/this/today is shadowed by the builtin', () => {
    const s = scope({ file: 'x', today: 'y' })
    expect(ev('file', s)).toBeInstanceOf(FileValue)
    expect(ev('note.file', s)).toBe('x')
    expect(ev('today', s)).toBeInstanceOf(ErrorValue)
    expect(ev('note.today', s)).toBe('y')
  })
})

describe('formulas', () => {
  it('evaluates lazily, memoises per call and detects cycles', () => {
    const calls = { n: 0 }
    const s = scope({ price: 10 }, {
      formulas: {
        double: 'price * 2',
        quad: 'formula.double + formula.double',
        a: 'formula.b + 1',
        b: 'formula.a + 1',
        self: 'formula.self',
        bad: '1 +',
      },
    })
    Object.defineProperty(s.note, 'price', { get: () => (calls.n++, 10), enumerable: true })
    expect(ev('formula.quad', s)).toBe(40)
    expect(calls.n).toBe(1)
    expect(err(ev('formula.a', s))).toBe('formula cycle: a')
    expect(err(ev('formula.self', s))).toBe('formula cycle: self')
    expect(err(ev('formula.bad', s))).toMatch(/formula bad/)
    expect(err(ev('formula.nope', s))).toMatch(/unknown formula nope/)
  })
})

describe('operators', () => {
  it('arithmetic with JS-style coercion', () => {
    expect(ev('1 + 2 * 3')).toBe(7)
    expect(ev('(1 + 2) * 3')).toBe(9)
    expect(ev('7 % 3')).toBe(1)
    expect(ev('-(2 + 3)')).toBe(-5)
    expect(ev('"5" - 2')).toBe(3)
    expect(ev('"5" * "2"')).toBe(10)
    expect(ev('true + 1')).toBe(2)
    expect(ev('null + 1')).toBe(1)
    expect(ev('10 / 4')).toBe(2.5)
  })

  it('string + anything concatenates with toString rules', () => {
    expect(ev('"a" + 1')).toBe('a1')
    expect(ev('1 + "a"')).toBe('1a')
    expect(ev('"x" + null')).toBe('x')
    expect(ev('"n: " + [1, 2]')).toBe('n: 1, 2')
    expect(ev('"d: " + date("2026-08-21")')).toBe('d: 2026-08-21')
  })

  it('division by zero and bad operands are errors', () => {
    expect(err(ev('1 / 0'))).toMatch(/division by zero/)
    expect(err(ev('1 % 0'))).toMatch(/division by zero/)
    expect(err(ev('"abc" * 2'))).toMatch(/not a number/)
    expect(err(ev('[1] - 1'))).toMatch(/list/)
  })

  it('dates and durations', () => {
    const d1 = 'date("2026-08-01")'
    const d2 = 'date("2026-08-03")'
    expect(ev(`${d2} - ${d1}`)).toEqual(new DurationValue(2 * 86400e3))
    expect(ev(`(${d2} - ${d1}).days`)).toBe(2)
    expect(ev(`${d1} + duration("1d")`)).toEqual(new DateValue(new Date(2026, 7, 2).getTime(), false))
    expect(ev(`duration("1d") + ${d1}`)).toEqual(new DateValue(new Date(2026, 7, 2).getTime(), false))
    expect(ev(`${d2} - duration("1d")`)).toEqual(new DateValue(new Date(2026, 7, 2).getTime(), false))
    expect(ev('duration("1d") + duration("2h")')).toEqual(new DurationValue(26 * 3600e3))
    expect(ev('duration("1d") - duration("2h")')).toEqual(new DurationValue(22 * 3600e3))
    expect(ev(`${d1} < ${d2}`)).toBe(true)
    expect(ev(`${d1} > ${d2}`)).toBe(false)
    expect(ev(`${d1} == date("2026-08-01")`)).toBe(true)
    expect(ev(`${d1} != ${d2}`)).toBe(true)
    expect(ev('duration("1h") < duration("2h")')).toBe(true)
    expect(ev('date("2026-08-01") < today()')).toBe(true)
    expect(ev('(now() - file.mtime).days')).toBeGreaterThan(0)
    expect(err(ev(`${d1} * 2`))).toMatch(/date/)
  })

  it('comparison: strings lexicographic, otherwise numeric', () => {
    expect(ev('"a" < "b"')).toBe(true)
    expect(ev('"b" <= "a"')).toBe(false)
    expect(ev('2 >= 2')).toBe(true)
    expect(ev('"10" > 9')).toBe(true)
    expect(ev('null < 1')).toBe(true)
  })

  it('equality is deep and type-aware', () => {
    expect(ev('1 == 1')).toBe(true)
    expect(ev('1 == "1"')).toBe(true)
    expect(ev('null == null')).toBe(true)
    expect(ev('null == 0')).toBe(false)
    expect(ev('[1, [2, "x"]] == [1, [2, "x"]]')).toBe(true)
    expect(ev('[1, 2] == [1, 3]')).toBe(false)
    expect(ev('[1, 2] != [1, 2]')).toBe(false)
    expect(ev('{a: 1, b: [2]} == {b: [2], a: 1}')).toBe(true)
    expect(ev('{a: 1} == {a: 1, b: 2}')).toBe(false)
    expect(ev('link("A") == link("A", "disp")')).toBe(true)
    expect(ev('link("A") == link("B")')).toBe(false)
    expect(ev('link("A") == "A"')).toBe(true)
    expect(ev('link("A") == "[[A]]"')).toBe(true)
    expect(ev('"x" == 1')).toBe(false)
    expect(ev('status != "done"', scope({ status: 'todo' }))).toBe(true)
    expect(ev('status != "done"', scope({ status: 'done' }))).toBe(false)
    expect(ev('status != "done"', scope())).toBe(true)
  })

  it('&& and || short-circuit and return the operand; ! uses truthiness', () => {
    expect(ev('0 || "x"')).toBe('x')
    expect(ev('"a" || "b"')).toBe('a')
    expect(ev('1 && 2')).toBe(2)
    expect(ev('null && boom()')).toBe(null)
    expect(ev('1 || boom()')).toBe(1)
    expect(ev('!null')).toBe(true)
    expect(ev('![]')).toBe(true)
    expect(ev('![0]')).toBe(false)
    expect(ev('!"x"')).toBe(false)
    expect(ev('!!0')).toBe(false)
  })

  it('truthiness table', () => {
    expect(ev('[null, false, 0, "", []].map(!value)')).toEqual([true, true, true, true, true])
    expect(ev('[true, 1, "a", [0], {}, date("2026-01-01")].map(!!value)')).toEqual([true, true, true, true, true, true])
    expect(ev('unknownFn().isTruthy()')).toBe(false)
    expect(ev('unknownFn().isEmpty()')).toBe(true)
  })

  it('errors propagate through every operator', () => {
    expect(err(ev('1 + unknownFn()'))).toMatch(/unknown function unknownFn/)
    expect(err(ev('unknownFn() || 1'))).toMatch(/unknown function/)
    expect(err(ev('!unknownFn()'))).toMatch(/unknown function/)
    expect(err(ev('unknownFn().lower()'))).toMatch(/unknown function/)
    expect(err(ev('"a".contains(unknownFn())'))).toMatch(/unknown function/)
    expect(err(ev('[unknownFn()]'))).toMatch(/unknown function/)
    expect(err(ev('if(unknownFn(), 1, 2)'))).toMatch(/unknown function/)
  })
})

describe('global functions', () => {
  it('if is lazy and defaults the else branch to null', () => {
    expect(ev('if(true, 1, 2)')).toBe(1)
    expect(ev('if(false, 1, 2)')).toBe(2)
    expect(ev('if(false, 1)')).toBe(null)
    expect(ev('if(true, 1, boom())')).toBe(1)
    expect(ev('if(false, boom(), 2)')).toBe(2)
    expect(ev('if(price, price.toFixed(2) + " dollars")', scope({ price: 12.5 }))).toBe('12.50 dollars')
    expect(ev('if(price, price.toFixed(2) + " dollars")', scope())).toBe(null)
  })

  it('date, today, now', () => {
    expect(ev('date("2026-08-21")')).toEqual(new DateValue(new Date(2026, 7, 21).getTime(), false))
    expect(ev('date("2026-08-21 10:00")')).toEqual(new DateValue(new Date(2026, 7, 21, 10).getTime(), true))
    expect(ev('date(date("2026-08-21"))')).toEqual(new DateValue(new Date(2026, 7, 21).getTime(), false))
    expect(ev('date(0)')).toEqual(new DateValue(0, true))
    expect(err(ev('date("nope")'))).toMatch(/invalid date/)
    const today = ev('today()') as DateValue
    expect(today.hasTime).toBe(false)
    expect(today.ms).toBe(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime())
    const now = ev('now()') as DateValue
    expect(now.hasTime).toBe(true)
    expect(Math.abs(now.ms - Date.now())).toBeLessThan(1000)
  })

  it('duration parses unit strings', () => {
    expect(ev('duration("2d")')).toEqual(new DurationValue(2 * 86400e3))
    expect(ev('duration("3h")')).toEqual(new DurationValue(3 * 3600e3))
    expect(ev('duration("90m")')).toEqual(new DurationValue(90 * 60e3))
    expect(ev('duration("1w")')).toEqual(new DurationValue(7 * 86400e3))
    expect(ev('duration("1d 2h")')).toEqual(new DurationValue(26 * 3600e3))
    expect(ev('duration("45s")')).toEqual(new DurationValue(45e3))
    expect(ev('duration("1.5h")')).toEqual(new DurationValue(5400e3))
    expect(ev('duration(1000)')).toEqual(new DurationValue(1000))
    expect(err(ev('duration("soon")'))).toMatch(/invalid duration/)
  })

  it('number', () => {
    expect(ev('number("42")')).toBe(42)
    expect(ev('number(" 4.5 ")')).toBe(4.5)
    expect(ev('number(true)')).toBe(1)
    expect(ev('number(false)')).toBe(0)
    expect(ev('number(date(1234))')).toBe(1234)
    expect(ev('number(duration("1s"))')).toBe(1000)
    expect(ev('number(7)')).toBe(7)
    expect(err(ev('number("x")'))).toMatch(/not a number/)
  })

  it('min and max accept varargs or a list, numbers or dates', () => {
    expect(ev('min(3, 1, 2)')).toBe(1)
    expect(ev('max(3, 1, 2)')).toBe(3)
    expect(ev('max([3, 1, 2])')).toBe(3)
    expect(ev('min()')).toBe(null)
    expect(ev('max(date("2026-01-01"), date("2027-01-01"))')).toEqual(new DateValue(new Date(2027, 0, 1).getTime(), false))
    expect(ev('min(1, "2", true)')).toBe(1)
  })

  it('link, file, list, image, escapeHTML, random', () => {
    expect(ev('link("A")')).toEqual(new LinkValue('A'))
    expect(ev('link("A", "d")')).toEqual(new LinkValue('A', 'd'))
    expect(ev('link(file)')).toEqual(new LinkValue('Textbook Notes'))
    expect(err(ev('file("A")'))).toMatch(/needs an index/)
    expect(ev('list(1)')).toEqual([1])
    expect(ev('list([1, 2])')).toEqual([1, 2])
    expect(ev('list(null)')).toEqual([])
    expect(ev('image("a.png")')).toEqual({ type: 'image', src: 'a.png' })
    expect(ev('image(link("a.png"))')).toEqual({ type: 'image', src: 'a.png' })
    expect(ev('escapeHTML("<a href=\\"x\\">&</a>")')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
    const r = ev('random()') as number
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(1)
  })

  it('unknown functions and wrong arg types are errors', () => {
    expect(err(ev('nope(1)'))).toBe('unknown function nope')
    expect(err(ev('duration([1])'))).toMatch(/duration\(\)/)
    expect(err(ev('link(1)'))).toMatch(/link\(\)/)
  })
})

describe('any methods', () => {
  it('isEmpty, isTruthy, toString, isType', () => {
    expect(ev('null.isEmpty()')).toBe(true)
    expect(ev('"".isEmpty()')).toBe(true)
    expect(ev('[].isEmpty()')).toBe(true)
    expect(ev('{}.isEmpty()')).toBe(true)
    expect(ev('0.isEmpty()')).toBe(false)
    expect(ev('"a".isEmpty()')).toBe(false)
    expect(ev('date("2026-01-01").isEmpty()')).toBe(false)
    expect(ev('0.isTruthy()')).toBe(false)
    expect(ev('"a".isTruthy()')).toBe(true)
    expect(ev('12.5.toString()')).toBe('12.5')
    expect(ev('[1, "a"].toString()')).toBe('1, a')
    expect(ev('null.toString()')).toBe('')
    expect(ev('"s".isType("string")')).toBe(true)
    expect(ev('1.isType("number")')).toBe(true)
    expect(ev('true.isType("boolean")')).toBe(true)
    expect(ev('date("2026-01-01").isType("date")')).toBe(true)
    expect(ev('duration("1d").isType("duration")')).toBe(true)
    expect(ev('[].isType("list")')).toBe(true)
    expect(ev('{}.isType("object")')).toBe(true)
    expect(ev('link("a").isType("link")')).toBe(true)
    expect(ev('file.isType("file")')).toBe(true)
    expect(ev('/x/.isType("regex")')).toBe(true)
    expect(ev('null.isType("null")')).toBe(true)
    expect(ev('"s".isType("number")')).toBe(false)
    expect(err(ev('"s".nope()'))).toBe('unknown method nope on string')
    expect(err(ev('1.lower()'))).toBe('unknown method lower on number')
  })
})

describe('string methods', () => {
  it('covers the documented set', () => {
    expect(ev('"hello".length')).toBe(5)
    expect(ev('"hello".contains("ell")')).toBe(true)
    expect(ev('"hello".contains("z")')).toBe(false)
    expect(ev('"hello".containsAll("h", "o")')).toBe(true)
    expect(ev('"hello".containsAll("h", "z")')).toBe(false)
    expect(ev('"hello".containsAny("z", "o")')).toBe(true)
    expect(ev('"hello".containsAny("z", "q")')).toBe(false)
    expect(ev('"hello".startsWith("he")')).toBe(true)
    expect(ev('"hello".endsWith("lo")')).toBe(true)
    expect(ev('"HeLLo".lower()')).toBe('hello')
    expect(ev('"hello world".title()')).toBe('Hello World')
    expect(ev('"  x ".trim()')).toBe('x')
    expect(ev('"a,b,c".split(",")')).toEqual(['a', 'b', 'c'])
    expect(ev('"a,b,c".split(",", 2)')).toEqual(['a', 'b'])
    expect(ev('"a-b-c".replace("-", "+")')).toBe('a+b+c')
    expect(ev('"a1b2".replace(/\\d/g, "#")')).toBe('a#b#')
    expect(ev('"a1b2".replace(/\\d/, "#")')).toBe('a#b2')
    expect(ev('"ab".repeat(3)')).toBe('ababab')
    expect(ev('"abc".reverse()')).toBe('cba')
    expect(ev('"abcdef".slice(1, 3)')).toBe('bc')
    expect(ev('"abcdef".slice(-2)')).toBe('ef')
    expect(ev('"hi"[0]')).toBe('h')
    expect(err(ev('"a".repeat("x")'))).toMatch(/repeat\(\)/)
  })
})

describe('number methods', () => {
  it('abs, ceil, floor, round, toFixed', () => {
    expect(ev('(-2).abs()')).toBe(2)
    expect(ev('2.1.ceil()')).toBe(3)
    expect(ev('2.9.floor()')).toBe(2)
    expect(ev('2.5.round()')).toBe(3)
    expect(ev('2.456.round(2)')).toBe(2.46)
    expect(ev('2.456.toFixed(1)')).toBe('2.5')
    expect(ev('(price / age).toFixed(2)', scope({ price: 10, age: 3 }))).toBe('3.33')
    expect(ev('1.isEmpty()')).toBe(false)
  })
})

describe('date methods', () => {
  it('fields, date(), format, time, relative', () => {
    const d = 'date("2026-08-21 09:05:07")'
    expect(ev(`${d}.year`)).toBe(2026)
    expect(ev(`${d}.month`)).toBe(8)
    expect(ev(`${d}.day`)).toBe(21)
    expect(ev(`${d}.hour`)).toBe(9)
    expect(ev(`${d}.minute`)).toBe(5)
    expect(ev(`${d}.second`)).toBe(7)
    expect(ev(`${d}.millisecond`)).toBe(0)
    expect(ev(`${d}.date()`)).toEqual(new DateValue(new Date(2026, 7, 21).getTime(), false))
    expect(ev('date("2026-08-21").format("MM/DD/YYYY")')).toBe('08/21/2026')
    expect(ev(`${d}.format("YYYY-M-D H:m:s")`)).toBe('2026-8-21 9:5:7')
    expect(ev(`${d}.format("YY [at] HH:mm:ss")`)).toBe('26 at 09:05:07')
    expect(ev(`${d}.time()`)).toBe('09:05:07')
    expect(ev(`${d}.toString()`)).toBe('2026-08-21 09:05:07')
    expect(err(ev('date("x").format("YYYY")'))).toMatch(/invalid date/)
  })

  it('relative() is coarse and signed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 21, 12, 0, 0))
    try {
      expect(ev('now().relative()')).toBe('just now')
      expect(ev('(now() + duration("30s")).relative()')).toBe('just now')
      expect(ev('(now() + duration("3d")).relative()')).toBe('in 3 days')
      expect(ev('(now() - duration("3d")).relative()')).toBe('3 days ago')
      expect(ev('(now() - duration("1h")).relative()')).toBe('1 hour ago')
      expect(ev('(now() + duration("5m")).relative()')).toBe('in 5 minutes')
      expect(ev('(now() - duration("2w")).relative()')).toBe('2 weeks ago')
      expect(ev('(now() - duration("60d")).relative()')).toBe('2 months ago')
      expect(ev('(now() + duration("800d")).relative()')).toBe('in 2 years')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('duration methods', () => {
  it('fields are fractional totals; toString is unit style', () => {
    expect(ev('duration("36h").days')).toBe(1.5)
    expect(ev('duration("90m").hours')).toBe(1.5)
    expect(ev('duration("90s").minutes')).toBe(1.5)
    expect(ev('duration("1500ms").seconds')).toBe(1.5)
    expect(ev('duration("2s").milliseconds')).toBe(2000)
    expect(ev('duration("1d 2h").toString()')).toBe('1d 2h')
    expect(ev('"" + duration("1w")')).toBe('7d')
  })
})

describe('list methods', () => {
  it('contains, containsAll, containsAny use deep equality', () => {
    expect(ev('[1, [2]].length')).toBe(2)
    expect(ev('[1, [2]].contains([2])')).toBe(true)
    expect(ev('[1, 2].contains(3)')).toBe(false)
    expect(ev('[1, 2, 3].containsAll(1, 3)')).toBe(true)
    expect(ev('[1, 2, 3].containsAll(1, 4)')).toBe(false)
    expect(ev('[1, 2, 3].containsAny(4, 3)')).toBe(true)
    expect(ev('[link("A")].contains(link("A"))')).toBe(true)
    expect(ev('tags.contains("book")', scope({ tags: ['book', 'x'] }))).toBe(true)
  })

  it('filter, map, reduce bind value, index, acc', () => {
    expect(ev('[1, 2, 3, 4].filter(value % 2 == 0)')).toEqual([2, 4])
    expect(ev('[1, 2, 3].map(value * 10)')).toEqual([10, 20, 30])
    expect(ev('["a", "b"].map(index + ":" + value)')).toEqual(['0:a', '1:b'])
    expect(ev('[1, 2, 3].reduce(acc + value, 0)')).toBe(6)
    expect(ev('[1, 2, 3].reduce(acc + value * index, 100)')).toBe(108)
    expect(ev('[].reduce(acc + value, "init")')).toBe('init')
    expect(ev('[[1, 2], [3]].map(value.length).filter(value > 1)')).toEqual([2])
    expect(ev('[1, 2].map(value + price)', scope({ price: 10 }))).toEqual([11, 12])
    expect(ev('[1, 2, 3].filter(value > threshold)', scope({ threshold: 1 }))).toEqual([2, 3])
    expect(ev('[["a"], ["b"]].map(value.map(value + index))')).toEqual([['a0'], ['b0']])
    expect(err(ev('[1].map(unknownFn())'))).toMatch(/unknown function/)
    expect(err(ev('[1].filter()'))).toMatch(/filter\(\)/)
  })

  it('flat, join, reverse, slice, sort, unique', () => {
    expect(ev('[1, [2, [3]]].flat()')).toEqual([1, 2, 3])
    expect(ev('["he", "she"].join("/")')).toBe('he/she')
    expect(ev('[1, null, "x"].join(", ")')).toBe('1, , x')
    expect(ev('[1, 2, 3].reverse()')).toEqual([3, 2, 1])
    expect(ev('[1, 2, 3, 4].slice(1, 3)')).toEqual([2, 3])
    expect(ev('[1, 2, 3, 4].slice(-1)')).toEqual([4])
    expect(ev('[3, 10, 2].sort()')).toEqual([2, 3, 10])
    expect(ev('["b", "a", "C"].sort()')).toEqual(['a', 'b', 'C'])
    expect(ev('[date("2026-02-01"), date("2026-01-01")].sort()[0].month')).toBe(1)
    expect(ev('[2, "b", null, 1, "a"].sort()')).toEqual([null, 1, 2, 'a', 'b'])
    expect(ev('[1, 1, "a", "a", [1], [1]].unique()')).toEqual([1, 'a', [1]])
    expect(ev('[1, 2].reverse()')).toEqual([2, 1])
    expect(ev('race + " " + class + " (" + pronouns.join("/") + ")"', scope({ race: 'Elf', class: 'Ranger', pronouns: ['she', 'her'] }))).toBe('Elf Ranger (she/her)')
  })
})

describe('object methods', () => {
  it('isEmpty, keys, values, member and index access', () => {
    expect(ev('{a: 1, b: 2}.keys()')).toEqual(['a', 'b'])
    expect(ev('{a: 1, b: 2}.values()')).toEqual([1, 2])
    expect(ev('{a: 1}.isEmpty()')).toBe(false)
    expect(ev('{a: {b: 2}}.a.b')).toBe(2)
    expect(ev('{a: 1}["a"]')).toBe(1)
    expect(ev('{a: 1}.zzz')).toBe(null)
    expect(ev('meta.nested.deep', scope({ meta: { nested: { deep: '[[X]]' } } }))).toEqual(new LinkValue('X'))
  })
})

describe('link and regex methods', () => {
  it('linksTo, asFile placeholder, matches', () => {
    expect(ev('link("Textbook Notes").linksTo(file)')).toBe(true)
    expect(ev('link("Required Reading/Textbook Notes.md").linksTo(file)')).toBe(true)
    expect(ev('link("Other").linksTo(file)')).toBe(false)
    expect(err(ev('link("A").asFile()'))).toMatch(/needs an index/)
    expect(ev('/^a.c$/.matches("abc")')).toBe(true)
    expect(ev('/^a.c$/.matches("abcd")')).toBe(false)
    expect(ev('/A/i.matches("xa")')).toBe(true)
    expect(ev('/x/.matches(null)')).toBe(false)
  })
})

describe('file methods', () => {
  it('hasTag is case-insensitive, nested-aware and # tolerant', () => {
    expect(ev('file.hasTag("tag")')).toBe(false)
    expect(ev('file.hasTag("book")')).toBe(true)
    expect(ev('file.hasTag("#book")')).toBe(true)
    expect(ev('file.hasTag("BOOK")')).toBe(true)
    expect(ev('file.hasTag("school")')).toBe(true)
    expect(ev('file.hasTag("school/math")')).toBe(true)
    expect(ev('file.hasTag("math")')).toBe(false)
    expect(ev('file.hasTag("nope", "book")')).toBe(true)
  })

  it('hasLink accepts strings, links and files', () => {
    expect(ev('file.hasLink("Textbook")')).toBe(true)
    expect(ev('file.hasLink("Alice")')).toBe(true)
    expect(ev('file.hasLink("People/Alice")')).toBe(true)
    expect(ev('file.hasLink(link("Textbook"))')).toBe(true)
    expect(ev('file.hasLink("Nope")')).toBe(false)
    const other = new FileValue({ ...record, path: 'Textbook.md', basename: 'Textbook', folder: '' })
    expect(ev('file.hasLink(this)', scope({}, { this: other }))).toBe(true)
  })

  it('inFolder tolerates slashes and matches ancestors', () => {
    expect(ev('file.inFolder("Required Reading")')).toBe(true)
    expect(ev('file.inFolder("/Required Reading/")')).toBe(true)
    expect(ev('file.inFolder("Required")')).toBe(false)
    expect(ev('file.inFolder("Required Reading/Sub")')).toBe(false)
    expect(ev('file.inFolder("")')).toBe(true)
    const nested = new FileValue({ ...record, folder: 'A/B/C' })
    expect(ev('file.inFolder("A")', scope({}, { file: nested }))).toBe(true)
    expect(ev('file.inFolder("A/B")', scope({}, { file: nested }))).toBe(true)
    expect(ev('file.inFolder("B")', scope({}, { file: nested }))).toBe(false)
  })

  it('hasProperty, asLink, equality', () => {
    expect(ev('file.hasProperty("status")')).toBe(true)
    expect(ev('file.hasProperty("zzz")')).toBe(false)
    expect(ev('file.asLink()')).toEqual(new LinkValue('Textbook Notes'))
    expect(ev('file.asLink("Book")')).toEqual(new LinkValue('Textbook Notes', 'Book'))
    expect(ev('file == file')).toBe(true)
    expect(ev('file == this', scope({}, { this: new FileValue({ ...record, path: 'x.md' }) }))).toBe(false)
    expect(ev('file.toString()')).toBe('[[Textbook Notes]]')
  })
})

describe('never throws', () => {
  const original = Object.getOwnPropertyDescriptor(String.prototype, 'toLowerCase')!
  beforeEach(() => {
    Object.defineProperty(String.prototype, 'toLowerCase', { value: () => { throw new Error('kaboom') }, configurable: true })
  })
  afterEach(() => {
    Object.defineProperty(String.prototype, 'toLowerCase', original)
  })
  it('wraps internal exceptions as ErrorValue', () => {
    expect(err(ev('"A".lower()'))).toMatch(/kaboom/)
  })
})

describe('numeric list helpers (GRO-2132)', () => {
  it('sum, mean, median, min, max ignore non-numbers; empty gives null', () => {
    expect(ev('[1, 2, 3].sum()')).toBe(6)
    expect(ev('[1, "x", null, 3].sum()')).toBe(4)
    expect(ev('[1, 2, 3, 4].mean()')).toBe(2.5)
    expect(ev('[3, 1, 2].median()')).toBe(2)
    expect(ev('[4, 1, 3, 2].median()')).toBe(2.5)
    expect(ev('[3, 1, 2].min()')).toBe(1)
    expect(ev('[3, 1, 2].max()')).toBe(3)
    expect(ev('[].sum()')).toBe(null)
    expect(ev('["a"].mean()')).toBe(null)
    expect(ev('[].median()')).toBe(null)
    expect(ev('[].min()')).toBe(null)
    expect(ev('[].max()')).toBe(null)
    expect(ev('[1.234, 2.345].mean().round(2)')).toBe(1.79)
  })
})

describe('scope.extra (GRO-2134)', () => {
  it('extra identifiers win over note properties and read as bare names', () => {
    const s = scope({ values: 'from-note' }, { extra: { values: [1, 2, 3] } })
    expect(ev('values.sum()', s)).toBe(6)
    expect(ev('values', s)).toEqual([1, 2, 3])
    expect(ev('note.values', s)).toBe('from-note')
    expect(ev('values', scope({ values: 'from-note' }))).toBe('from-note')
  })
})

describe('file resolution (GRO-2132)', () => {
  const mk = (path: string, links: string[] = []): FileRecordLike => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    return { ...record, path: `/v/${path}`, name, basename: name.replace(/\.md$/, ''), folder, links, tags: [], embeds: [] }
  }
  const notes = [mk('A/Foo.md', ['Foo', 'B/Foo']), mk('B/Foo.md'), mk('Bar.md', ['A/Foo'])].map(r => new FileValue(r))
  /** Minimal resolver: absolute path, root-relative (± .md), else first basename match. */
  const resolve = (target: string): FileValue | null => {
    const key = target.replace(/^\[\[|\]\]$/g, '').replace(/\.md$/, '').replace(/^\/+/, '')
    return (
      notes.find(f => f.record.path === target) ??
      notes.find(f => `${f.record.folder}/${f.record.basename}`.replace(/^\//, '') === key) ??
      notes.find(f => f.record.basename === key) ??
      null
    )
  }
  const rs = (file: FileValue, extra: Partial<Scope> = {}): Scope => scope({}, { file, resolve, ...extra })

  it('file(path) and link.asFile() resolve through the scope resolver', () => {
    expect(ev('file("A/Foo").name', rs(notes[2]))).toBe('Foo.md')
    expect(ev('file("A/Foo.md").path', rs(notes[2]))).toBe('/v/A/Foo.md')
    expect(ev('file("/v/B/Foo.md").folder', rs(notes[2]))).toBe('B')
    expect(ev('file("Foo").path', rs(notes[2]))).toBe('/v/A/Foo.md')
    expect(ev('file("Nope")', rs(notes[2]))).toBe(null)
    expect(ev('file(link("Bar")).basename', rs(notes[2]))).toBe('Bar')
    expect(ev('link("B/Foo").asFile().path', rs(notes[2]))).toBe('/v/B/Foo.md')
    expect(ev('link("Nope").asFile()', rs(notes[2]))).toBe(null)
    expect(ev('file("A/Foo") == file', rs(notes[0]))).toBe(true)
    expect(err(ev('file("A/Foo")'))).toMatch(/needs an index/)
    expect(err(ev('link("A").asFile()'))).toMatch(/needs an index/)
  })

  it('hasLink / linksTo / link equality compare resolved paths, falling back to text when unresolved', () => {
    // A/Foo links to "Foo" (→ A/Foo itself) and "B/Foo"; textual matching would also accept "Other/Foo".
    expect(ev('file.hasLink("B/Foo")', rs(notes[0]))).toBe(true)
    expect(ev('file.hasLink("A/Foo")', rs(notes[0]))).toBe(true)
    expect(ev('file.hasLink("Bar")', rs(notes[0]))).toBe(false)
    expect(ev('file.hasLink("Other/Foo")', rs(notes[0]))).toBe(true) // unresolved target → textual fallback
    expect(ev('file.hasLink(this)', rs(notes[0], { this: notes[1] }))).toBe(true)
    expect(ev('file.hasLink(this)', rs(notes[2], { this: notes[1] }))).toBe(false) // Bar links A/Foo, not B/Foo
    expect(ev('file.hasLink(this)', rs(notes[2], { this: notes[0] }))).toBe(true)
    expect(ev('link("Foo").linksTo(this)', rs(notes[2], { this: notes[0] }))).toBe(true)
    expect(ev('link("Foo").linksTo(this)', rs(notes[2], { this: notes[1] }))).toBe(false)
    expect(ev('link("B/Foo").linksTo(this)', rs(notes[2], { this: notes[1] }))).toBe(true)
    expect(ev('link("Foo") == link("A/Foo")', rs(notes[2]))).toBe(true)
    expect(ev('link("Foo") == link("B/Foo")', rs(notes[2]))).toBe(false)
    expect(ev('link("Foo") != link("B/Foo")', rs(notes[2]))).toBe(true)
    // The list methods compare the same way `==` does (YAZ-1469): resolved paths first, text only as fallback.
    expect(ev('[link("A/Foo")].contains(link("Foo"))', rs(notes[2]))).toBe(true)
    expect(ev('[link("B/Foo")].contains(link("Foo"))', rs(notes[2]))).toBe(false)
    expect(ev('[link("Foo")].containsAny(link("B/Foo"))', rs(notes[2]))).toBe(false)
    expect(ev('[link("Foo")].containsAll(link("A/Foo"))', rs(notes[2]))).toBe(true)
    expect(ev('link("B/Foo") == "B/Foo.md"', rs(notes[2]))).toBe(true)
    expect(ev('link("Foo") == file', rs(notes[0]))).toBe(true)
    expect(ev('link("Foo") == file', rs(notes[1]))).toBe(false)
    expect(ev('link("Ghost") == "Ghost"', rs(notes[2]))).toBe(true) // neither side resolves → textual
    expect(ev('link("Foo") == "B/Foo"')).toBe(true) // no resolver → textual (bare basename matches a path)
    expect(ev('link("Foo") == "B/Foo"', rs(notes[2]))).toBe(false) // resolver: A/Foo vs B/Foo
  })
})
