import type { IndexRecord } from '@shared/types'
import { type ViewSet, type ViewDef, type FilterNode, type GroupBySpec, groupByLevels } from './viewSchema'
import {
  DateValue, DurationValue, ErrorValue, type Expr, FileValue, LinkValue, type Resolver, type Scope, type Value,
  compile, equals, evaluate, fromYaml, isTruthy, render, stripBrackets,
} from './expr'
import { summarize } from './summaries'

/**
 * Query engine for one Bases view (GRO-2133): filters → values → sort → limit → group → summaries
 * (GRO-2134), all over `IndexRecord`s, pure and DOM-free. Never throws: expression problems land
 * in cells as ErrorValues and compile errors in `errors`.
 */

export interface Row {
  record: IndexRecord
  file: FileValue
  /** Keyed by the property key as written in the view (`file.name`, `status`, `note.status`, `formula.x`). */
  values: Record<string, Value>
}

export interface Group {
  /** A declared Select option supplies the destination even when this group has no rows. */
  optionValue?: string
  /** null for the trailing "No value" group. */
  key: Value | null
  label: string
  /** EVERY row under the group — with two levels that is `direct` plus every child's rows. */
  rows: Row[]
  summaries: Record<string, Value>
  /**
   * True when the grouping property held a LIST somewhere and rows were fanned out per element
   * (YAZ-671 D1) — so one row can appear in several groups, and the group counts can sum above
   * `total` (D2, deliberate). Consumers that write back through group identity read this.
   */
  fannedOut: boolean
  /**
   * The inner groups (YAZ-745): present — possibly empty — on every group when the view groups on
   * two levels, absent in single-level mode. A child never has children of its own.
   */
  children?: Group[]
  /** The rows the merge rule keeps directly under this group; same presence rule as `children`. */
  direct?: Row[]
}

export interface EngineError {
  /** `filters`, `views[0].filters[1]`, `formula.ppu`, … */
  where: string
  message: string
}

export interface ViewResult {
  rows: Row[]
  /** null when the view has no `groupBy`. */
  groups: Group[] | null
  summaries: Record<string, Value>
  errors: EngineError[]
  /** Rows passing the filters, before `limit`. */
  total: number
}

export interface RunOptions {
  /** The folder page's declared column names — shown by default before any member carries them (YAZ-1549). */
  declared?: readonly string[]
  /** Absolute path of the note embedding the base; `this` in expressions. */
  thisFile?: string | null
  /** Vault root; lets link targets written as `<root>/…` resolve. */
  root?: string
  /**
   * The resolver every link in this run resolves through (🔒 D2, YAZ-819). Absent — every caller
   * caller — keeps today's behaviour exactly: one built from `records`, which for a base IS the
   * vault. A FOLDER PAGE's contents pass only the MEMBERS as rows and inject the FULL-VAULT
   * resolver here, so a link cell pointing outside the members still resolves.
   */
  resolve?: Resolver
}

/** Value of one property key for one row's scope. */
type Getter = (scope: Scope) => Value

/** A row plus the scope it evaluates in and the lazily computed values outside `view.order`. */
interface Entry {
  row: Row
  scope: Scope
  cache: Map<string, Value>
}

const NO_VALUE = 'No value'

// ---------- link resolution (GRO-2132) ----------

const normalise = (s: string) => s.replace(/^\/+|\/+$/g, '').replace(/\.(md|markdown)$/, '').toLowerCase()

/** `makeResolver` / `resolverFor` knobs; every field is optional and defaults to today's behaviour. */
export interface ResolverOptions {
  /**
   * Consult frontmatter `aliases` (default true, E2 GRO-2214). `false` builds a NAME-ONLY
   * resolver — the rename engine's referencing-set probe (`links/renameLinks.ts`), which must
   * not treat an alias-form link as a reference to rewrite: the alias lives in the moved file's
   * own frontmatter and travels with it.
   */
  aliases?: boolean
}

/**
 * Link target → note: absolute path, root-relative path (with or without `.md` / leading slash),
 * bare basename — duplicates resolve to the SHALLOWEST folder (Obsidian's shortest-path rule,
 * GRO-2190), equal depth to the first in the given (path-sorted) order — and finally a
 * frontmatter ALIAS (E2, GRO-2214), by the same shallowest-then-first rule, so a real name
 * always beats an alias. Case-insensitive; `[[…]]`, `|alias` and `#heading` are stripped.
 */
