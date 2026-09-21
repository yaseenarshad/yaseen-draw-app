import { useRef, type InputHTMLAttributes, type RefObject } from 'react'
import { SearchIcon } from './icons'
import { canonicalKey } from './keys'

export const matchesColumn = (query: string, label: string, key: string): boolean =>
  `${label} ${key} ${key ? canonicalKey(key) : ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())

interface ColumnSearchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  label: string
  inputRef?: RefObject<HTMLInputElement | null>
}

export function ColumnSearch({ value, onChange, label, inputRef, placeholder = 'Search columns…', ...props }: ColumnSearchProps) {
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  return (
    <div className="column-search">
      <SearchIcon />
      <input {...props} ref={ref} type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} autoComplete="off" />
      {value && (
        <button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => { onChange(''); ref.current?.focus() }}>
          ×
        </button>
      )}
    </div>
  )
}
