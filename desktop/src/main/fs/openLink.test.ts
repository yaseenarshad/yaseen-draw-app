import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

import { openLink, type OpenLinkHost } from './openLink'

function host(): OpenLinkHost {
  return { openExternal: vi.fn(async () => undefined) }
}

describe('openLink', () => {
  it.each([
    'https://example.com/a?b=1#c',
    'http://example.com',
    'mailto:yasin@example.com',
    'tel:+14805551212',
    'ftp://example.com/file.txt',
  ])('hands the safe external URL to the OS protocol handler: %s', async (href) => {
    const os = host()

    await openLink({ href }, os)

    expect(os.openExternal).toHaveBeenCalledExactlyOnceWith(new URL(href).href)
  })

  it.each([
    [{ href: '#section' }, 'link is not an absolute URL'],
    [{ href: 'relative.txt' }, 'link is not an absolute URL'],
    [{ href: 'javascript:alert(1)' }, 'unsupported link protocol'],
    [{ href: 'data:text/plain,nope' }, 'unsupported link protocol'],
    [{ href: 'file:///tmp/Local%20File.pdf' }, 'unsupported link protocol'],
    [{ href: 'app://yaseen/index.html' }, 'unsupported link protocol'],
    [{ href: '' }, "missing 'href'"],
    [null, 'invalid open-link request'],
  ])('rejects invalid or non-shell input without an OS side effect', async (req, message) => {
    const os = host()

    await expect(openLink(req, os)).rejects.toMatchObject({ code: 'BAD_REQUEST', message })
    expect(os.openExternal).not.toHaveBeenCalled()
  })

  it('turns an external-handler rejection into a structured IO failure', async () => {
    const os = host()
    vi.mocked(os.openExternal).mockRejectedValue(new Error('Launch Services unavailable'))

    await expect(openLink({ href: 'https://example.com' }, os)).rejects.toMatchObject({
      code: 'IO_ERROR',
      message: 'Launch Services unavailable',
    })
  })
})
