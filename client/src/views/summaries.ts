import { DateValue, DurationValue, ErrorValue, type Value, compile, equals, evaluate, isEmpty } from './expr'

/**
 * Column summaries for Bases views (GRO-2134). Built-ins follow Obsidian's table view; anything
 * else is looked up in the base's `summaries:` map and evaluated with `values` bound to the column.
 */
export const BUILTIN_SUMMARIES = [
  'Count', 'Empty', 'Filled', 'Unique', 'Average', 'Max', 'Median', 'Min', 'Range', 'Stddev', 'Sum', 'Earliest', 'Latest', 'Checked', 'Unchecked',
] as const

export type BuiltinSummary = (typeof BUILTIN_SUMMARIES)[number]

const numbers = (values: readonly Value[]): number[] => values.filter((v): v is number => typeof v === 'number')
const dates = (values: readonly Value[]): DateValue[] => values.filter((v): v is DateValue => v instanceof DateValue)
const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0)

function median(ns: number[]): number {
  const s = [...ns].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Population standard deviation. */
function stddev(ns: number[]): number {
  const mean = sum(ns) / ns.length
  return Math.sqrt(sum(ns.map(n => (n - mean) ** 2)) / ns.length)
}

/** Numeric kinds ignore non-numbers; no numbers → null. */
const numeric = (fn: (ns: number[]) => number) => (values: readonly Value[]): Value => {
  const ns = numbers(values)
  return ns.length ? fn(ns) : null
}

const extremeDate = (pick: (a: number, b: number) => number) => (values: readonly Value[]): Value => {
  const ds = dates(values)
  return ds.length ? ds.reduce((a, b) => (pick(a.ms, b.ms) === a.ms ? a : b)) : null
}

const BUILTINS: Record<BuiltinSummary, (values: readonly Value[]) => Value> = {
  Count: values => values.length,
  Empty: values => values.filter(isEmpty).length,
  Filled: values => values.filter(v => !isEmpty(v)).length,
  Unique: values => {
    const seen: Value[] = []
    for (const v of values) if (!isEmpty(v) && !seen.some(u => equals(u, v))) seen.push(v)
    return seen.length
  },
  Average: numeric(ns => sum(ns) / ns.length),
  Max: numeric(ns => Math.max(...ns)),
  Median: numeric(median),
  Min: numeric(ns => Math.min(...ns)),
  /** Numbers → number; otherwise dates → duration between earliest and latest. */
  Range: values => {
    const ns = numbers(values)
    if (ns.length) return Math.max(...ns) - Math.min(...ns)
    const ds = dates(values).map(d => d.ms)
    return ds.length ? new DurationValue(Math.max(...ds) - Math.min(...ds)) : null
  },
  Stddev: numeric(stddev),
  Sum: numeric(sum),
  Earliest: extremeDate(Math.min),
  Latest: extremeDate(Math.max),
  Checked: values => values.filter(v => v === true).length,
  Unchecked: values => values.filter(v => v === false).length,
}

const BUILTIN_BY_LOWER = new Map(BUILTIN_SUMMARIES.map(k => [k.toLowerCase(), k]))

/**
 * Summarises `values` (one per row, in row order) by `kind`: a built-in (case-insensitive) first,
 * else the `custom[kind]` expression (the base's `summaries:` map) with `values` bound to the
 * column, else an ErrorValue.
 */
export function summarize(kind: string, values: readonly Value[], custom?: Record<string, string>): Value {
  const builtin = BUILTIN_BY_LOWER.get(kind.toLowerCase())
  if (builtin) return BUILTINS[builtin](values)
  const src = custom && Object.hasOwn(custom, kind) ? custom[kind] : undefined
  if (src === undefined) return new ErrorValue(`unknown summary kind: ${kind}`)
  const compiled = compile(src)
  if (compiled.error) return new ErrorValue(`summary ${kind}: ${compiled.error.message}`)
  return evaluate(compiled.expr, { note: {}, file: null, formulas: {}, this: null, extra: { values: [...values] } })
}
