import { useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import type { ViewSet, ViewDef, FilterNode, Mutate } from '../viewSchema'
import { type ColumnTyping, columnTyping } from '../editorType'
import type { FolderPageMode } from '../ViewsPane'
import type { EngineError } from '../engine'
import { stripBrackets } from '../expr'
import {
  type Conjunction, type FilterGroup, type OperatorId, type Rule, exprToRule, fromGroup, inferType, operator,
  operatorsFor, ruleToExpr, toGroup,
} from './filterRows'
import { ColumnPicker } from './ColumnPicker'
import { canonicalKey } from './keys'
import { allPropertyKeys, propertyOptions } from './properties'
import { TextField } from './TextField'

export interface FilterMenuProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  /** The engine's `*.filters` errors, listed at the top of the menu (YAZ-1229). */
  errors: readonly EngineError[]
  /** The vault-wide declarations, for the typing ladder behind the operator list (D4). */
  properties: PropertiesResponse | null
  /** The folder page's own declarations — that ladder's TOP rung (🔒 Q8, YAZ-895). */
  folderPage: FolderPageMode
  onUpdate: Mutate
}

const CONJUNCTIONS: { id: Conjunction; label: string }[] = [
  { id: 'and', label: 'All' },
  { id: 'or', label: 'Any' },
  { id: 'not', label: 'None' },
]

/** The three file-method pseudo-properties are only meaningful here, so they join the property list. */
const FILE_EXTRAS = ['file.tags', 'file.folder', 'file.links']

/** A fresh rule matches every row, so adding one never blanks the view before it is filled in. */
const NEW_RULE: Rule = { property: 'file.name', op: 'contains', value: '' }

/** A long DATALIST defeats its own purpose (YAZ-1232); the searchable checklist takes every value (YAZ-1469). */
const SUGGESTION_LIMIT = 50

/**
 * A REAL nested conjunction — exactly one of and/or/not over a non-empty array — as opposed to
 * `toGroup`'s one-item fallback, which wraps any odder map so nothing is ever destroyed.
 */
function groupNode(item: FilterNode): FilterGroup | null {
  if (typeof item === 'string') return null
  const keys = (['and', 'or', 'not'] as const).filter((k) => Object.hasOwn(item, k))
  if (keys.length !== 1) return null
  const items = (item as Record<string, unknown>)[keys[0]]
  return Array.isArray(items) && items.length > 0 ? { conj: keys[0], items: items as FilterNode[] } : null
}

/**
 * Filter menu (GRO-2135), back from the YAZ-846 amputation (YAZ-1218 / YAZ-1227): conjunction
 * (All / Any / None → and / or / not), builder rows, Advanced raw expressions, and the engine's
 * own `filters` errors at the top (YAZ-1229). PER-VIEW only (D1, 🔒 Q3 amended): a folder page's
 * set IS the lookup, so `def.filters` has no editor here and the scope segment did not come back.
 * ONE level of nesting is editable (YAZ-1231) — a top-level conjunction is a group block with its
 * own conjunction, rows and Add rule, while anything deeper stays the read-only raw row — and a
 * text value offers the values the vault already holds for its property (YAZ-1232).
 */
