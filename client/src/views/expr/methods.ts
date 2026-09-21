import { formatDate, relativeDate, startOfDay } from './dates'
import { ArgError } from './ops'
import {
  DateValue, DurationValue, ErrorValue, FileValue, type FileRecordLike, LinkValue, RegexValue, type Scope, type Value, type ValueType,
  equals, fromYaml, isEmpty, isTruthy, linkTargetsMatch, render, stripBrackets, typeOf,
} from './values'

/** Fields and type methods (GRO-2131). `filter/map/reduce` are special-cased in the evaluator; `scope` carries the resolver (GRO-2132). */
type Method<T> = (recv: T, args: Value[], scope: Scope) => Value
type Table<T> = Record<string, Method<T>>

const needNumber = (fn: string, v: Value | undefined): number => {
  if (typeof v !== 'number') throw new ArgError(`${fn}() expects a number, got ${typeOf(v ?? null)}`)
  return v
}
const needString = (fn: string, v: Value | undefined): string => {
  if (typeof v !== 'string') throw new ArgError(`${fn}() expects a string, got ${typeOf(v ?? null)}`)
  return v
}
const optNumber = (fn: string, v: Value | undefined): number | undefined => (v == null ? undefined : needNumber(fn, v))

const FILE_FIELDS: Record<string, (r: FileRecordLike) => Value> = {
  name: r => r.name,
  basename: r => r.basename,
  path: r => r.path,
  folder: r => r.folder,
  ext: r => r.ext,
  size: r => r.size,
  ctime: r => new DateValue(r.ctime, true),
  mtime: r => new DateValue(r.mtime, true),
  tags: r => [...r.tags],
  links: r => r.links.map(l => new LinkValue(l)),
  embeds: r => r.embeds.map(l => new LinkValue(l)),
  properties: r => fromYaml(r.properties),
}

const DATE_FIELDS: Record<string, (d: Date) => number> = {
  year: d => d.getFullYear(),
  month: d => d.getMonth() + 1,
  day: d => d.getDate(),
  hour: d => d.getHours(),
  minute: d => d.getMinutes(),
  second: d => d.getSeconds(),
  millisecond: d => d.getMilliseconds(),
}

const DURATION_FIELDS: Record<string, number> = { days: 86400e3, hours: 3600e3, minutes: 60e3, seconds: 1e3, milliseconds: 1 }

/** `value.name` for a non-call member; missing object keys and null receivers give null. */
export function getField(v: Value, name: string): Value {
  if (v === null || v instanceof ErrorValue) return v
  if (typeof v === 'string' || Array.isArray(v)) {
    if (name === 'length') return v.length
  } else if (v instanceof DateValue) {
    if (Object.hasOwn(DATE_FIELDS, name)) return DATE_FIELDS[name](new Date(v.ms))
  } else if (v instanceof DurationValue) {
    if (Object.hasOwn(DURATION_FIELDS, name)) return v.ms / DURATION_FIELDS[name]
  } else if (v instanceof FileValue) {
    if (Object.hasOwn(FILE_FIELDS, name)) return FILE_FIELDS[name](v.record)
  } else if (typeOf(v) === 'object') {
    const o = v as { [k: string]: Value }
    return Object.hasOwn(o, name) ? o[name] : null
  }
  return new ErrorValue(`unknown field ${name} on ${typeOf(v)}`)
}

const ANY: Table<Value> = {
  isEmpty: v => isEmpty(v),
  isTruthy: v => isTruthy(v),
  toString: (v: Value) => render(v),
  isType: (v, [t]) => typeOf(v) === needString('isType', t),
}

const STRING: Table<string> = {
  contains: (s, [x]) => s.includes(render(x ?? null)),
  containsAll: (s, xs) => xs.every(x => s.includes(render(x))),
  containsAny: (s, xs) => xs.some(x => s.includes(render(x))),
  startsWith: (s, [x]) => s.startsWith(render(x ?? null)),
  endsWith: (s, [x]) => s.endsWith(render(x ?? null)),
  lower: s => s.toLowerCase(),
  title: s => s.replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase()),
  trim: s => s.trim(),
  split: (s, [sep, n]) => s.split(render(sep ?? null), optNumber('split', n)),
  replace: (s, [p, r]) => (p instanceof RegexValue ? s.replace(p.re, render(r ?? null)) : s.replaceAll(render(p ?? null), render(r ?? null))),
  repeat: (s, [n]) => s.repeat(Math.max(0, needNumber('repeat', n))),
  reverse: s => [...s].reverse().join(''),
  slice: (s, [a, b]) => s.slice(needNumber('slice', a), optNumber('slice', b)),
}

const NUMBER: Table<number> = {
  abs: n => Math.abs(n),
  ceil: n => Math.ceil(n),
  floor: n => Math.floor(n),
  round: (n, [d]) => {
    const p = 10 ** (optNumber('round', d) ?? 0)
    return Math.round(n * p) / p
  },
  toFixed: (n, [p]) => n.toFixed(needNumber('toFixed', p)),
}

const DATE: Table<DateValue> = {
  date: d => new DateValue(startOfDay(d.ms), false),
  format: (d, [f]) => formatDate(d.ms, needString('format', f)),
  time: d => formatDate(d.ms, 'HH:mm:ss'),
  relative: d => relativeDate(d.ms),
}

