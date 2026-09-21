import { parseIsoDate, renderDate, renderDuration } from './dates'

/** Runtime value model for the Bases expression language (GRO-2131). */
export type Value =
  | string
  | number
  | boolean
  | null
  | DateValue
  | DurationValue
  | LinkValue
  | FileValue
  | RegexValue
  | ErrorValue
  | Value[]
  | { [k: string]: Value }

export class DateValue {
  constructor(readonly ms: number, readonly hasTime: boolean) {}
}
export class DurationValue {
  constructor(readonly ms: number) {}
}
export class LinkValue {
  constructor(readonly target: string, readonly display?: string) {}
}
export class RegexValue {
  constructor(readonly re: RegExp) {}
}
export class ErrorValue {
  constructor(readonly message: string) {}
}

/** Minimal structural shape of a note record; the real IndexRecord (shared/types.ts) satisfies it. */
export interface FileRecordLike {
  path: string
  name: string
  basename: string
  folder: string
  ext: string
  size: number
  ctime: number
  mtime: number
  properties: Record<string, unknown>
  aliases: string[]
  tags: string[]
  links: string[]
  embeds: string[]
}

export class FileValue {
  constructor(readonly record: FileRecordLike) {}
}

export interface Scope {
  note: Record<string, unknown>
  file: FileValue | null
  formulas: Record<string, string>
  this: FileValue | null
  /**
   * Link target / path → note in the engine's record set (GRO-2132). Absent: `file()` and
   * `asFile()` are ErrorValues and link matching stays textual.
   */
  resolve?: Resolver
  /** Extra identifiers consulted before note properties, e.g. `values` in custom summaries (GRO-2134). */
  extra?: Record<string, Value>
}

export type Resolver = (target: string) => FileValue | null

export type ValueType =
  | 'string' | 'number' | 'boolean' | 'null'
  | 'date' | 'duration' | 'link' | 'file' | 'regex' | 'error'
  | 'list' | 'object'

export function typeOf(v: Value): ValueType {
  if (v === null) return 'null'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return typeof v as ValueType
  if (Array.isArray(v)) return 'list'
  if (v instanceof DateValue) return 'date'
  if (v instanceof DurationValue) return 'duration'
  if (v instanceof LinkValue) return 'link'
  if (v instanceof FileValue) return 'file'
  if (v instanceof RegexValue) return 'regex'
  if (v instanceof ErrorValue) return 'error'
  return 'object'
}

/** Falsy: null, false, 0, NaN, '', [], ErrorValue. Everything else (including {}) is truthy. */
export function isTruthy(v: Value): boolean {
  if (v === null || v === false || v === 0 || v === '') return false
  if (typeof v === 'number') return !Number.isNaN(v)
  if (Array.isArray(v)) return v.length > 0
  return !(v instanceof ErrorValue)
}

/** Empty: null, '', [], {} and ErrorValue. Numbers and booleans are never empty. */
export function isEmpty(v: Value): boolean {
  if (v === null || v === '' || v instanceof ErrorValue) return true
  if (Array.isArray(v)) return v.length === 0
  return typeOf(v) === 'object' && Object.keys(v).length === 0
}

const WIKI_LINK = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/

/** `[[x]]` → `x`, otherwise unchanged. */
export function stripBrackets(s: string): string {
  const m = WIKI_LINK.exec(s)
  return m ? m[1] : s
}

const normTarget = (t: string) => stripBrackets(t).replace(/\.md$/i, '').replace(/^\/+|\/+$/g, '').toLowerCase()
const lastSegment = (t: string) => t.slice(t.lastIndexOf('/') + 1)

/** Two link targets match when equal after normalisation, or one is the bare basename of the other. */
export function linkTargetsMatch(a: string, b: string): boolean {
  const x = normTarget(a)
  const y = normTarget(b)
  if (x === y) return true
  if (!x.includes('/') && x === lastSegment(y)) return true
  return !y.includes('/') && y === lastSegment(x)
}

const isPrimitive = (v: Value) => v === null || typeof v !== 'object'

