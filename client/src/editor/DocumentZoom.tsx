import { useEffect, useId, useRef, useState } from 'react'

const PRESETS = [50, 75, 90, 100, 125, 150, 200, 300, 400]

/**
 * Next preset above (`1`) or below (`-1`) `value`; a custom value snaps to the nearest preset in
 * that direction (117 → 125 / 100). `null` past the last preset, which is what disables the button.
 * (Reverse-then-find because the client lib is ES2022: no `findLast`.)
 */
export const stepZoom = (value: number, direction: 1 | -1): number | null =>
  (direction === 1 ? PRESETS.find((p) => p > value) : [...PRESETS].reverse().find((p) => p < value)) ?? null

/**
 * The keyboard's step (⌘+ / ⌘−, YAZ-1710 D16): the preset ladder up to 200%, then 25 at a time
 * to 400% — 200 → 300 is a big jump under a key held down, fine for a click in the menu. The pill's
 * − / + keep the ladder. Custom values snap to the grid in the step direction (210 → 225 / 200).
 */
export const stepZoomByKey = (value: number, direction: 1 | -1): number | null => {
  if (direction === 1 ? value < 200 : value <= 200) return stepZoom(value, direction)
  const next = direction === 1 ? Math.floor(value / 25) * 25 + 25 : Math.ceil(value / 25) * 25 - 25
  return next > 400 ? null : next
}

const parseZoom = (draft: string): number | null => {
  const text = draft.trim()
  const next = Number(text.replace(/%$/, ''))
  return /^\d{1,3}%?$/.test(text) && next >= 50 && next <= 400 ? next : null
}

export function DocumentZoom({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef<string | null>(null)
  const menuId = useId()
  const inputId = useId()
  const errorId = useId()

  const updateDraft = (next: string | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const close = (focusTrigger: boolean) => {
    updateDraft(null)
    setError(false)
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }

  const commit = (next: number, focusTrigger: boolean) => {
    draftRef.current = null
    onChange(next)
    setDraft(null)
    setError(false)
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }

  const apply = (focusTrigger: boolean) => {
    const currentDraft = draftRef.current
    if (currentDraft === null) return
    const next = parseZoom(currentDraft)
    if (next === null) {
      setError(true)
      return
    }
    commit(next, focusTrigger)
  }

  /**
   * A step is a preset pick without the menu: it applies at once, drops any draft, closes an open
   * menu and leaves focus on the step button so repeated clicks keep stepping.
   */
  const step = (direction: 1 | -1) => {
    const next = stepZoom(value, direction)
    if (next !== null) commit(next, false)
  }

  const showMenu = () => {
    updateDraft(`${value}%`)
    setError(false)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) apply(false)
    }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [open, draft, onChange])

  return (
    <div ref={rootRef} className="document-zoom" role="group" aria-label="Document zoom"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) apply(false)
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close(true)
        }
      }}>
      <button type="button" className="document-zoom__step" aria-label="Zoom out"
        disabled={stepZoom(value, -1) === null} onClick={() => step(-1)}>−</button>
      <button ref={triggerRef} type="button" className="document-zoom__trigger"
        aria-label={`Document zoom: ${value}%`} aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => { if (open) close(false); else showMenu() }}>
        <span className="document-zoom__value">{value}%</span>
      </button>
      <button type="button" className="document-zoom__step" aria-label="Zoom in"
        disabled={stepZoom(value, 1) === null} onClick={() => step(1)}>+</button>

      {open && <div id={menuId} className="document-zoom__menu" role="group" aria-label="Zoom options">
        <div className="document-zoom__custom">
          <label htmlFor={inputId}>Custom</label>
          <input ref={inputRef} id={inputId} inputMode="numeric" title="Document zoom (50–400%)"
            value={draft ?? `${value}%`} aria-invalid={error}
            aria-describedby={error ? errorId : undefined}
            onFocus={(event) => event.target.select()}
            onChange={(event) => { updateDraft(event.target.value); setError(false) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                apply(true)
              }
            }} />
          {error && <div id={errorId} role="alert" className="document-zoom__error">
            Use a whole number from 50–400%.
          </div>}
        </div>
        <div className="document-zoom__divider" aria-hidden="true" />
        <div className="document-zoom__presets" role="group" aria-label="Zoom presets">
          {PRESETS.map((preset) => <button key={preset} type="button" aria-pressed={value === preset}
            onClick={() => commit(preset, true)}>
            <span>{preset}%</span><span aria-hidden="true">{value === preset ? '✓' : ''}</span>
          </button>)}
        </div>
      </div>}
    </div>
  )
}
