import { describe, expect, it } from 'vitest'
import { APP_NAME, windowTitle } from './windowTitle'

describe('windowTitle', () => {
  it('composes "<file> — <folder>" Obsidian-style, vault extension stripped', () => {
    expect(windowTitle('/vaults/notes', '/vaults/notes/Ideas.md')).toBe('Ideas — notes')
    expect(windowTitle('/vaults/notes', '/vaults/notes/sub/Plan.markdown')).toBe('Plan — notes')
  })

  it('is the folder name alone when no file is open', () => {
    expect(windowTitle('/vaults/notes', null)).toBe('notes')
  })

  it('is the app name on the Welcome screen (no folder), whatever the file says', () => {
    expect(APP_NAME).toBe('Yaseen Docs')
    expect(windowTitle(null, null)).toBe(APP_NAME)
    expect(windowTitle(null, '/stray.md')).toBe(APP_NAME)
  })
})
