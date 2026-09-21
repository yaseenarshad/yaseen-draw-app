import { describe, expect, it, vi } from 'vitest'
import { createWindowOpenHandler } from './windowOpenPolicy'

describe('createWindowOpenHandler', () => {
  it.each(['https://example.com', 'http://example.com', 'mailto:yasin@example.com', 'tel:+14805551212', 'ftp://example.com/file']) (
    'routes a safe absolute external URL to the OS and still denies the child window: %s',
    (url) => {
      const open = vi.fn(async () => undefined)
      const handler = createWindowOpenHandler(open)

      expect(handler({ url } as never)).toEqual({ action: 'deny' })
      expect(open).toHaveBeenCalledExactlyOnceWith({ href: url })
    },
  )

  it.each(['app://yaseen/index.html', 'file:///tmp/a.txt', 'javascript:alert(1)', 'not a url'])(
    'denies a non-external popup without routing it: %s',
    (url) => {
      const open = vi.fn(async () => undefined)
      const handler = createWindowOpenHandler(open)

      expect(handler({ url } as never)).toEqual({ action: 'deny' })
      expect(open).not.toHaveBeenCalled()
    },
  )

  it('denies synchronously even when OS routing rejects', async () => {
    const open = vi.fn(async () => {
      throw new Error('OS rejected')
    })
    const handler = createWindowOpenHandler(open)

    expect(handler({ url: 'https://example.com' } as never)).toEqual({ action: 'deny' })
    await expect(open.mock.results[0]?.value).rejects.toThrow('OS rejected')
  })
})
