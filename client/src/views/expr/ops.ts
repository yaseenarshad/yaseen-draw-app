import type { BinaryOp } from './ast'
import { DateValue, DurationValue, ErrorValue, type Resolver, type Value, equals, render, typeOf } from './values'

/** Thrown by builtins on a bad argument; the evaluator turns it into an ErrorValue. */
export class ArgError extends Error {}

/** JS-style numeric coercion; dates and durations give their ms. */
export function toNumber(v: Value): number | ErrorValue {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === null) return 0
  if (typeof v === 'string') {
    const n = v.trim() === '' ? NaN : Number(v)
    return Number.isNaN(n) ? new ErrorValue(`${JSON.stringify(v)} is not a number`) : n
  }
  if (v instanceof DateValue || v instanceof DurationValue) return v.ms
  return new ErrorValue(`cannot use ${typeOf(v)} as a number`)
}

function toArith(v: Value): number | ErrorValue {
  const t = typeOf(v)
  if (t === 'number' || t === 'boolean' || t === 'null' || t === 'string') return toNumber(v)
  return new ErrorValue(`cannot do arithmetic on ${t}`)
}

function arith(op: '+' | '-' | '*' | '/' | '%', a: Value, b: Value): Value {
  const x = toArith(a)
  if (x instanceof ErrorValue) return x
  const y = toArith(b)
  if (y instanceof ErrorValue) return y
  switch (op) {
    case '+': return x + y
    case '-': return x - y
    case '*': return x * y
    case '/': return y === 0 ? new ErrorValue('division by zero') : x / y
    case '%': return y === 0 ? new ErrorValue('division by zero') : x % y
  }
}

function add(a: Value, b: Value): Value {
  if (typeof a === 'string' || typeof b === 'string') return render(a) + render(b)
  if (a instanceof DateValue && b instanceof DurationValue) return new DateValue(a.ms + b.ms, a.hasTime)
  if (a instanceof DurationValue && b instanceof DateValue) return new DateValue(a.ms + b.ms, b.hasTime)
  if (a instanceof DurationValue && b instanceof DurationValue) return new DurationValue(a.ms + b.ms)
  return arith('+', a, b)
}

function subtract(a: Value, b: Value): Value {
  if (a instanceof DateValue && b instanceof DateValue) return new DurationValue(a.ms - b.ms)
  if (a instanceof DateValue && b instanceof DurationValue) return new DateValue(a.ms - b.ms, a.hasTime)
  if (a instanceof DurationValue && b instanceof DurationValue) return new DurationValue(a.ms - b.ms)
  return arith('-', a, b)
}

function compare(op: '<' | '>' | '<=' | '>=', a: Value, b: Value): Value {
  let x: number | string
  let y: number | string
  if (typeof a === 'string' && typeof b === 'string') {
    x = a
    y = b
  } else {
    const nx = toNumber(a)
    if (nx instanceof ErrorValue) return nx
    const ny = toNumber(b)
    if (ny instanceof ErrorValue) return ny
    x = nx
    y = ny
  }
  switch (op) {
    case '<': return x < y
    case '>': return x > y
    case '<=': return x <= y
    case '>=': return x >= y
  }
}

/** Every non-short-circuit binary operator; operands are already evaluated and error-free. `resolve` tightens link equality (GRO-2132). */
export function binaryOp(op: Exclude<BinaryOp, '&&' | '||'>, a: Value, b: Value, resolve?: Resolver): Value {
  switch (op) {
    case '+': return add(a, b)
    case '-': return subtract(a, b)
    case '*': case '/': case '%': return arith(op, a, b)
    case '==': return equals(a, b, resolve)
    case '!=': return !equals(a, b, resolve)
    default: return compare(op, a, b)
  }
}
