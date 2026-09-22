/**
 * The presentation panel's and the player's icons (YAZ-1820), ported from
 * `excalidraw-app/presentation/icons.tsx` plus the two the player borrowed from the engine's own
 * set (`ArrowRightIcon`, `CloseIcon`).
 *
 * WHY COPIED AND NOT IMPORTED: `launcherIcons.tsx`'s reason, unchanged — the vendored package
 * exports no runtime subpath for its icons, and a static import of anything inside it would pull
 * the whole engine into the renderer's entry chunk, which is the LAZY rule `engine.ts` exists to
 * hold. Same `createIcon` shape as the originals: an `aria-hidden` svg whose `viewBox` comes from
 * its size, carrying the tabler stroke props.
 */
import type { ReactNode, SVGProps } from 'react'

type Opts = { width: number; height?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>

function icon(d: ReactNode, opts: Opts): ReactNode {
  const { width, height = width, ...rest } = opts
  return (
    <svg aria-hidden="true" focusable="false" role="img" viewBox={`0 0 ${width} ${height}`} {...rest}>
      {d}
    </svg>
  )
}

/** The web app's own props: Tabler's 24 px grid at stroke width 1.5, the 1:16 weight of the 20 px pair below. */
const presentationIconProps: Opts = { width: 24, height: 24, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }

/** Wrench: hand the canvas back to the presenter. */
export const toolsIcon = icon(<path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" />, presentationIconProps)

/** Pencil: rename a slide in the panel. */
export const renameIcon = icon(
  <g>
    <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
    <path d="M13.5 6.5l4 4" />
  </g>,
  presentationIconProps,
)

/** Chevron up / down: nudge a slide one position in the panel. */
export const moveSlideUpIcon = icon(<path d="M6 15l6 -6l6 6" />, presentationIconProps)
export const moveSlideDownIcon = icon(<path d="M6 9l6 6l6 -6" />, presentationIconProps)

/** Grip: the drag handle that reorders a slide in the panel. */
export const dragHandleIcon = icon(
  <g>
    <path d="M9 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M9 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M9 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M15 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M15 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
    <path d="M15 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
  </g>,
  presentationIconProps,
)

/** The engine's own 20 px pair, which the control bar sits next to (`components/icons.tsx`). */
const modifiedTabler: Opts = { width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }

export const arrowRightIcon = icon(
  <g strokeWidth="1.5">
    <path d="M4 10h12" />
    <path d="M11 5l5 5-5 5" />
  </g>,
  modifiedTabler,
)

export const closeIcon = icon(
  <g strokeWidth="1.5">
    <path d="M5 5l10 10" />
    <path d="M15 5l-10 10" />
  </g>,
  modifiedTabler,
)
