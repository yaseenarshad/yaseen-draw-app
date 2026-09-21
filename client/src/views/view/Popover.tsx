import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface PopoverProps {
  label: string
  onClose: () => void
  className?: string
  /** Keep toolbar menus on screen as their searchable content changes size. */
  constrainToViewport?: boolean
  /** Trigger to hang off with `position: fixed` (YAZ-743), for triggers inside a scrolling ancestor. */
  anchor?: HTMLElement | null
  children: ReactNode
}

/**
 * Popover anchored under its trigger (GRO-2135): rendered inside the trigger's
 * `position: relative` wrapper, so click-away is any mousedown outside that wrapper
 * (the trigger itself then toggles normally); Esc closes; focus moves in on open.
 * With `anchor` it is placed fixed under that element instead, measured and clamped
 * to the viewport like `ContextMenu`, so a clipping ancestor cannot cut it off — and
 * outside scrolling or window resizing closes it. Content resizing refits it in place.
 */
export function Popover({ label, onClose, className, anchor, children, constrainToViewport = false }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties>()

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    ;(el.querySelector<HTMLElement>('input, select, button:not(:disabled)') ?? el).focus()
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || el === null) return
    const fit = () => {
      const a = anchor.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const top = Math.max(0, Math.min(a.bottom + 6, window.innerHeight - r.height))
      const left = Math.max(0, Math.min(a.left, window.innerWidth - r.width))
      setPos(previous => previous?.top === top && previous.left === left ? previous : { position: 'fixed', top, left })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [anchor])

  useLayoutEffect(() => {
    const el = ref.current
    if (!constrainToViewport || anchor || !el) return
    const fit = () => {
      el.style.translate = ''
      el.style.maxWidth = ''
      const cssMaxWidth = parseFloat(getComputedStyle(el).maxWidth) || Infinity
      let left = 0, top = 0, right = window.innerWidth, bottom = window.innerHeight
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        const bounds = parent.getBoundingClientRect()
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX || style.overflow)) {
          left = Math.max(left, bounds.left)
          right = Math.min(right, bounds.right)
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY || style.overflow)) {
          top = Math.max(top, bounds.top)
          bottom = Math.min(bottom, bounds.bottom)
        }
      }
      el.style.maxWidth = `${Math.min(cssMaxWidth, Math.max(0, right - left - 24))}px`
      el.style.minWidth = `${Math.min(260, Math.max(0, right - left - 24))}px`
      el.style.maxHeight = `${Math.max(0, Math.min(window.innerHeight * .6, bottom - top - 24))}px`
      const rect = el.getBoundingClientRect()
      const x = Math.max(left + 12 - rect.left, Math.min(0, right - 12 - rect.right))
      const y = Math.max(top + 12 - rect.top, Math.min(0, bottom - 12 - rect.bottom))
      el.style.translate = `${x}px ${y}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    for (let parent = el.parentElement; parent; parent = parent.parentElement) observer.observe(parent)
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !el.contains(event.target)) fit()
    }
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchor, constrainToViewport])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      const trigger = anchor ?? ref.current?.parentElement
      if (trigger && !trigger.contains(target) && ref.current?.contains(target) !== true) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onReflow = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    if (anchor) {
      window.addEventListener('scroll', onReflow, true)
      window.addEventListener('resize', onReflow)
    }
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [anchor, onClose])

  return (
    <div
      ref={ref}
      className={`view-popover${className ? ` ${className}` : ''}${anchor ? ' view-popover--fixed' : ''}`}
      style={pos}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
    >
      {children}
    </div>
  )
}
