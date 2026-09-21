import { useEffect, useRef, useState } from 'react'

interface TextFieldProps {
  value: string
  /** The new text, once per edit (Enter or blur) and only when it differs from `value`. */
  onCommit: (next: string) => void
  /** Canonicalizes a committed draft; null rejects it and visibly restores `value`. */
  normalize?: (draft: string) => string | null
  /** After Enter, blur or Escape, whether or not anything was committed. */
  onDone?: () => void
  className?: string
  placeholder?: string
  type?: 'text' | 'date' | 'number'
  inputMode?: 'decimal'
  min?: number
  step?: number
  /** `id` of a `datalist` the caller renders — value suggestions (YAZ-1232). */
  list?: string
  autoFocus?: boolean
  'aria-label'?: string
}

/** Text input that reports its value once per edit (GRO-2135), so every config change is one `onChange`. */
export function TextField({ value, onCommit, normalize, onDone, ...rest }: TextFieldProps) {
  const [draft, setDraft] = useState(value)
  const done = useRef(false)
  useEffect(() => setDraft(value), [value])

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit && draft !== value) {
      const next = normalize === undefined ? draft : normalize(draft)
      if (next === null) setDraft(value)
      else {
        setDraft(next)
        if (next !== value) onCommit(next)
      }
    } else if (!commit) setDraft(value)
    onDone?.()
  }

  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => {
        done.current = false
        setDraft(e.target.value)
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}
