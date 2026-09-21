/**
 * "just now" under a minute, then the largest whole unit ("2 hours ago", "yesterday", "last
 * week"). Born on the Welcome screen's recent-folder rows (C2, GRO-2164); the comment stream
 * (YAZ-1472) stamps its rows with the same words, so it lives here for both.
 */

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

export function relativeTime(then: number, now: number): string {
  const diff = now - then
  for (const [unit, ms] of UNITS) {
    if (diff >= ms) return RTF.format(-Math.floor(diff / ms), unit)
  }
  return 'just now'
}
