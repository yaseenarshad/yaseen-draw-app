import { useEffect, useId, useRef, useState } from 'react'
import { ColumnSearch, matchesColumn } from './ColumnSearch'

interface PickerBase {
  label: string
  options: readonly { value: string; label: string }[]
  /** Wording for the search box and the no-match line: 'columns' (default) or 'values' (YAZ-1467). */
  noun?: string
}

/** One choice, or — with `multiple` — a checklist of ticked ones (🔒 D6, YAZ-1467). */
type ColumnPickerProps = PickerBase & (
  | { multiple?: false; value: string; onChange: (value: string) => void }
  | { multiple: true; value: readonly string[]; onChange: (value: string[]) => void }
)

/** Search stays local; only choosing an option changes the view. The list expands inside its menu. */
export function ColumnPicker(props: ColumnPickerProps) {
  const { label, options, noun = 'columns' } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const matches = options.filter((option) => matchesColumn(query, option.label, option.value))
  const picked = (option: string): boolean => (props.multiple ? props.value.includes(option) : option === props.value)
  const text = props.multiple
    ? props.value.map((v) => options.find((option) => option.value === v)?.label ?? v).join(', ') || 'Choose…'
    : options.find((option) => option.value === props.value)?.label ?? props.value
  const index = Math.max(0, Math.min(active, matches.length - 1))
  const close = () => { setOpen(false); trigger.current?.focus() }
  const show = () => {
    setQuery('')
    setActive(Math.max(0, options.findIndex((option) => picked(option.value))))
    setOpen(true)
  }
  const choose = (next: string) => {
    if (!props.multiple) { close(); if (next !== props.value) props.onChange(next); return }
    props.onChange(props.value.includes(next) ? props.value.filter((v) => v !== next) : [...props.value, next])
  }

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const away = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  useEffect(() => {
    // Scroll only the options, never the enclosing settings menu or page.
    const option = list.current?.children[index] as HTMLElement | undefined
    const el = list.current
    if (!el || !option) return
    if (option.offsetTop < el.scrollTop) el.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = option.offsetTop + option.offsetHeight - el.clientHeight
  }, [open, index, query])

  return (
    <div ref={wrapper} className="column-picker" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
      <button ref={trigger} type="button" className="column-picker__trigger view-select" aria-label={label} aria-describedby={`${id}-value`} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => open ? close() : show()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show() }
        }}>
        <span id={`${id}-value`}>{text}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="column-picker__panel" onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
        }}>
          <ColumnSearch inputRef={input} value={query} onChange={(next) => { setQuery(next); setActive(0) }} label={`Search ${label.toLowerCase()} ${noun}`} placeholder={`Search ${noun}…`}
            role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={matches[index] ? `${id}-${index}` : undefined}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setActive(Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
              } else if (event.key === 'Enter' && matches[index]) { event.preventDefault(); choose(matches[index].value) }
            }} />
          <div ref={list} className="column-picker__options" id={id} role="listbox" aria-label={`${label} ${noun}`} aria-multiselectable={props.multiple || undefined}>
            {matches.map((option, i) => (
              <div key={option.value} id={`${id}-${i}`} role="option" data-value={option.value} aria-selected={picked(option.value)}
                className={`column-picker__option${i === index ? ' column-picker__option--active' : ''}`}
                onMouseEnter={() => setActive(i)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option.value)}>
                <span>{option.label}{option.value && option.label !== option.value && <small>{option.value}</small>}</span>
                <span className="column-picker__check" aria-hidden="true">{picked(option.value) ? '✓' : ''}</span>
              </div>
            ))}
          </div>
          {matches.length === 0 && <p className="column-search__empty" role="status">No {noun} found.</p>}
        </div>
      )}
    </div>
  )
}