export function makeResolver(files: readonly FileValue[], root?: string, opts: ResolverOptions = {}): Resolver {
  const byPath = new Map<string, FileValue>()
  const byRel = new Map<string, FileValue>()
  const byBase = new Map<string, { file: FileValue; depth: number }>()
  const byAlias = new Map<string, { file: FileValue; depth: number }>()
  const shallowest = (map: Map<string, { file: FileValue; depth: number }>, key: string, file: FileValue, depth: number) => {
    const prev = map.get(key)
    if (prev === undefined || depth < prev.depth) map.set(key, { file, depth })
  }
  for (const f of files) {
    const r = f.record
    byPath.set(r.path.toLowerCase(), f)
    const rel = normalise(r.folder ? `${r.folder}/${r.basename}` : r.basename)
    if (!byRel.has(rel)) byRel.set(rel, f)
    const depth = r.folder === '' ? 0 : r.folder.split('/').length
    shallowest(byBase, r.basename.toLowerCase(), f, depth)
    if (opts.aliases !== false) for (const alias of r.aliases) shallowest(byAlias, alias.toLowerCase(), f, depth)
  }
  const rootKey = root ? `${root.replace(/\/+$/, '').toLowerCase()}/` : null
  const cache = new Map<string, FileValue | null>()
  return target => {
    const hit = cache.get(target)
    if (hit !== undefined) return hit
    const key = stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()
    let found: FileValue | null = null
    if (key) {
      found = byPath.get(key) ?? null
      if (!found) {
        const rel = normalise(rootKey && key.startsWith(rootKey) ? key.slice(rootKey.length) : key)
        found = byRel.get(rel) ?? (rel.includes('/') ? null : byBase.get(rel)?.file ?? null)
      }
      // Aliases last: a page named `CAC` always wins the target `CAC` over one merely aliased so.
      if (!found) found = byAlias.get(key)?.file ?? null
    }
    cache.set(target, found)
    return found
  }
}

/** FileValue wrappers per records array identity — `runView` and `resolverFor` share the instances. */
const filesCache = new WeakMap<readonly IndexRecord[], FileValue[]>()

function fileValuesFor(records: readonly IndexRecord[]): FileValue[] {
  let files = filesCache.get(records)
  if (files === undefined) filesCache.set(records, (files = records.map(r => new FileValue(r))))
  return files
}

const resolverCache = new WeakMap<readonly IndexRecord[], Map<string, Resolver>>()

/**
 * Memoized `makeResolver` per records array identity (and per root, per alias mode): `runView`
 * and the editor's wikilink decorations (GRO-2190) both resolve on every run/render, so one
 * index snapshot must not rebuild the lookup maps each time. A refetched index is a NEW array
 * and gets a fresh resolver; the WeakMap lets dropped snapshots be collected. The per-instance
 * target cache inside `makeResolver` is unchanged.
 */
export function resolverFor(records: readonly IndexRecord[], root?: string, opts: ResolverOptions = {}): Resolver {
  let byRoot = resolverCache.get(records)
  if (byRoot === undefined) resolverCache.set(records, (byRoot = new Map()))
  const key = `${opts.aliases === false ? 'names:' : ''}${root ?? ''}`
  let resolver = byRoot.get(key)
  if (resolver === undefined) byRoot.set(key, (resolver = makeResolver(fileValuesFor(records), root, opts)))
  return resolver
}

// ---------- filters ----------

type Predicate = (scope: Scope) => boolean

/**
 * Compiles a filter tree once. Any compile error or malformed node is reported at its path
 * (`<where>[i]` per child) and makes the whole filter reject every row.
 */
function compileFilter(node: FilterNode | undefined, where: string, errors: EngineError[]): Predicate | null {
  if (node === undefined || node === null) return null
  let broken = false
  const fail = (at: string, message: string): Predicate => {
    broken = true
    errors.push({ where: at, message })
    return () => false
  }
  const build = (n: FilterNode, at: string): Predicate => {
    if (typeof n === 'string') {
      const compiled = compile(n)
      if (compiled.error) return fail(at, compiled.error.message)
      const expr = compiled.expr
      return scope => isTruthy(evaluate(expr, scope))
    }
    if (!n || typeof n !== 'object') return fail(at, 'filter must be a string or an and/or/not map')
    const parts: Predicate[] = []
    for (const op of ['and', 'or', 'not'] as const) {
      if (!Object.hasOwn(n, op)) continue
      const children = (n as Record<string, unknown>)[op]
      if (!Array.isArray(children)) return fail(at, `${op} must be a list`)
      const preds = (children as FilterNode[]).map((c, i) => build(c, `${at}[${i}]`))
      if (op === 'and') parts.push(scope => preds.every(p => p(scope)))
      else if (op === 'or') parts.push(scope => preds.some(p => p(scope)))
      else parts.push(scope => !preds.some(p => p(scope)))
    }
    if (!parts.length) return fail(at, 'filter must be a string or an and/or/not map')
    return parts.length === 1 ? parts[0] : scope => parts.every(p => p(scope))
  }
  const pred = build(node, where)
  return broken ? () => false : pred
}

