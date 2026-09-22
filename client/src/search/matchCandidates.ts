/**
 * THE ONE ranking matcher (GRO-2197). Every surface that ranks names by a query — ⌘K title search
 * (`searchCandidates.ts`), the settings dialog's search (`settings/searchSettings.ts`), the vault
 * switcher (`sidebar/VaultSwitcher.tsx`) and the Components tab — ranks through here, so the app
 * has one answer to "which of these names does this query mean", not four. Matching is
 * case-insensitive over the candidate NAME, ranked exact → prefix → substring, capped after
 * ranking. Structurally typed on `{ name, lower? }` so any row shape can match through it.
 */
export function matchCandidates<T extends { name: string; lower?: string }>(
  candidates: readonly T[],
  fragment: string,
  /** Every caller states its own; there is no sensible default across four different lists. */
  cap: number,
): T[] {
  const needle = fragment.trim().toLowerCase()
  const exact: T[] = []
  const prefix: T[] = []
  const substring: T[] = []
  for (const candidate of candidates) {
    const lower = candidate.lower ?? candidate.name.toLowerCase()
    const at = lower.indexOf(needle)
    if (at === -1) continue
    if (lower === needle) exact.push(candidate)
    else if (at === 0) prefix.push(candidate)
    else substring.push(candidate)
  }
  return [...exact, ...prefix, ...substring].slice(0, cap)
}
