import { parseDuration, parseIsoDate, startOfDay } from './dates'
import { ArgError, toNumber } from './ops'
import { DateValue, DurationValue, ErrorValue, FileValue, LinkValue, type Scope, type Value, render, stripBrackets, typeOf } from './values'

/** Global functions (GRO-2131). `if` is lazy and lives in the evaluator; `scope` carries the resolver (GRO-2132). */
export type GlobalFn = (args: Value[], scope: Scope) => Value

const arg = (args: Value[], i: number): Value => args[i] ?? null

export function toDate(v: Value): Value {
  if (v === null || v instanceof DateValue) return v
  if (typeof v === 'number') return new DateValue(v, true)
  if (typeof v !== 'string') throw new ArgError(`date() expects a string, got ${typeOf(v)}`)
  const iso = parseIsoDate(v)
  if (iso) return new DateValue(iso.ms, iso.hasTime)
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? new ErrorValue(`invalid date: ${v}`) : new DateValue(ms, true)
}

function toDuration(v: Value): Value {
  if (v === null || v instanceof DurationValue) return v
  if (typeof v === 'number') return new DurationValue(v)
  if (typeof v !== 'string') throw new ArgError(`duration() expects a string, got ${typeOf(v)}`)
  const ms = parseDuration(v)
  return ms === null ? new ErrorValue(`invalid duration: ${v}`) : new DurationValue(ms)
}

/** min/max over varargs or a single list; dates stay dates, everything else goes numeric. */
function extreme(args: Value[], pick: (a: number, b: number) => number): Value {
  const items = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).filter(v => v !== null)
  if (!items.length) return null
  if (items.every(v => v instanceof DateValue)) {
    return (items as DateValue[]).reduce((a, b) => (pick(a.ms, b.ms) === a.ms ? a : b))
  }
  let best: number | undefined
  for (const v of items) {
    const n = toNumber(v)
    if (n instanceof ErrorValue) return n
    best = best === undefined ? n : pick(best, n)
  }
  return best ?? null
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const FUNCTIONS: Record<string, GlobalFn> = {
  date: args => toDate(arg(args, 0)),
  today: () => new DateValue(startOfDay(Date.now()), false),
  now: () => new DateValue(Date.now(), true),
  duration: args => toDuration(arg(args, 0)),
  number: args => toNumber(arg(args, 0)),
  min: args => extreme(args, Math.min),
  max: args => extreme(args, Math.max),
  link: args => {
    const target = arg(args, 0)
    const display = args.length > 1 && args[1] !== null ? render(args[1]) : undefined
    if (typeof target === 'string') return new LinkValue(stripBrackets(target), display)
    if (target instanceof LinkValue) return new LinkValue(target.target, display ?? target.display)
    if (target instanceof FileValue) return new LinkValue(target.record.basename, display)
    throw new ArgError(`link() expects a string, got ${typeOf(target)}`)
  },
  file: (args, { resolve }) => {
    const v = arg(args, 0)
    if (!resolve) return new ErrorValue('file() needs an index')
    if (v instanceof FileValue) return v
    const target = v instanceof LinkValue ? v.target : typeof v === 'string' ? v : null
    if (target === null) throw new ArgError(`file() expects a path, got ${typeOf(v)}`)
    return resolve(target)
  },
  list: args => {
    const v = arg(args, 0)
    return v === null ? [] : Array.isArray(v) ? v : [v]
  },
  image: args => {
    const v = arg(args, 0)
    const src = v instanceof LinkValue ? v.target : v instanceof FileValue ? v.record.path : render(v)
    return { type: 'image', src }
  },
  escapeHTML: args => render(arg(args, 0)).replace(/[&<>"']/g, c => HTML_ESCAPES[c]),
  random: () => Math.random(),
}

export const hasFunction = (name: string): boolean => Object.hasOwn(FUNCTIONS, name)
