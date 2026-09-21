import { describe, expect, it } from 'vitest'
import type { Expr } from './ast'
import { ExprSyntaxError, parse } from './parser'

/** Drop `pos` everywhere so ASTs compare as plain shapes. */
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => k !== 'pos')
        .map(([k, x]) => [k, strip(x)]),
    )
  }
  return v
}
const ast = (src: string) => strip(parse(src))

const num = (value: number) => ({ type: 'num', value })
const str = (value: string) => ({ type: 'str', value })
const id = (name: string) => ({ type: 'ident', name })
const bin = (op: string, left: unknown, right: unknown) => ({ type: 'binary', op, left, right })
const un = (op: string, operand: unknown) => ({ type: 'unary', op, operand })
const mem = (object: unknown, name: string) => ({ type: 'member', object, name })
const idx = (object: unknown, index: unknown) => ({ type: 'index', object, index })
const call = (name: string, ...args: unknown[]) => ({ type: 'call', name, args })
const meth = (object: unknown, name: string, ...args: unknown[]) => ({ type: 'method', object, name, args })

function fails(src: string): ExprSyntaxError {
  try {
    parse(src)
  } catch (e) {
    expect(e).toBeInstanceOf(ExprSyntaxError)
    return e as ExprSyntaxError
  }
  throw new Error(`expected ${JSON.stringify(src)} to fail`)
}

describe('literals', () => {
  it('strings with both quote styles and escapes', () => {
    expect(ast('"hi"')).toEqual(str('hi'))
    expect(ast("'hi'")).toEqual(str('hi'))
    expect(ast('"a\\"b"')).toEqual(str('a"b'))
    expect(ast("'a\\'b'")).toEqual(str("a'b"))
    expect(ast('"a\\\\b"')).toEqual(str('a\\b'))
    expect(ast('"a\\nb\\tc"')).toEqual(str('a\nb\tc'))
    expect(ast('"it\'s"')).toEqual(str("it's"))
    expect(ast('""')).toEqual(str(''))
  })

  it('numbers', () => {
    expect(ast('42')).toEqual(num(42))
    expect(ast('3.14')).toEqual(num(3.14))
    expect(ast('0')).toEqual(num(0))
  })

  it('negative numbers are unary minus', () => {
    expect(ast('-1')).toEqual(un('-', num(1)))
    expect(ast('2 - -1')).toEqual(bin('-', num(2), un('-', num(1))))
    expect(ast('-2 * 3')).toEqual(bin('*', un('-', num(2)), num(3)))
  })

  it('booleans and null', () => {
    expect(ast('true')).toEqual({ type: 'bool', value: true })
    expect(ast('false')).toEqual({ type: 'bool', value: false })
    expect(ast('null')).toEqual({ type: 'null' })
  })

  it('lists, with a trailing comma', () => {
    expect(ast('[1, "a", x]')).toEqual({ type: 'list', items: [num(1), str('a'), id('x')] })
    expect(ast('[1, 2,]')).toEqual({ type: 'list', items: [num(1), num(2)] })
    expect(ast('[]')).toEqual({ type: 'list', items: [] })
    expect(ast('[[1], [2]]')).toEqual({
      type: 'list',
      items: [{ type: 'list', items: [num(1)] }, { type: 'list', items: [num(2)] }],
    })
  })

  it('objects with string or identifier keys', () => {
    expect(ast('{"k": 1, k2: "v"}')).toEqual({
      type: 'object',
      entries: [{ key: 'k', value: num(1) }, { key: 'k2', value: str('v') }],
    })
    expect(ast('{}')).toEqual({ type: 'object', entries: [] })
  })

  it('regex literals where an operand is expected', () => {
    expect(ast('/ab+c/gi')).toEqual({ type: 'regex', pattern: 'ab+c', flags: 'gi' })
    expect(ast('/a\\/b/')).toEqual({ type: 'regex', pattern: 'a\\/b', flags: '' })
    expect(ast('/[/]/')).toEqual({ type: 'regex', pattern: '[/]', flags: '' })
    expect(ast('x == /re/')).toEqual(bin('==', id('x'), { type: 'regex', pattern: 're', flags: '' }))
    expect(ast('f(/re/, 1)')).toEqual(call('f', { type: 'regex', pattern: 're', flags: '' }, num(1)))
  })
})

describe('identifiers and access', () => {
  it('identifiers', () => {
    expect(ast('foo')).toEqual(id('foo'))
    expect(ast('_a1')).toEqual(id('_a1'))
    expect(ast('class')).toEqual(id('class'))
  })

  it('dotted members', () => {
    expect(ast('a.b.c')).toEqual(mem(mem(id('a'), 'b'), 'c'))
    expect(ast('file.name')).toEqual(mem(id('file'), 'name'))
  })

  it('index access', () => {
    expect(ast('a[0]')).toEqual(idx(id('a'), num(0)))
    expect(ast('file.embeds[0]')).toEqual(idx(mem(id('file'), 'embeds'), num(0)))
    expect(ast('note["my prop"]')).toEqual(idx(id('note'), str('my prop')))
    expect(ast('a[i + 1]')).toEqual(idx(id('a'), bin('+', id('i'), num(1))))
  })

  it('method and global calls', () => {
    expect(ast('a.f(x, y)')).toEqual(meth(id('a'), 'f', id('x'), id('y')))
    expect(ast('a.f()')).toEqual(meth(id('a'), 'f'))
    expect(ast('f(x)')).toEqual(call('f', id('x')))
    expect(ast('today()')).toEqual(call('today'))
    expect(ast('f(1, g(2), 3,)')).toEqual(call('f', num(1), call('g', num(2)), num(3)))
  })

  it('chains', () => {
    expect(ast('a.b(1).c[2].d()')).toEqual(meth(idx(mem(meth(id('a'), 'b', num(1)), 'c'), num(2)), 'd'))
    expect(ast('(price / age).toFixed(2)')).toEqual(meth(bin('/', id('price'), id('age')), 'toFixed', num(2)))
    expect(ast('"x".length')).toEqual(mem(str('x'), 'length'))
    expect(ast('[1,2].join("/")')).toEqual(meth({ type: 'list', items: [num(1), num(2)] }, 'join', str('/')))
  })
})