// ---------- property values ----------

const member = (object: string, name: string): Expr => ({ type: 'member', object: { type: 'ident', name: object, pos: 0 }, name, pos: 0 })

/**
 * `file.x` → file field, `formula.x` → formula (a compile error is reported once at `formula.x`
 * and the cell is an ErrorValue; an unknown formula is the evaluator's ErrorValue, no report),
 * anything else → note property (`note.` optional) through `fromYaml`.
 */
function makeGetter(key: string, def: ViewSet, errors: EngineError[]): Getter {
  if (key.startsWith('file.')) {
    const expr = member('file', key.slice(5))
    return scope => evaluate(expr, scope)
  }
  if (key.startsWith('formula.')) {
    const name = key.slice(8)
    const src = def.formulas?.[name]
    if (src !== undefined) {
      const compiled = compile(src)
      if (compiled.error && !errors.some(e => e.where === key)) errors.push({ where: key, message: compiled.error.message })
    }
    const expr = member('formula', name)
    return scope => evaluate(expr, scope)
  }
  const name = key.startsWith('note.') ? key.slice(5) : key
  return scope => fromYaml(Object.hasOwn(scope.note, name) ? scope.note[name] : undefined)
}

// ---------- ordering ----------

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

const isMissing = (v: Value | undefined): boolean => v === undefined || v === null || v instanceof ErrorValue

/** Lists sort by their first element; an empty list counts as missing. */
const sortKey = (v: Value | undefined): Value | undefined => (Array.isArray(v) ? (v.length ? sortKey(v[0]) : null) : v)

const rank = (v: Value): number => {
  if (typeof v === 'number') return 0
  if (v instanceof DateValue) return 1
  if (v instanceof DurationValue) return 2
  if (typeof v === 'string') return 3
  if (typeof v === 'boolean') return 4
  if (v instanceof LinkValue) return 5
  if (v instanceof FileValue) return 6
  return 7
}

/**
 * Type-aware comparison: numbers numeric, dates/durations by ms, strings natural and
 * case-insensitive, booleans false < true, links by target, files by basename; mixed types by
 * rank. Missing (null / undefined / error) always sorts last whatever the direction.
 */
function compareValues(a: Value | undefined, b: Value | undefined, direction: 'ASC' | 'DESC' = 'ASC'): number {
  const x = sortKey(a)
  const y = sortKey(b)
  const mx = isMissing(x)
  const my = isMissing(y)
  if (mx || my) return mx && my ? 0 : mx ? 1 : -1
  const sign = direction === 'DESC' ? -1 : 1
  const rx = rank(x as Value)
  const ry = rank(y as Value)
  if (rx !== ry) return sign * (rx - ry)
  let c = 0
  if (typeof x === 'number') c = x - (y as number)
  else if (x instanceof DateValue || x instanceof DurationValue) c = x.ms - (y as DateValue | DurationValue).ms
  else if (typeof x === 'string') c = collator.compare(x, y as string)
  else if (typeof x === 'boolean') c = Number(x) - Number(y)
  else if (x instanceof LinkValue) c = collator.compare(x.target, (y as LinkValue).target)
  else if (x instanceof FileValue) c = collator.compare(x.record.basename, (y as FileValue).record.basename)
  return sign * c
}

const byPath = (a: Entry, b: Entry): number => (a.row.record.path < b.row.record.path ? -1 : a.row.record.path > b.row.record.path ? 1 : 0)

// ---------- grouping ----------

const isNoValue = (v: Value): boolean => v === null || v === '' || v instanceof ErrorValue || (Array.isArray(v) && v.length === 0)

// ---------- public API ----------

/**
 * `view.order` if set, else `file.name` plus every note property key seen OR declared, sorted, as
 * `note.<key>`. `declared` is the folder page's own column names (YAZ-1549): a declared column is
 * a column before any member carries it, so a newborn page shows its `status` at once.
 */
