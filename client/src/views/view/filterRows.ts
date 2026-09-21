import type { IndexRecord } from '@shared/types'
import type { ColumnTyping } from '../editorType'
import { type Expr, type Value, compile, fromYaml, typeOf } from '../expr'
import type { FilterNode } from '../viewSchema'
import { canonicalKey } from './keys'

/**
 * Filter builder rows ↔ expression strings (GRO-2135), back from the YAZ-846 amputation
 * (YAZ-1218 / YAZ-1224). Pure and DOM-free: the Filter menu edits `Rule`s, the stored view only
 * ever holds the strings `ruleToExpr` produces, and `exprToRule` recovers a row from any string
 * in the grammar below (else null → raw row).
 */

export type PropertyType = 'text' | 'number' | 'date' | 'checkbox' | 'list' | 'tags' | 'file' | 'link' | 'multi-link' | 'select' | 'multi-select'

export type OperatorId =
  | 'is' | 'isNot' | 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'isEmpty' | 'isNotEmpty'
  | 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge'
  | 'dateIs' | 'dateBefore' | 'dateAfter'
  | 'checked' | 'unchecked'
  | 'hasTag' | 'inFolder' | 'hasLink'
  | 'isAnyOf' | 'isNoneOf' | 'hasAnyOf' | 'hasNoneOf' | 'hasAllOf'

export interface Rule {
  /** Canonical key: `note.x`, `file.x` or `formula.x` (see `canonicalKey`). */
  property: string
  op: OperatorId
  /** Raw input text; '' for operators without a value; the ticked values for an `options` one. */
  value: string | string[]
}

/** What the value input holds; `none` hides it, `options` is the value checklist (YAZ-1467). */
export type ValueKind = 'text' | 'number' | 'date' | 'none' | 'options'

export interface OperatorDef {
  id: OperatorId
  label: string
  value: ValueKind
}

const OPS: Record<OperatorId, OperatorDef> = {
  is: { id: 'is', label: 'is', value: 'text' },
  isNot: { id: 'isNot', label: 'is not', value: 'text' },
  contains: { id: 'contains', label: 'contains', value: 'text' },
  notContains: { id: 'notContains', label: 'does not contain', value: 'text' },
  startsWith: { id: 'startsWith', label: 'starts with', value: 'text' },
  endsWith: { id: 'endsWith', label: 'ends with', value: 'text' },
  isEmpty: { id: 'isEmpty', label: 'is empty', value: 'none' },
  isNotEmpty: { id: 'isNotEmpty', label: 'is not empty', value: 'none' },
  eq: { id: 'eq', label: '=', value: 'number' },
  ne: { id: 'ne', label: '≠', value: 'number' },
  lt: { id: 'lt', label: '<', value: 'number' },
  gt: { id: 'gt', label: '>', value: 'number' },
  le: { id: 'le', label: '≤', value: 'number' },
  ge: { id: 'ge', label: '≥', value: 'number' },
  dateIs: { id: 'dateIs', label: 'is', value: 'date' },
  dateBefore: { id: 'dateBefore', label: 'is before', value: 'date' },
  dateAfter: { id: 'dateAfter', label: 'is after', value: 'date' },
  checked: { id: 'checked', label: 'is checked', value: 'none' },
  unchecked: { id: 'unchecked', label: 'is not checked', value: 'none' },
  hasTag: { id: 'hasTag', label: 'has tag', value: 'text' },
  inFolder: { id: 'inFolder', label: 'in folder', value: 'text' },
  hasLink: { id: 'hasLink', label: 'has link', value: 'text' },
  isAnyOf: { id: 'isAnyOf', label: 'is any of', value: 'options' },
  isNoneOf: { id: 'isNoneOf', label: 'is none of', value: 'options' },
  hasAnyOf: { id: 'hasAnyOf', label: 'has any of', value: 'options' },
  hasNoneOf: { id: 'hasNoneOf', label: 'has none of', value: 'options' },
  hasAllOf: { id: 'hasAllOf', label: 'has all of', value: 'options' },
}

