/**
 * The controls the settings rows share (YAZ-1679 D7).
 *
 * WHICH ONE: `Segmented` for 2–4 short options (Off/On, Narrow/Medium/Full) — every choice
 * visible, one click. `Select` when the labels are sentences or the list is long ("Same folder
 * as current file") — a stack of long buttons reads as content and is too easy to change by
 * accident (Yasin's fourth call). Both take the same `options` / `value` / `onChange`, so a row
 * can swap between them without touching the registry entry's data.
 *
 * The `settings__option` / `settings__option--active` class names are the popover's (GRO-2024)
 * and stay — the tests address the buttons by them.
 */
import type { Option } from './options'

interface ChoiceProps<T> {
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}

export function Segmented<T>({ options, value, onChange, ariaLabel }: ChoiceProps<T>) {
  return (
    <div className="settings__options" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          className={`settings__option${option.value === value ? ' settings__option--active' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A native `<select>`, keyed by option INDEX so any `T` rides through unchanged (a native select
 * only speaks strings). The wrapper exists for the chevron: a `<select>` takes no pseudo-element.
 */
export function Select<T>({ options, value, onChange, ariaLabel }: ChoiceProps<T>) {
  const selected = options.findIndex((option) => option.value === value)
  return (
    <span className="settings__select-wrap">
      <select className="settings__select" aria-label={ariaLabel} value={selected} onChange={(e) => onChange(options[Number(e.target.value)].value)}>
        {options.map((option, i) => (
          <option key={option.label} value={i}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}
