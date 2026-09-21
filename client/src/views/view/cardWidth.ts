/**
 * `view.cardSize` → card / column width px, shared by Board (4D) and Cards (4E). Obsidian's
 * cards view stores a NUMBER (px); legacy small/medium/large compatibility values map to
 * 220/280/340. Anything else = medium.
 */
export const CARD_WIDTHS: Record<string, number> = { small: 220, medium: 280, large: 340 }

export function cardWidth(cardSize: unknown): number {
  if (typeof cardSize === 'number' && Number.isFinite(cardSize) && cardSize > 0) return Math.round(cardSize)
  return CARD_WIDTHS[String(cardSize)] ?? CARD_WIDTHS.medium
}
