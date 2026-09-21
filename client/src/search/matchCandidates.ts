/**
 * THE ONE ranking matcher (GRO-2197): both search surfaces — ⌘K title search (`searchCandidates.ts`)
 * and the settings dialog's own search (`settings/searchSettings.ts`) — rank through here, so the
 * app has one answer to "which of these names does this query mean", not two. Matching is
 * case-insensitive over the candidate NAME, ranked exact → prefix → substring, capped after
 * ranking. Structurally typed on `{ name, lower? }` so any row shape can match through it.
 */

/** Default cap; a caller with a scrollable list (title search) passes its own. */
export const MAX_SUGGESTIONS = 8

export function matchCandidates<T extends { name: string; lower?: string }>(
  candidates: readonly T[],
  fragment: string,
  cap: number = MAX_SUGGESTIONS,
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
