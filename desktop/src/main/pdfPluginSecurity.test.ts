import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

describe('native PDF BrowserWindow security settings', () => {
  it('enables Chromium PDF plugins without weakening renderer isolation', async () => {
    const source = await readFile(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const preferences = source.match(/webPreferences:\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? ''

    expect(preferences).toMatch(/plugins:\s*true/)
    expect(preferences).toMatch(/contextIsolation:\s*true/)
    expect(preferences).toMatch(/nodeIntegration:\s*false/)
    expect(preferences).toMatch(/sandbox:\s*true/)
  })
})