export function propertyKeys(_def: ViewSet, view: ViewDef, records: readonly IndexRecord[], declared: readonly string[] = []): string[] {
  if (view.order) return [...view.order]
  const keys = new Set<string>(declared.map((k) => `note.${k}`))
  for (const r of records) for (const k of Object.keys(r.properties)) keys.add(`note.${k}`)
  return ['file.name', ...[...keys].sort()]
}

/**
 * The label a key wears with no `displayName` (YAZ-1513): the `file.*` fields have their own
 * table (`file.mtime` → "Modified"); every other key is its last dotted segment in sentence case,
 * underscores read as spaces — `note.kpi_category` → "Kpi category", `formula.score` → "Score".
 * The KEY is never touched.
 */
export function defaultLabel(key: string): string {
  const file = FILE_FIELD_LABELS[key]
  if (file !== undefined) return file
  const last = key.slice(key.lastIndexOf('.') + 1).replaceAll('_', ' ')
  return last.charAt(0).toUpperCase() + last.slice(1)
}

/** The `file.*` fields' labels (YAZ-1549) — the ones sentence case would get wrong or leave terse. */
const FILE_FIELD_LABELS: Readonly<Record<string, string>> = {
  'file.name': 'Name',
  'file.basename': 'Base name',
  'file.path': 'Path',
  'file.folder': 'Folder',
  'file.ext': 'Extension',
  'file.size': 'Size',
  'file.ctime': 'Created',
  'file.mtime': 'Modified',
  'file.tags': 'Tags',
  'file.links': 'Links',
  'file.embeds': 'Embeds',
}

/** `def.properties[key].displayName` (looked up as written, bare and `note.`-prefixed), else `defaultLabel(key)`. */
export function propertyLabel(def: ViewSet, key: string): string {
  const bare = key.startsWith('note.') ? key.slice(5) : key
  const props = def.properties
  return props?.[key]?.displayName ?? props?.[bare]?.displayName ?? props?.[`note.${bare}`]?.displayName ?? defaultLabel(key)
}

