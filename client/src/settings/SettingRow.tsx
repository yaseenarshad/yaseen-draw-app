/**
 * One settings row (YAZ-1679 D7): label and hint on the left, the control on the right, a hairline
 * between rows in a card (settings.css `.setting + .setting`). `data-setting` is the row's stable
 * address — tests find a row by it rather than by position or label text.
 * `wide` stacks the control full-width under the text for the controls a right-hand cell cannot
 * hold: the hotkey tables and the library-folder picker.
 */
import type { ReactNode } from 'react'

interface SettingRowProps {
  id: string
  label: string
  hint?: string
  wide?: boolean
  children: ReactNode
}

export function SettingRow({ id, label, hint, wide = false, children }: SettingRowProps) {
  return (
    <div className={`setting${wide ? ' setting--wide' : ''}`} data-setting={id}>
      <div className="setting__text">
        <p className="setting__label">{label}</p>
        {hint !== undefined && <p className="setting__hint">{hint}</p>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  )
}
