/**
 * The Present tab's icons (YAZ-1820), re-drawn from `excalidraw-app/presentation/icons.tsx` plus
 * the three the player and the launcher borrowed from the engine's own set (`ArrowRightIcon`,
 * `CloseIcon`, `presentationIcon`), in `icon.tsx`'s shape and for the reason stated there.
 */
import { icon, tabler20, tabler24 } from '../icon'

/** The Present tab's own launcher glyph (a screen on a stand). */
export const presentationIcon = icon(
  <g strokeWidth="1.25">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M3 4l18 0" />
    <path d="M4 4v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-10" />
    <path d="M12 16l0 4" />
    <path d="M9 20l6 0" />
    <path d="M8 12l3 -3l2 2l3 -3" />
  </g>,
  tabler24,
)

/** Wrench: hand the canvas back to the presenter. */
export const toolsIcon = icon(<path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" />, tabler24)

/** Pencil: rename a slide in the panel. */
export const renameIcon = icon(
  <g>
    <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
    <path d="M13.5 6.5l4 4" />
  </g>,
  tabler24,
)

/** Chevron up / down: nudge a slide one position in the panel. */
export const moveSlideUpIcon = icon(<path d="M6 15l6 -6l6 6" />, tabler24)
export const moveSlideDownIcon = icon(<path d="M6 9l6 6l6 -6" />, tabler24)

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
  tabler24,
)

export const arrowRightIcon = icon(
  <g strokeWidth="1.5">
    <path d="M4 10h12" />
    <path d="M11 5l5 5-5 5" />
  </g>,
  tabler20,
)

export const closeIcon = icon(
  <g strokeWidth="1.5">
    <path d="M5 5l10 10" />
    <path d="M15 5l-10 10" />
  </g>,
  tabler20,
)