/** Sort order: null, numbers, dates/durations (by ms), strings (localeCompare), then everything else. */
const rank = (v: Value): number => (v === null ? 0 : typeof v === 'number' ? 1 : v instanceof DateValue || v instanceof DurationValue ? 2 : typeof v === 'string' ? 3 : 4)
function compareNatural(a: Value, b: Value): number {
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (typeof a === 'number') return a - (b as number)
  if (a instanceof DateValue || a instanceof DurationValue) return a.ms - (b as DateValue | DurationValue).ms
  if (typeof a === 'string') return a.localeCompare(b as string)
  return 0
}

const flatten = (l: Value[]): Value[] => l.flatMap(v => (Array.isArray(v) ? flatten(v) : [v]))

/** Numeric list helpers (GRO-2132): non-numbers are ignored, no numbers → null. */
const numbers = (l: Value[]): number[] => l.filter((v): v is number => typeof v === 'number')
const numeric = (fn: (ns: number[]) => number) => (l: Value[]): Value => {
  const ns = numbers(l)
  return ns.length ? fn(ns) : null
}
const median = (ns: number[]): number => {
  const s = [...ns].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const LIST: Table<Value[]> = {
  // Resolved like `==` (YAZ-1469): a link in the list matches a link to the same note, not merely the same text.
  contains: (l, [x], { resolve }) => l.some(v => equals(v, x ?? null, resolve)),
  containsAll: (l, xs, { resolve }) => xs.every(x => l.some(v => equals(v, x, resolve))),
  containsAny: (l, xs, { resolve }) => xs.some(x => l.some(v => equals(v, x, resolve))),
  flat: l => flatten(l),
  join: (l, [sep]) => l.map(render).join(sep == null ? ', ' : render(sep)),
  reverse: l => [...l].reverse(),
  slice: (l, [a, b]) => l.slice(needNumber('slice', a), optNumber('slice', b)),
  sort: l => [...l].sort(compareNatural),
  unique: l => l.filter((v, i) => l.findIndex(u => equals(u, v)) === i),
  sum: numeric(ns => ns.reduce((a, b) => a + b, 0)),
  mean: numeric(ns => ns.reduce((a, b) => a + b, 0) / ns.length),
  median: numeric(median),
  min: numeric(ns => Math.min(...ns)),
  max: numeric(ns => Math.max(...ns)),
}

const OBJECT: Table<{ [k: string]: Value }> = {
  keys: o => Object.keys(o),
  values: o => Object.values(o),
}

const LINK: Table<LinkValue> = {
  asFile: (l, _args, { resolve }) => (resolve ? resolve(l.target) : new ErrorValue('asFile() needs an index')),
  linksTo: (l, [f], { resolve }) => {
    if (!(f instanceof FileValue)) return false
    const got = resolve?.(l.target)
    return got ? got.record.path === f.record.path : linkTargetsMatch(l.target, f.record.path)
  },
}

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, '')

const FILE: Table<FileValue> = {
  asLink: (f, [d]) => new LinkValue(f.record.basename, d == null ? undefined : render(d)),
  hasProperty: (f, [n]) => Object.hasOwn(f.record.properties, needString('hasProperty', n)),
  hasTag: (f, tags) =>
    tags.some(t => {
      const want = render(t).replace(/^#/, '').toLowerCase()
      return f.record.tags.some(have => {
        const h = have.replace(/^#/, '').toLowerCase()
        return h === want || h.startsWith(`${want}/`)
      })
    }),
  /** With a resolver, a link that resolves is compared by path; unresolved targets/links fall back to text. */
  hasLink: (f, [t], { resolve }) => {
    const target = t instanceof FileValue ? t.record.path : t instanceof LinkValue ? t.target : stripBrackets(needString('hasLink', t))
    const want = resolve ? (t instanceof FileValue ? t : resolve(target)) : null
    return f.record.links.some(l => {
      const got = want && resolve!(l)
      return got ? got.record.path === want.record.path : linkTargetsMatch(l, target)
    })
  },
  inFolder: (f, [dir]) => {
    const want = trimSlashes(needString('inFolder', dir))
    const have = trimSlashes(f.record.folder)
    return want === '' || have === want || have.startsWith(`${want}/`)
  },
}

const REGEX: Table<RegexValue> = {
  matches: (r, [s]) => {
    if (s == null) return false
    r.re.lastIndex = 0
    return r.re.test(render(s))
  },
}

const METHODS: Partial<Record<ValueType, Table<never>>> = {
  string: STRING,
  number: NUMBER,
  date: DATE,
  list: LIST,
  object: OBJECT,
  link: LINK,
  file: FILE,
  regex: REGEX,
}

/** Dispatches `recv.name(args)` by runtime type; null receivers yield null for non-universal methods. */
export function callMethod(recv: Value, name: string, args: Value[], scope: Scope): Value {
  if (Object.hasOwn(ANY, name)) return ANY[name](recv, args, scope)
  if (recv === null) return null
  const type = typeOf(recv)
  const table = METHODS[type] as Table<Value> | undefined
  if (!table || !Object.hasOwn(table, name)) return new ErrorValue(`unknown method ${name} on ${type}`)
  return table[name](recv, args, scope)
}
