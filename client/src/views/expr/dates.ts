/** Date / duration helpers over raw milliseconds (GRO-2131). Local time throughout. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/

/** `YYYY-MM-DD`, `YYYY-MM-DD HH:mm(:ss)`, `YYYY-MM-DDTHH:mm…` (optional zone) → ms, else null. */
export function parseIsoDate(s: string): { ms: number; hasTime: boolean } | null {
  const m = ISO.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, sec, frac, zone] = m
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null
  const hasTime = h !== undefined
  const ms = zone
    ? Date.parse(s.trim().replace(' ', 'T'))
    : new Date(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0), +(sec ?? 0), +(frac ?? '0').padEnd(3, '0')).getTime()
  return Number.isNaN(ms) ? null : { ms, hasTime }
}

export function startOfDay(ms: number): number {
  const t = new Date(ms)
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Moment-style tokens `YYYY YY MM M DD D HH H mm m ss s SSS`; `[literal]` passes through. */
export function formatDate(ms: number, fmt: string): string {
  const t = new Date(ms)
  const tok: Record<string, () => string> = {
    YYYY: () => pad(t.getFullYear(), 4),
    YY: () => pad(t.getFullYear() % 100),
    MM: () => pad(t.getMonth() + 1),
    M: () => String(t.getMonth() + 1),
    DD: () => pad(t.getDate()),
    D: () => String(t.getDate()),
    HH: () => pad(t.getHours()),
    H: () => String(t.getHours()),
    mm: () => pad(t.getMinutes()),
    m: () => String(t.getMinutes()),
    ss: () => pad(t.getSeconds()),
    s: () => String(t.getSeconds()),
    SSS: () => pad(t.getMilliseconds(), 3),
  }
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s|SSS/g, (m, lit: string | undefined) =>
    lit !== undefined ? lit : tok[m](),
  )
}

/** `YYYY-MM-DD`, plus ` HH:mm` when the value carries a time (and `:ss` when non-zero). */
export function renderDate(ms: number, hasTime: boolean): string {
  if (!hasTime) return formatDate(ms, 'YYYY-MM-DD')
  const t = new Date(ms)
  return formatDate(ms, t.getSeconds() || t.getMilliseconds() ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD HH:mm')
}

const RELATIVE_UNITS: [string, number][] = [
  ['year', 365 * 86400e3],
  ['month', 30 * 86400e3],
  ['week', 7 * 86400e3],
  ['day', 86400e3],
  ['hour', 3600e3],
  ['minute', 60e3],
]

/** Coarse, signed: `in 3 days`, `2 hours ago`, `just now` (under a minute). */
export function relativeDate(ms: number, now = Date.now()): string {
  const diff = ms - now
  const abs = Math.abs(diff)
  for (const [name, size] of RELATIVE_UNITS) {
    if (abs < size) continue
    const n = Math.round(abs / size)
    const unit = `${n} ${name}${n === 1 ? '' : 's'}`
    return diff > 0 ? `in ${unit}` : `${unit} ago`
  }
  return 'just now'
}

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1e3, sec: 1e3, second: 1e3, seconds: 1e3,
  m: 60e3, min: 60e3, minute: 60e3, minutes: 60e3,
  h: 3600e3, hr: 3600e3, hour: 3600e3, hours: 3600e3,
  d: 86400e3, day: 86400e3, days: 86400e3,
  w: 7 * 86400e3, week: 7 * 86400e3, weeks: 7 * 86400e3,
  mo: 30 * 86400e3, month: 30 * 86400e3, months: 30 * 86400e3,
  y: 365 * 86400e3, year: 365 * 86400e3, years: 365 * 86400e3,
}

/** `"2d"`, `"1d 2h"`, `"1.5h"`, `"90 minutes"` → ms, else null. */
export function parseDuration(s: string): number | null {
  const part = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z]+)\s*,?/i
  let rest = s
  let total = 0
  let n = 0
  while (rest.trim()) {
    const m = part.exec(rest)
    if (!m) return null
    const unit = UNIT_MS[m[2].toLowerCase()] as number | undefined
    if (unit === undefined) return null
    total += Number(m[1]) * unit
    rest = rest.slice(m[0].length)
    n++
  }
  return n ? total : null
}

const RENDER_UNITS: [string, number][] = [['d', 86400e3], ['h', 3600e3], ['m', 60e3], ['s', 1e3]]

/** `"1d 2h 30m"` style; `0s` for zero, leading `-` when negative. */
export function renderDuration(ms: number): string {
  let left = Math.abs(ms)
  const parts: string[] = []
  for (const [name, size] of RENDER_UNITS) {
    const n = Math.floor(left / size)
    if (n) {
      parts.push(`${n}${name}`)
      left -= n * size
    }
  }
  if (Math.round(left)) parts.push(`${Math.round(left)}ms`)
  if (!parts.length) return '0s'
  return (ms < 0 ? '-' : '') + parts.join(' ')
}
