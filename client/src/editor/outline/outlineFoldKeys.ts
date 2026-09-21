/**
 * Stable, position-independent key for a foldable list item (GRO-2011): FNV-1a hash of
 * the item's first-block text (an image counts as its alt text — `itemLabelText`, YAZ-1709) plus
 * its occurrence index among same-labelled items, so fold state survives edits elsewhere in the
 * document and is safe to persist.
 * Ported from yaseen-excalidraw `docs/outlineFoldKeys.ts`.
 * Zoom history (zoom.ts, GRO-2091) reuses the scheme with the occurrence counted over ALL list
 * items (fold keys count foldable items only — parents and image bullets) — same function,
 * separate key space; never mix the two.
 */
const hashLabel = (label: string): string => {
  let hash = 2166136261
  for (let index = 0; index < label.length; index++) {
    hash ^= label.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/**
 * A leading `12) ` / `3. ` / `X) ` marker written into the TEXT of a bullet (YAZ-1329 keeps those
 * literal, so they reach the label). It is ordering, not identity: renumbering a list while the
 * app is closed must not open every fold on the next cold start (YAZ-1353). Live edits no longer
 * depend on this at all — they map through positions (YAZ-1347) — so the one-time invalidation of
 * previously saved keys for numbered lines is accepted rather than migrated.
 */
const ENUMERATION_PREFIX = /^\s*(?:\d+|[Xx])[.)]\s+/

/** The label as the key sees it. Occurrence counting MUST use this too, or `1) foo` / `2) foo` siblings collide at occurrence 0. */
export const outlineFoldLabel = (label: string): string => label.replace(ENUMERATION_PREFIX, '')

export const getOutlineFoldKey = (label: string, occurrence: number): string => `${hashLabel(outlineFoldLabel(label))}:${occurrence}`