export function runView(def: ViewSet, view: ViewDef, records: readonly IndexRecord[], opts: RunOptions = {}): ViewResult {
  const errors: EngineError[] = []
  const viewIndex = def.views.indexOf(view)
  const viewWhere = viewIndex >= 0 ? `views[${viewIndex}]` : 'view'
  const files = fileValuesFor(records)
  const resolve = opts.resolve ?? resolverFor(records, opts.root)
  const thisFile = opts.thisFile ? files.find(f => f.record.path === opts.thisFile) ?? null : null
  const formulas = def.formulas ?? {}
  const baseFilter = compileFilter(def.filters, 'filters', errors)
  const viewFilter = compileFilter(view.filters, `${viewWhere}.filters`, errors)

  const getters = new Map<string, Getter>()
  const getter = (key: string): Getter => {
    let g = getters.get(key)
    if (!g) getters.set(key, (g = makeGetter(key, def, errors)))
    return g
  }
  const valueOf = (entry: Entry, key: string): Value => {
    if (Object.hasOwn(entry.row.values, key)) return entry.row.values[key]
    let v = entry.cache.get(key)
    if (v === undefined) entry.cache.set(key, (v = getter(key)(entry.scope)))
    return v
  }

  // filters
  const entries: Entry[] = []
  for (let i = 0; i < records.length; i++) {
    const scope: Scope = { note: records[i].properties, file: files[i], formulas, this: thisFile, resolve }
    if (baseFilter && !baseFilter(scope)) continue
    if (viewFilter && !viewFilter(scope)) continue
    entries.push({ row: { record: records[i], file: files[i], values: {} }, scope, cache: new Map() })
  }

  // values
  const keys = propertyKeys(def, view, records, opts.declared)
  const columnGetters = keys.map(k => [k, getter(k)] as const)
  for (const entry of entries) for (const [k, g] of columnGetters) entry.row.values[k] = g(entry.scope)

  // sort (stable: path breaks ties)
  const sort = (view.sort ?? []).filter(s => s && typeof s.property === 'string')
  if (sort.length) {
    const sortValues = new Map<Entry, Value[]>(entries.map(e => [e, sort.map(s => valueOf(e, s.property))]))
    entries.sort((a, b) => {
      const va = sortValues.get(a)!
      const vb = sortValues.get(b)!
      for (let i = 0; i < sort.length; i++) {
        const c = compareValues(va[i], vb[i], sort[i].direction === 'DESC' ? 'DESC' : 'ASC')
        if (c) return c
      }
      return byPath(a, b)
    })
  }

  // limit
  const total = entries.length
  const limit = typeof view.limit === 'number' && view.limit > 0 ? Math.floor(view.limit) : null
  const kept = limit === null ? entries : entries.slice(0, limit)

  // group
  const summaryOf = (list: Entry[]): Record<string, Value> => {
    const out: Record<string, Value> = {}
    for (const [prop, kind] of Object.entries(view.summaries ?? {})) {
      if (typeof kind !== 'string') continue
      out[prop] = summarize(kind, list.map(e => valueOf(e, prop)), def.summaries)
    }
    return out
  }
  /** One level over `list`: its distinct keys in the level's direction, then the value-less entries. */
  const bucket = (list: Entry[], { property, direction }: GroupBySpec) => {
    const valued: { key: Value; entries: Entry[] }[] = []
    const noValue: Entry[] = []
    let fannedOut = false
    for (const entry of list) {
      const key = valueOf(entry, property)
      if (isNoValue(key)) {
        noValue.push(entry)
        continue
      }
      // Scalar grouping is the common case and keeps the original single-lookup path — wrapping
      // every value in a throwaway array here cost 4-6x on the 1000-record budget under load.
      if (!Array.isArray(key)) {
        const g = valued.find(x => equals(x.key, key))
        if (g) g.entries.push(entry)
        else valued.push({ key, entries: [entry] })
        continue
      }
      // A LIST fans out: the entry joins one group per DISTINCT non-empty element (D1), so a note
      // in two funnels shows under both instead of forming a combination group. Empty elements are
      // dropped, and a list left with none falls to "No value" exactly as `[]` already does.
      fannedOut = true
      let joined = 0
      for (let i = 0; i < key.length; i++) {
        const k = key[i]
        if (isNoValue(k)) continue
        let seen = false
        for (let j = 0; j < i; j++) if (equals(key[j], k)) { seen = true; break }
        if (seen) continue
        joined++
        const g = valued.find(x => equals(x.key, k))
        if (g) g.entries.push(entry)
        else valued.push({ key: k, entries: [entry] })
      }
      if (joined === 0) noValue.push(entry)
    }
    valued.sort((a, b) => compareValues(a.key, b.key, direction === 'DESC' ? 'DESC' : 'ASC'))
    return { valued, noValue, fannedOut }
  }
  const groupOf = (key: Value | null, entries: Entry[], fannedOut: boolean): Group =>
    ({ key, label: key === null ? NO_VALUE : render(key), rows: entries.map(e => e.row), summaries: summaryOf(entries), fannedOut })

  let groups: Group[] | null = null
  // Levels past the second are ignored in v1 (YAZ-745); a level without a property name is not one.
  const levels = groupByLevels(view).filter(g => g && typeof g.property === 'string').slice(0, 2)
  if (levels.length) {
    const outer = bucket(kept, levels[0])
    const branches: { key: Value | null; entries: Entry[] }[] = [...outer.valued]
    if (outer.noValue.length) branches.push({ key: null, entries: outer.noValue })
    if (levels.length === 1) {
      groups = branches.map(b => groupOf(b.key, b.entries, outer.fannedOut))
    } else {
      const nested = branches.map(b => ({ ...b, inner: bucket(b.entries, levels[1]) }))
      // Fan-out is a flag per LEVEL, not per branch: one list anywhere inside marks every inner group.
      const innerFanned = nested.some(b => b.inner.fannedOut)
      groups = nested.map(b => {
        // MERGE RULE (YAZ-745): an inner key equal to its outer's is no child — its rows sit
        // DIRECTLY under the outer, as do the value-less rows of a "No value" outer, which
        // therefore never carries a "No value" child.
        const merges = (key: Value): boolean => b.key !== null && equals(key, b.key)
        const children = b.inner.valued.filter(x => !merges(x.key)).map(x => groupOf(x.key, x.entries, innerFanned))
        if (b.key !== null && b.inner.noValue.length) children.push(groupOf(null, b.inner.noValue, innerFanned))
        const direct = b.key === null ? b.inner.noValue : b.inner.valued.filter(x => merges(x.key)).flatMap(x => x.entries)
        return { ...groupOf(b.key, b.entries, outer.fannedOut), children, direct: direct.map(e => e.row) }
      })
    }
  }

  return { rows: kept.map(e => e.row), groups, summaries: summaryOf(kept), errors, total }
}
