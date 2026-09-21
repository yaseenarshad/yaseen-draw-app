import type { IndexRecord } from '@shared/types'
import type { ViewSet, ViewDef } from '../viewSchema'
import type { ColumnDecl } from '../folderPageSettings'
import { propertyKeys, propertyLabel } from '../engine'
import { canonicalKey } from './keys'

/**
 * Every key the menus can offer (GRO-2135): the view's shown keys first (as written, so
 * `view.order` round-trips), then `file.name` + every note key seen or declared on the folder page
 * (YAZ-895 — a DECLARED column is offerable before any member carries a value for it; since
 * YAZ-1549 `propertyKeys` itself shows it by default), then the formulas; de-duplicated by canonical key.
 */
export function allPropertyKeys(
  def: ViewSet,
  view: ViewDef,
  records: readonly IndexRecord[],
  columns: Record<string, ColumnDecl> = {},
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (key: string) => {
    const c = canonicalKey(key)
    if (seen.has(c)) return
    seen.add(c)
    out.push(key)
  }
  const declared = Object.keys(columns)
  for (const k of propertyKeys(def, view, records, declared)) add(k)
  for (const k of propertyKeys(def, { ...view, order: undefined }, records, declared)) add(k)
  for (const name of Object.keys(def.formulas ?? {})) add(`formula.${name}`)
  return out
}

/** `keys` plus `extra` (first) when missing, so a select always lists its current value. */
function withKey(keys: readonly string[], extra: string): string[] {
  return keys.some(k => canonicalKey(k) === canonicalKey(extra)) ? [...keys] : [extra, ...keys]
}

/** Picker options for `keys` (+ `current` first when missing): canonical value, display label (YAZ-1466). */
export function propertyOptions(def: ViewSet, keys: readonly string[], current?: string): { value: string; label: string }[] {
  return (current ? withKey(keys, current) : keys).map((k) => ({ value: canonicalKey(k), label: propertyLabel(def, k) }))
}
