import { describe, expect, it } from 'vitest'
import { formatBytes, formatDateTime } from './format'

describe('formatDateTime (🔒 YAZ-1835 D7)', () => {
  it('renders an absolute, local, medium date with a short time', () => {
    // The test environment's zone is whatever the machine has; pin the shape, not the hour.
    expect(formatDateTime(Date.UTC(2026, 8, 22, 12, 0))).toMatch(/^Sep 2[12], 2026, \d{1,2}:\d{2} [AP]M$/)
  })
})

describe('formatBytes', () => {
  it('bytes below 1 KB, one decimal above', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB')
    expect(formatBytes(3 * 1024 ** 4)).toBe('3072.0 GB')
  })
})
