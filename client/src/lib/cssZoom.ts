/** Effective CSS `zoom` at an element; jsdom/older engines fall back to the unscaled layout. */
export function cssZoom(element: Element): number {
  const zoom = element.currentCSSZoom
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}