export function FilterMenu({ def, view, viewIndex, records, errors, properties, folderPage, onUpdate }: FilterMenuProps) {
  const [advanced, setAdvanced] = useState(false)
  const [pendingConj, setPendingConj] = useState<Conjunction>('and')
  const group = toGroup(view.filters)
  const conj = group.items.length ? group.conj : pendingConj
  const keys = [...allPropertyKeys(def, view, records, folderPage.settings.columns), ...FILE_EXTRAS]
  /** The column's rung of the typing ladder (D4), the same one the table's cell editors read. */
  const typingOf = (property: string): ColumnTyping => columnTyping(property, records, properties, folderPage.settings)

  const write = (next: FilterGroup) =>
    onUpdate((d) => {
      const node = fromGroup(next)
      if (node === undefined) delete d.views[viewIndex].filters
      else d.views[viewIndex].filters = node
    })
  const setItem = (i: number, item: FilterNode) => write({ conj, items: group.items.map((x, j) => (j === i ? item : x)) })
  const removeItem = (i: number) => write({ conj, items: group.items.filter((_, j) => j !== i) })
  const setConj = (c: Conjunction) => {
    setPendingConj(c)
    if (group.items.length) write({ conj: c, items: group.items })
  }

  /** Changes one field, re-validating the operator for the property's type and clearing a value of another kind. */
  const setRule = (i: number, rule: Rule, patch: Partial<Rule>, setAt: (i: number, item: FilterNode) => void) => {
    const next = { ...rule, ...patch }
    const ops = operatorsFor(next.property, inferType(next.property, records, typingOf(next.property)))
    if (patch.property !== undefined && !ops.some((o) => o.id === next.op)) next.op = ops[0]?.id ?? next.op
    if (operator(next.op).value !== operator(rule.op).value) next.value = operator(next.op).value === 'options' ? [] : ''
    setAt(i, ruleToExpr(next))
  }

  /** The values `records` already hold for one property, distinct and in first-seen order (YAZ-1232). */
  const suggestionsFor = (property: string, limit = SUGGESTION_LIMIT): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (s: string) => {
      if (s === '' || seen.has(s) || out.length >= limit) return
      seen.add(s)
      out.push(s)
    }
    if (property === 'file.tags') for (const r of records) for (const tag of r.tags) add(tag)
    else if (property === 'file.folder') for (const r of records) add(r.folder)
    else if (property === 'file.links') for (const r of records) for (const link of r.links) add(link)
    else if (!property.startsWith('file.') && !property.startsWith('formula.')) {
      for (const option of typingOf(property)?.options ?? []) add(option)
      const bare = property.startsWith('note.') ? property.slice(5) : property
      for (const r of records) {
        const raw = r.properties[bare]
        if (typeof raw === 'string') add(stripBrackets(raw))
        else if (Array.isArray(raw)) for (const v of raw) if (typeof v === 'string') add(stripBrackets(v))
      }
    }
    return out
  }

  /** The property's known values, plus any tick it lacks so a hand-edited one still shows (YAZ-1467). */
  const valueOptions = (property: string, picks: readonly string[]) => {
    const known = suggestionsFor(property, Infinity)
    return [...picks.filter((v) => !known.includes(v)), ...known].map((value) => ({ value, label: value }))
  }

  const ruleRow = (rule: Rule, i: number, setAt: (i: number, item: FilterNode) => void, path: string) => {
    const type = inferType(rule.property, records, typingOf(rule.property))
    const ops = operatorsFor(rule.property, type)
    const opList = ops.some((o) => o.id === rule.op) ? ops : [...ops, operator(rule.op)]
    const kind = operator(rule.op).value
    const picks = Array.isArray(rule.value) ? rule.value : []
    const suggestions = kind === 'text' ? suggestionsFor(rule.property) : []
    const listId = `filter-sugg-${viewIndex}-${path}`
    return (
      <>
        <ColumnPicker
          label="Property"
          value={canonicalKey(rule.property)}
          options={propertyOptions(def, keys, rule.property)}
          onChange={(value) => setRule(i, rule, { property: value }, setAt)}
        />
        <select
          className="view-select"
          aria-label="Operator"
          value={rule.op}
          onChange={(e) => setRule(i, rule, { op: e.target.value as OperatorId }, setAt)}
        >
          {opList.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {kind === 'options' ? (
          <ColumnPicker
            multiple
            noun="options"
            label="Value"
            value={picks}
            options={valueOptions(rule.property, picks)}
            onChange={(value) => setRule(i, rule, { value }, setAt)}
          />
        ) : kind !== 'none' && (
          <TextField
            className="view-input"
            aria-label="Value"
            type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}
            inputMode={kind === 'number' ? 'decimal' : undefined}
            list={suggestions.length > 0 ? listId : undefined}
            value={typeof rule.value === 'string' ? rule.value : ''}
            onCommit={(value) => setRule(i, rule, { value }, setAt)}
          />
        )}
        {suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </>
    )
  }

  /** One rule row; `setAt`/`removeAt` write at ITS level, so a group's rows edit the group (YAZ-1231). */
  const row = (item: FilterNode, i: number, setAt: (i: number, item: FilterNode) => void, removeAt: (i: number) => void, path: string) => {
    const rule = typeof item === 'string' ? exprToRule(item) : null
    const raw = typeof item === 'string' ? item : JSON.stringify(item)
    return (
      <li key={i} className="view-rule">
        <div className="view-rule__main">
          {rule ? ruleRow(rule, i, setAt, path) : <code className="view-rule__code">{raw}</code>}
          <button type="button" className="view-rule__remove" aria-label="Remove rule" title="Remove rule" onClick={() => removeAt(i)}>
            ×
          </button>
        </div>
        {advanced && typeof item === 'string' && (
          <TextField className="view-input view-rule__expr" aria-label="Expression" value={item} onCommit={(expr) => setAt(i, expr)} />
        )}
      </li>
    )
  }

  /** The All / Any / None segmented control, at either level. */
  const seg = (label: string, current: Conjunction, pick: (c: Conjunction) => void) => (
    <div className="view-seg" role="group" aria-label={label}>
      {CONJUNCTIONS.map((c) => (
        <button key={c.id} type="button" className="view-seg__opt" aria-pressed={current === c.id} onClick={() => pick(c.id)}>
          {c.label}
        </button>
      ))}
    </div>
  )

  /**
   * One nested group (YAZ-1231): its own conjunction over its own rows, written back through the
   * top level's `setItem`. Emptying it removes it, so a group is never left as a dangling key.
   * Its rows go through `row`, which knows nothing of groups — that is what keeps nesting to one
   * level: a map INSIDE a group is a plain raw row, never a second group block.
   */
  const groupRow = (nested: FilterGroup, i: number) => {
    const writeGroup = (next: FilterGroup) => {
      const node = fromGroup(next)
      if (node === undefined) removeItem(i)
      else setItem(i, node)
    }
    const setAt = (j: number, item: FilterNode) => writeGroup({ ...nested, items: nested.items.map((x, k) => (k === j ? item : x)) })
    const removeAt = (j: number) => writeGroup({ ...nested, items: nested.items.filter((_, k) => k !== j) })
    return (
      <li key={i} className="view-rule-group">
        <div className="view-rule-group__head">
          {seg('Match (group)', nested.conj, (c) => writeGroup({ ...nested, conj: c }))}
          <button type="button" className="view-rule__remove" aria-label="Remove group" title="Remove group" onClick={() => removeItem(i)}>
            ×
          </button>
        </div>
        <ul className="view-menu__list">{nested.items.map((item, j) => row(item, j, setAt, removeAt, `${i}-${j}`))}</ul>
        <button
          type="button"
          className="view-menu__action"
          onClick={() => writeGroup({ ...nested, items: [...nested.items, ruleToExpr(NEW_RULE)] })}
        >
          Add rule
        </button>
      </li>
    )
  }

  return (
    <div className="view-menu filter-menu">
      {errors.length > 0 && (
        <ul className="view-menu__errors" role="alert">
          {errors.map((e, i) => (
            <li key={i}>
              <code>{e.where}</code> {e.message}
            </li>
          ))}
        </ul>
      )}
      <div className="view-menu__head">{seg('Match', conj, setConj)}</div>
      {group.items.length === 0 ? (
        <p className="view-menu__empty">No filters</p>
      ) : (
        <ul className="view-menu__list">
          {group.items.map((item, i) => {
            const nested = groupNode(item)
            return nested === null ? row(item, i, setItem, removeItem, String(i)) : groupRow(nested, i)
          })}
        </ul>
      )}
      <div className="view-menu__foot">
        <div className="view-menu__actions">
          <button type="button" className="view-menu__action" onClick={() => write({ conj, items: [...group.items, ruleToExpr(NEW_RULE)] })}>
            Add rule
          </button>
          <button
            type="button"
            className="view-menu__action"
            onClick={() => write({ conj, items: [...group.items, { or: [ruleToExpr(NEW_RULE)] }] })}
          >
            Add group
          </button>
        </div>
        <label className="view-menu__toggle">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          Advanced
        </label>
      </div>
    </div>
  )
}
