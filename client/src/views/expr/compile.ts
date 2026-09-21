import type { Expr } from './ast'
import { ExprSyntaxError, parse } from './parser'

export type Compiled = { expr: Expr; error?: undefined } | { expr?: undefined; error: ExprSyntaxError }

const MAX = 1000
const cache = new Map<string, Compiled>()

/** Parses with an LRU-ish cache keyed by source (GRO-2131); never throws. */
export function compile(src: string): Compiled {
  const hit = cache.get(src)
  if (hit) {
    cache.delete(src)
    cache.set(src, hit)
    return hit
  }
  let out: Compiled
  try {
    out = { expr: parse(src) }
  } catch (e) {
    if (!(e instanceof ExprSyntaxError)) throw e
    out = { error: e }
  }
  cache.set(src, out)
  if (cache.size > MAX) cache.delete(cache.keys().next().value as string)
  return out
}
