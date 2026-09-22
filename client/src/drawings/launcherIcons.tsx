/**
 * The rail's and the canvas panel's icons (YAZ-1775), ported 1:1 from the engine's own
 * `packages/excalidraw/components/icons.tsx` (`HamburgerMenuIcon`, `FreedrawIcon`,
 * `frameToolIcon`, `ImageIcon`, `LibraryIcon`, `presentationIcon`).
 *
 * WHY COPIED AND NOT IMPORTED: the vendored package exports no runtime subpath for its icons, and
 * a static import of anything inside it would pull the whole engine into the renderer's entry
 * chunk — the LAZY rule `engine.ts` exists to hold. Same `createIcon` shape as the originals: an
 * `aria-hidden` svg whose `viewBox` comes from its size, carrying the tabler stroke props.
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

const tabler: Opts = { width: 24, height: 24, fill: 'none', strokeWidth: 2, stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }
const modifiedTabler: Opts = { width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' }

export const hamburgerIcon = icon(
  <g strokeWidth="1.5">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </g>,
  tabler,
)

export const freedrawIcon = icon(
  <g strokeWidth="1.25">
    <path clipRule="evenodd" d="m7.643 15.69 7.774-7.773a2.357 2.357 0 1 0-3.334-3.334L4.31 12.357a3.333 3.333 0 0 0-.977 2.357v1.953h1.953c.884 0 1.732-.352 2.357-.977Z" />
    <path d="m11.25 5.417 3.333 3.333" />
  </g>,
  modifiedTabler,
)

export const frameIcon = icon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 7l16 0" />
    <path d="M4 17l16 0" />
    <path d="M7 4l0 16" />
    <path d="M17 4l0 16" />
  </g>,
  tabler,
)

export const imageIcon = icon(
  <g strokeWidth="1.25">
    <path d="M12.5 6.667h.01" />
    <path d="M4.91 2.625h10.18a2.284 2.284 0 0 1 2.285 2.284v10.182a2.284 2.284 0 0 1-2.284 2.284H4.909a2.284 2.284 0 0 1-2.284-2.284V4.909a2.284 2.284 0 0 1 2.284-2.284Z" />
    <path d="m3.333 12.5 3.334-3.333c.773-.745 1.726-.745 2.5 0l4.166 4.166" />
    <path d="m11.667 11.667.833-.834c.774-.744 1.726-.744 2.5 0l1.667 1.667" />
  </g>,
  modifiedTabler,
)

export const libraryIcon = icon(
  <g strokeWidth="1.25">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
    <path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
    <line x1="3" y1="6" x2="3" y2="19" />
    <line x1="12" y1="6" x2="12" y2="19" />
    <line x1="21" y1="6" x2="21" y2="19" />
  </g>,
  tabler,
)

export const presentationIcon = icon(
  <g strokeWidth="1.25">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M3 4l18 0" />
    <path d="M4 4v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-10" />
    <path d="M12 16l0 4" />
    <path d="M9 20l6 0" />
    <path d="M8 12l3 -3l2 2l3 -3" />
  </g>,
  tabler,
)
