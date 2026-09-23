import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

/**
 * THE MODAL-KEYS RULE, shared by the app's dialogs (YAZ-1799 Share, YAZ-1897 Version history):
 * nothing typed while a dialog is open reaches the sidebar tree or the canvas behind it.
 *
 * `useModalKeys` listens on the window in the CAPTURE phase: a key aimed outside the dialog is
 * swallowed and focus pulled back in; Escape — from anywhere — is the dialog's to answer.
 * `cycleTab` goes on the dialog's own `onKeyDown`: Tab and Shift-Tab wrap around inside it, and no
 * key typed in it travels on to the app.
 */
export function useModalKeys(dialog: RefObject<HTMLElement | null>, onEscape: () => void): void {
  const escape = useRef(onEscape)
  escape.current = onEscape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inside = e.target instanceof Node && dialog.current?.contains(e.target) === true
      if (inside && e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') escape.current()
      else dialog.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dialog])
}

export function cycleTab(e: ReactKeyboardEvent, dialog: HTMLElement | null): void {
  e.stopPropagation()
  if (e.key !== 'Tab') return
  const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])]
  if (focusable.length === 0) return
  const i = focusable.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  focusable[e.shiftKey ? (i <= 0 ? focusable.length - 1 : i - 1) : (i + 1) % focusable.length]?.focus()
}