/** Link, path string or file → the note it names, or null when unresolved / not link-like. */
function resolveSide(v: Value, resolve: Resolver): FileValue | null {
  if (v instanceof FileValue) return v
  if (v instanceof LinkValue) return resolve(v.target)
  return typeof v === 'string' ? resolve(stripBrackets(v)) : null
}

/** Link `==` through the resolver (GRO-2132): both sides resolve → same path; otherwise undefined = fall back to text. */
function resolvedEquals(a: Value, b: Value, resolve: Resolver): boolean | undefined {
  const fa = resolveSide(a, resolve)
  const fb = fa && resolveSide(b, resolve)
  return fa && fb ? fa.record.path === fb.record.path : undefined
}

/** Deep equality; primitives compare loosely like JS `==`, links by target (by resolved path when `resolve` is given), dates by ms. */
export function equals(a: Value, b: Value, resolve?: Resolver): boolean {
  if (resolve && (a instanceof LinkValue || b instanceof LinkValue)) {
    const r = resolvedEquals(a, b, resolve)
    if (r !== undefined) return r
  }
  const ta = typeOf(a)
  const tb = typeOf(b)
  if (a instanceof LinkValue && typeof b === 'string') return linkTargetsMatch(a.target, b)
  if (typeof a === 'string' && b instanceof LinkValue) return linkTargetsMatch(a, b.target)
  if (a instanceof LinkValue && b instanceof FileValue) return linkTargetsMatch(a.target, b.record.path)
  if (a instanceof FileValue && b instanceof LinkValue) return linkTargetsMatch(a.record.path, b.target)
  // eslint-disable-next-line eqeqeq
  if (ta !== tb) return isPrimitive(a) && isPrimitive(b) && a == b
  if (isPrimitive(a)) return a === b
  if (a instanceof DateValue) return a.ms === (b as DateValue).ms
  if (a instanceof DurationValue) return a.ms === (b as DurationValue).ms
  if (a instanceof LinkValue) return a.target === (b as LinkValue).target
  if (a instanceof FileValue) return a.record.path === (b as FileValue).record.path
  if (a instanceof RegexValue) return String(a.re) === String((b as RegexValue).re)
  if (a instanceof ErrorValue) return a.message === (b as ErrorValue).message
  if (Array.isArray(a)) {
    const l = b as Value[]
    return a.length === l.length && a.every((v, i) => equals(v, l[i]))
  }
  const o = b as { [k: string]: Value }
  const keys = Object.keys(a)
  return keys.length === Object.keys(o).length && keys.every(k => Object.hasOwn(o, k) && equals(a[k], o[k]))
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Raw frontmatter → Value: `[[x|d]]` strings become links, ISO-ish strings and JS Dates become dates. */
export function fromYaml(v: unknown): Value {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    const link = WIKI_LINK.exec(v)
    if (link) return new LinkValue(link[1], link[2])
    const d = parseIsoDate(v)
    return d ? new DateValue(d.ms, d.hasTime) : v
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return new DateValue(v.getTime(), true)
  if (Array.isArray(v)) return v.map(fromYaml)
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromYaml(x)]))
  if (v instanceof DateValue || v instanceof DurationValue || v instanceof LinkValue || v instanceof FileValue) return v
  if (v instanceof RegexValue || v instanceof ErrorValue) return v
  return String(v)
}

function toJson(v: Value): unknown {
  if (Array.isArray(v)) return v.map(toJson)
  if (typeOf(v) === 'object') {
    return Object.fromEntries(Object.entries(v as { [k: string]: Value }).map(([k, x]) => [k, toJson(x)]))
  }
  return isPrimitive(v) ? v : render(v)
}

/** Display string (`toString()` semantics). */
export function render(v: Value): string {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(render).join(', ')
  if (v instanceof DateValue) return renderDate(v.ms, v.hasTime)
  if (v instanceof DurationValue) return renderDuration(v.ms)
  if (v instanceof LinkValue) return v.display === undefined ? `[[${v.target}]]` : `[[${v.target}|${v.display}]]`
  if (v instanceof FileValue) return `[[${v.record.basename}]]`
  if (v instanceof RegexValue) return String(v.re)
  if (v instanceof ErrorValue) return `#ERROR: ${v.message}`
  return JSON.stringify(toJson(v))
}