describe('operators', () => {
  it('arithmetic precedence and left associativity', () => {
    expect(ast('1 + 2 * 3')).toEqual(bin('+', num(1), bin('*', num(2), num(3))))
    expect(ast('(1 + 2) * 3')).toEqual(bin('*', bin('+', num(1), num(2)), num(3)))
    expect(ast('1 - 2 - 3')).toEqual(bin('-', bin('-', num(1), num(2)), num(3)))
    expect(ast('a / b / c')).toEqual(bin('/', bin('/', id('a'), id('b')), id('c')))
    expect(ast('a % 2')).toEqual(bin('%', id('a'), num(2)))
    expect(ast('1+2')).toEqual(bin('+', num(1), num(2)))
  })

  it('division is not a regex after an operand', () => {
    expect(ast('(a) / 2')).toEqual(bin('/', id('a'), num(2)))
    expect(ast('f(1) / 2')).toEqual(bin('/', call('f', num(1)), num(2)))
    expect(ast('a[0] / 2')).toEqual(bin('/', idx(id('a'), num(0)), num(2)))
    expect(ast('10 / 2 / 5')).toEqual(bin('/', bin('/', num(10), num(2)), num(5)))
  })

  it('comparison, equality, logic', () => {
    for (const op of ['<', '>', '<=', '>=', '==', '!=']) {
      expect(ast(`a ${op} b`)).toEqual(bin(op, id('a'), id('b')))
    }
    expect(ast('a == b < c')).toEqual(bin('==', id('a'), bin('<', id('b'), id('c'))))
    expect(ast('a < b + 1')).toEqual(bin('<', id('a'), bin('+', id('b'), num(1))))
    expect(ast('a || b && c')).toEqual(bin('||', id('a'), bin('&&', id('b'), id('c'))))
    expect(ast('a && b || c')).toEqual(bin('||', bin('&&', id('a'), id('b')), id('c')))
    expect(ast('a == 1 && b != 2')).toEqual(bin('&&', bin('==', id('a'), num(1)), bin('!=', id('b'), num(2))))
  })

  it('unary operators bind tighter than binary, looser than postfix', () => {
    expect(ast('!a && b')).toEqual(bin('&&', un('!', id('a')), id('b')))
    expect(ast('!!a')).toEqual(un('!', un('!', id('a'))))
    expect(ast('-a.b')).toEqual(un('-', mem(id('a'), 'b')))
    expect(ast('!x.isEmpty()')).toEqual(un('!', meth(id('x'), 'isEmpty')))
  })

  it('whitespace is insignificant', () => {
    expect(ast('  a\n  +\tb  ')).toEqual(bin('+', id('a'), id('b')))
  })
})

describe('positions', () => {
  it('records offsets per node kind', () => {
    const e = parse('foo.bar + 12') as Extract<Expr, { type: 'binary' }>
    expect(e.pos).toBe(8)
    expect(e.left.pos).toBe(3)
    expect((e.left as Extract<Expr, { type: 'member' }>).object.pos).toBe(0)
    expect(e.right.pos).toBe(10)
    expect(parse(' f(1)').pos).toBe(1)
    expect(parse('a[1]').pos).toBe(1)
    expect(parse('-x').pos).toBe(0)
  })
})

describe('syntax errors carry a position', () => {
  it('unexpected end of input', () => {
    expect(fails('1 +')).toMatchObject({ pos: 3 })
    expect(fails('1 +').message).toMatch(/end of input/)
    expect(fails('foo(')).toMatchObject({ pos: 4 })
    expect(fails('')).toMatchObject({ pos: 0 })
    expect(fails('[1,')).toMatchObject({ pos: 3 })
    expect(fails('a.')).toMatchObject({ pos: 2 })
  })

  it('unterminated string and regex', () => {
    const e = fails('"unterminated')
    expect(e.pos).toBe(0)
    expect(e.message).toMatch(/unterminated string/)
    expect(fails('1 + "x')).toMatchObject({ pos: 4 })
    expect(fails('/abc')).toMatchObject({ pos: 0 })
  })

  it('unexpected tokens and characters', () => {
    expect(fails('1 2')).toMatchObject({ pos: 2 })
    expect(fails(')')).toMatchObject({ pos: 0 })
    expect(fails('a.1')).toMatchObject({ pos: 2 })
    expect(fails('{a 1}')).toMatchObject({ pos: 3 })
    expect(fails('$')).toMatchObject({ pos: 0 })
    expect(fails('a = b')).toMatchObject({ pos: 2 })
    expect(fails('a & b')).toMatchObject({ pos: 2 })
    expect(fails('(1')).toMatchObject({ pos: 2 })
    expect(fails('1(2)')).toMatchObject({ pos: 1 })
  })
})