export const OPERATORS_BY_TYPE: Record<PropertyType, OperatorId[]> = {
  text: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'contains', 'notContains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'],
  number: ['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'isEmpty', 'isNotEmpty'],
  date: ['dateIs', 'dateBefore', 'dateAfter', 'isEmpty', 'isNotEmpty'],
  checkbox: ['checked', 'unchecked'],
  list: ['contains', 'notContains', 'hasAnyOf', 'hasNoneOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'],
  tags: ['contains', 'notContains', 'hasAnyOf', 'hasNoneOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'],
  file: ['hasTag', 'inFolder', 'hasLink'],
  link: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
  'multi-link': ['contains', 'notContains', 'hasAnyOf', 'hasNoneOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
  'multi-select': ['contains', 'notContains', 'hasAnyOf', 'hasNoneOf', 'hasAllOf', 'isEmpty', 'isNotEmpty'],
}

/** The three file-method rules live on pseudo-properties so they fit the property · operator · value row. */
const FILE_OPS: Record<string, OperatorId[]> = {
  'file.tags': ['hasTag', 'hasAnyOf', 'hasNoneOf', 'hasAllOf'],
  'file.folder': ['inFolder', 'isAnyOf', 'isNoneOf'],
  'file.links': ['hasLink'],
}
const FILE_PROPERTY: Partial<Record<OperatorId, string>> = { hasTag: 'file.tags', inFolder: 'file.folder', hasLink: 'file.links' }

export const operator = (id: OperatorId): OperatorDef => OPS[id]

/** Operators the builder offers for one property of one type (a file pseudo-property has its own list). */
export function operatorsFor(property: string, type: PropertyType): OperatorDef[] {
  if (type === 'file') return (FILE_OPS[property] ?? []).map(id => OPS[id])
  return OPERATORS_BY_TYPE[type].map(id => OPS[id])
}

/**
 * Property type for a note key down the typing ladder (D4): the column's assigned kind, else its
 * dominant kind, else the first non-empty value across `records`, else text. `EditorKind` names are
 * the `PropertyType` names, except that a list on the `tags` property is the `tags` pseudo-type.
 * `file.*` and `formula.*` are by name and ignore typing entirely.
 */
export function inferType(property: string, records: readonly IndexRecord[], typing?: ColumnTyping): PropertyType {
  if (property in FILE_OPS) return 'file'
  if (property.startsWith('file.')) {
    const field = property.slice(5)
    return field === 'size' ? 'number' : field === 'ctime' || field === 'mtime' ? 'date' : 'text'
  }
  if (property.startsWith('formula.')) return 'text'
  const bare = property.startsWith('note.') ? property.slice(5) : property
  const kind = typing?.assigned ?? typing?.dominant ?? null
  if (kind !== null) return kind === 'list' && bare === 'tags' ? 'tags' : kind
  for (const r of records) {
    const raw = r.properties[bare]
    if (raw === null || raw === undefined || raw === '') continue
    const v = fromYaml(raw)
    const t = typeOf(v)
    if (t === 'number') return 'number'
    if (t === 'boolean') return 'checkbox'
    if (t === 'date') return 'date'
    if (t === 'list') {
      if ((v as Value[]).length === 0) continue
      return bare === 'tags' ? 'tags' : 'list'
    }
    return 'text'
  }
  return 'text'
}

// ---------- rule → expression ----------

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

const quote = (s: string): string =>
  `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`

const num = (s: string): string => {
  const n = Number(s.trim())
  return s.trim() !== '' && Number.isFinite(n) ? String(n) : '0'
}

/** `note.x` for an identifier-shaped name, `note["my prop"]` otherwise. */
function accessor(property: string): string {
  const key = canonicalKey(property)
  const dot = key.indexOf('.')
  const object = key.slice(0, dot)
  const name = key.slice(dot + 1)
  return IDENT.test(name) ? `${object}.${name}` : `${object}[${quote(name)}]`
}

/** The ticked values of an `options` operator, each quoted and comma-separated (YAZ-1467). */
const list = (value: Rule['value']): string => (Array.isArray(value) ? value : []).map(quote).join(', ')

export function ruleToExpr(rule: Rule): string {
  const { op } = rule
  /** The string half of the value; an operator's kind decides which half it fills. */
  const value = typeof rule.value === 'string' ? rule.value : ''
  if (op === 'hasTag' || op === 'inFolder' || op === 'hasLink') return `file.${op}(${quote(value)})`
  const a = accessor(rule.property)
  switch (op) {
    case 'is': return `${a} == ${quote(value)}`
    case 'isNot': return `${a} != ${quote(value)}`
    case 'contains': return `${a}.contains(${quote(value)})`
    case 'notContains': return `!${a}.contains(${quote(value)})`
    case 'startsWith': return `${a}.startsWith(${quote(value)})`
    case 'endsWith': return `${a}.endsWith(${quote(value)})`
    case 'isEmpty': return `${a}.isEmpty()`
    case 'isNotEmpty': return `!${a}.isEmpty()`
    case 'eq': return `${a} == ${num(value)}`
    case 'ne': return `${a} != ${num(value)}`
    // Ordering operators carry an emptiness guard (D5, YAZ-1218): `toNumber(null)` is 0, so a bare
    // comparison would match rows with NO value — Notion and Airtable both exclude empties here.
    case 'lt': return `!${a}.isEmpty() && ${a} < ${num(value)}`
    case 'gt': return `!${a}.isEmpty() && ${a} > ${num(value)}`
    case 'le': return `!${a}.isEmpty() && ${a} <= ${num(value)}`
    case 'ge': return `!${a}.isEmpty() && ${a} >= ${num(value)}`
    case 'dateIs': return `${a} == date(${quote(value)})`
    case 'dateBefore': return `!${a}.isEmpty() && ${a} < date(${quote(value)})`
    case 'dateAfter': return `!${a}.isEmpty() && ${a} > date(${quote(value)})`
    case 'checked': return `${a} == true`
    case 'unchecked': return `${a} == false`
    // Deep equality, unlike the substring `containsAny` a string would take (🔒 D5, YAZ-1467).
    case 'isAnyOf': return `[${list(rule.value)}].contains(${a})`
    case 'isNoneOf': return `![${list(rule.value)}].contains(${a})`
    case 'hasAnyOf': return `${a}.containsAny(${list(rule.value)})`
    case 'hasNoneOf': return `!${a}.containsAny(${list(rule.value)})`
    case 'hasAllOf': return `${a}.containsAll(${list(rule.value)})`
  }
}

// ---------- expression → rule ----------

const NUM_OP: Partial<Record<string, OperatorId>> = { '==': 'eq', '!=': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' }
const DATE_OP: Partial<Record<string, OperatorId>> = { '==': 'dateIs', '<': 'dateBefore', '>': 'dateAfter' }
const SCOPE_IDENTS = new Set(['note', 'file', 'formula', 'this'])

/** `note.x` / `file.x` / `formula.x` / `note["x"]` / bare `x` → canonical key; anything else null. */
function propertyOf(e: Expr): string | null {
  if (e.type === 'member' && e.object.type === 'ident' && SCOPE_IDENTS.has(e.object.name) && e.object.name !== 'this') {
    return `${e.object.name}.${e.name}`
  }
  if (e.type === 'index' && e.object.type === 'ident' && e.object.name === 'note' && e.index.type === 'str') return `note.${e.index.value}`
  if (e.type === 'ident' && !SCOPE_IDENTS.has(e.name)) return `note.${e.name}`
  return null
}

const strArg = (args: Expr[]): string | null => (args.length === 1 && args[0].type === 'str' ? args[0].value : null)

/** Every item as a string, or null the moment one is not — a hand-written `[1, "a"]` is no row. */
function strList(items: readonly Expr[]): string[] | null {
  const out: string[] = []
  for (const item of items) {
    if (item.type !== 'str') return null
    out.push(item.value)
  }
  return out
}

function methodRule(e: Expr): Rule | null {
  if (e.type !== 'method') return null
  if (e.name === 'contains' && e.object.type === 'list') {
    const value = strList(e.object.items)
    const property = e.args.length === 1 ? propertyOf(e.args[0]) : null
    return value === null || property === null ? null : { property, op: 'isAnyOf', value }
  }
  const property = propertyOf(e.object)
  if (property === null) return null
  if (e.name === 'isEmpty') return e.args.length === 0 ? { property, op: 'isEmpty', value: '' } : null
  if (e.name === 'containsAny' || e.name === 'containsAll') {
    const value = strList(e.args)
    return value === null ? null : { property, op: e.name === 'containsAny' ? 'hasAnyOf' : 'hasAllOf', value }
  }
  if (e.name === 'contains' || e.name === 'startsWith' || e.name === 'endsWith') {
    const value = strArg(e.args)
    return value === null ? null : { property, op: e.name, value }
  }
  return null
}

function numberOf(e: Expr): number | null {
  if (e.type === 'num') return e.value
  if (e.type === 'unary' && e.op === '-' && e.operand.type === 'num') return -e.operand.value
  return null
}

const ORDERING = new Set<OperatorId>(['lt', 'gt', 'le', 'ge', 'dateBefore', 'dateAfter'])

/** A plain comparison (`p == "x"`, `p < 3`, `p > date("…")`) as a rule; null otherwise. */
function binaryRule(e: Expr): Rule | null {
  if (e.type !== 'binary') return null
  const property = propertyOf(e.left)
  if (property === null) return null
  const r = e.right
  if (r.type === 'str') return e.op === '==' ? { property, op: 'is', value: r.value } : e.op === '!=' ? { property, op: 'isNot', value: r.value } : null
  if (r.type === 'bool') return e.op === '==' ? { property, op: r.value ? 'checked' : 'unchecked', value: '' } : null
  if (r.type === 'call' && r.name === 'date') {
    const value = strArg(r.args)
    const op = DATE_OP[e.op]
    return value !== null && op !== undefined ? { property, op, value } : null
  }
  const n = numberOf(r)
  const op = NUM_OP[e.op]
  return n !== null && op !== undefined ? { property, op, value: String(n) } : null
}

/**
 * Inverse of `ruleToExpr` for every string in its grammar; null for anything the builder cannot
 * show. An UNGUARDED ordering comparison (hand-written) still reads back as its rule — the menu's
 * next write normalizes it to the guarded form.
 */
export function exprToRule(src: string): Rule | null {
  const e = compile(src).expr
  if (e === undefined) return null
  if (e.type === 'method' && e.object.type === 'ident' && e.object.name === 'file') {
    const property = FILE_PROPERTY[e.name as OperatorId]
    const value = strArg(e.args)
    return property !== undefined && value !== null ? { property, op: e.name as OperatorId, value } : null
  }
  if (e.type === 'unary' && e.op === '!') {
    const inner = methodRule(e.operand)
    if (inner?.op === 'contains') return { ...inner, op: 'notContains' }
    if (inner?.op === 'isEmpty') return { ...inner, op: 'isNotEmpty' }
    if (inner?.op === 'isAnyOf') return { ...inner, op: 'isNoneOf' }
    if (inner?.op === 'hasAnyOf') return { ...inner, op: 'hasNoneOf' }
    return null
  }
  if (e.type === 'method') return methodRule(e)
  // The D5 guard: `!p.isEmpty() && p <op> v`, the form ruleToExpr writes for ordering operators.
  if (e.type === 'binary' && e.op === '&&') {
    const g = e.left
    if (g.type !== 'unary' || g.op !== '!') return null
    const guard = methodRule(g.operand)
    const rule = binaryRule(e.right)
    return guard?.op === 'isEmpty' && rule !== null && guard.property === rule.property && ORDERING.has(rule.op) ? rule : null
  }
  return binaryRule(e)
}

// ---------- filter trees ----------

export type Conjunction = 'and' | 'or' | 'not'

/** One level of a filter tree as the menu edits it: a conjunction over child nodes. */
export interface FilterGroup {
  conj: Conjunction
  items: FilterNode[]
}

/** Absent → empty `and`; a bare string → a one-item `and`; a map with one of and/or/not → that; anything odder → one raw item. */
export function toGroup(node: FilterNode | undefined): FilterGroup {
  if (node === undefined || node === null) return { conj: 'and', items: [] }
  if (typeof node === 'string') return { conj: 'and', items: [node] }
  const keys = (['and', 'or', 'not'] as const).filter(k => Object.hasOwn(node, k))
  if (keys.length === 1) {
    const items = (node as Record<string, unknown>)[keys[0]]
    if (Array.isArray(items)) return { conj: keys[0], items: items as FilterNode[] }
  }
  return { conj: 'and', items: [node] }
}

/** Always the explicit map form (`{ and: [...] }`); undefined when there are no items so the key is deleted. */
export function fromGroup(group: FilterGroup): FilterNode | undefined {
  if (group.items.length === 0) return undefined
  return { [group.conj]: group.items } as FilterNode
}

/** Leaf expressions in a filter tree (each `and`/`or`/`not` branch counts its children). */
export function countRules(node: FilterNode | undefined): number {
  if (node === undefined || node === null) return 0
  if (typeof node === 'string') return 1
  let n = 0
  for (const k of ['and', 'or', 'not'] as const) {
    const items = (node as Record<string, unknown>)[k]
    if (Array.isArray(items)) for (const child of items as FilterNode[]) n += countRules(child)
  }
  return n
}
