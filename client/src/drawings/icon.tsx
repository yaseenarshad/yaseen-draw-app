/**
 * The one `createIcon` shape every canvas icon in this app is drawn with.
 *
 * WHY COPIED AND NOT IMPORTED: the vendored engine exports no runtime subpath for its icons, and a
 * static import of anything inside it would pull the whole engine into the renderer's entry chunk —
 * the LAZY rule `engine.ts` exists to hold. So the icons are re-drawn here, in the originals' own
 * shape: an `aria-hidden` svg whose `viewBox` comes from its size, carrying the Tabler stroke props.
 */
import type { ReactNode, SVGProps } from 'react'

export type IconOpts = { width: number; height?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>

export function icon(d: ReactNode, opts: IconOpts): ReactNode {
  const { width, height = width, ...rest } = opts
  return (
    <svg aria-hidden="true" focusable="false" role="img" viewBox={`0 0 ${width} ${height}`} {...rest}>
      {d}
    </svg>
  )
}

/** Tabler's 24 px grid; a path that wants a different weight wraps itself in `<g strokeWidth>`. */
export const tabler24: IconOpts = { width: 24, height: 24, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }

/** The engine's own 20 px pair, which the toolbar and control bar sit next to. */
export const tabler20: IconOpts = { width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }
