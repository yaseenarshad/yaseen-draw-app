import './propertyDefinition.css'
import { useEffect, useId, useState } from 'react'

export function SelectValueEditor({ raw, options, multiple, label, onCommit, onDone }: {
  raw: unknown; options: readonly string[]; multiple: boolean; label: string;
  onCommit: (value: unknown) => void; onDone: () => void
}) {
  const initial = Array.isArray(raw) ? raw.map(String) : raw == null || raw === '' ? [] : [String(raw)]
  const selected = initial
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const id = useId()
  const values = [...new Set([...options, ...initial])].filter(o => o.toLowerCase().includes(query.toLowerCase()))
  useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' }) }, [id, active, query])
  const choose = (option: string) => {
    if (multiple) {
      const next = selected.includes(option) ? selected.filter(o => o !== option) : [...selected, option]
      onCommit(next)
    }
    else { onCommit(option); onDone() }
  }
  return <span className="property-value-picker" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDone() }} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone() }
  }}>
    <input autoFocus className="view-input" role="combobox" aria-label={label} aria-expanded="true" aria-controls={id} aria-activedescendant={values[active] === undefined ? undefined : `${id}-${active}`} placeholder="Search options…" value={query} onChange={e => { setQuery(e.target.value); setActive(0) }} onKeyDown={e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(values.length - 1, i + 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (values[active] !== undefined) choose(values[active]) }
    }} />
    <span className="property-value-picker__list" role="listbox" id={id} aria-label={label} aria-multiselectable={multiple || undefined}>
      {values.map((option, i) => <button type="button" role="option" id={`${id}-${i}`} key={option} aria-selected={selected.includes(option)} className={active === i ? 'is-active' : ''} onMouseDown={e => e.preventDefault()} onClick={() => choose(option)}><span><span className="property-choice-chip">{option}</span>{!options.includes(option) && <small>Existing value</small>}</span><span>{selected.includes(option) ? '✓' : ''}</span></button>)}
      {values.length === 0 && <span className="property-definition__help">No matching options.</span>}
    </span>
    <span className="property-value-picker__footer"><button type="button" onClick={() => { onCommit(multiple ? [] : null); onDone() }}>Clear</button>{multiple && <button type="button" onClick={onDone}>Done</button>}</span>
  </span>
}
