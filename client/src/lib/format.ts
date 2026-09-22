/** Absolute, local, short: "Sep 22, 2026, 3:14 PM". The Info popover's date spelling (🔒 YAZ-1835 D7). */
const DATE_TIME = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })
export const formatDateTime = (ms: number): string => DATE_TIME.format(ms)

/** "12.4 KB" — one decimal above bytes, none at bytes. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}
