import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn(), openPath: vi.fn() } }))

import { openLink, type OpenLinkHost } from './openLink'

function host() {
  const value: OpenLinkHost = {
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
  }
  return value
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

    await openLink({ href, sourcePath: '/vault/Nate-Scrape/Nate-Scrape.excalidraw' }, os)

    expect(os.openExternal).toHaveBeenCalledExactlyOnceWith(new URL(href).href)
    expect(os.openPath).not.toHaveBeenCalled()
  })

  it('resolves an encoded relative file from the source note directory', async () => {
    const os = host()

    await openLink(
      { href: 'JSONs/Gamma%20Proposal%20Generation.json', sourcePath: '/vault/Nate-Scrape/Nate-Scrape.excalidraw' },
      os,
    )

    expect(os.openPath).toHaveBeenCalledExactlyOnceWith('/vault/Nate-Scrape/JSONs/Gamma Proposal Generation.json')
    expect(os.openExternal).not.toHaveBeenCalled()
  })

  it.each([
    ['/tmp/Local%20File.pdf', '/tmp/Local File.pdf'],
    ['file:///tmp/Local%20File.pdf', '/tmp/Local File.pdf'],
  ])('opens an absolute local target through the OS file handler: %s', async (href, expected) => {
    const os = host()

    await openLink({ href, sourcePath: '/vault/Note.excalidraw' }, os)

    expect(os.openPath).toHaveBeenCalledExactlyOnceWith(expected)
    expect(os.openExternal).not.toHaveBeenCalled()
  })

  it.each([
    [{ href: '#section', sourcePath: '/vault/Note.excalidraw' }, 'fragment-only links stay inside the document'],
    [{ href: 'javascript:alert(1)', sourcePath: '/vault/Note.excalidraw' }, 'unsupported link protocol'],
    [{ href: 'data:text/plain,nope', sourcePath: '/vault/Note.excalidraw' }, 'unsupported link protocol'],
    [{ href: 'app://yaseen/index.html', sourcePath: '/vault/Note.excalidraw' }, 'unsupported link protocol'],
    [{ href: '', sourcePath: '/vault/Note.excalidraw' }, "missing 'href'"],
    [{ href: 'relative.txt' }, "missing 'sourcePath' for a relative link"],
    [null, 'invalid open-link request'],
  ])('rejects invalid or non-shell input without an OS side effect', async (req, message) => {
    const os = host()

    await expect(openLink(req, os)).rejects.toMatchObject({ code: 'BAD_REQUEST', message })
    expect(os.openExternal).not.toHaveBeenCalled()
    expect(os.openPath).not.toHaveBeenCalled()
  })

  it('rejects a non-local file URL as a structured bad request', async () => {
    const os = host()

    await expect(openLink({ href: 'file://remote-host/share/file.pdf' }, os)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'invalid local file link',
    })
    expect(os.openPath).not.toHaveBeenCalled()
  })

  it('turns an external-handler rejection into a structured IO failure', async () => {
    const os = host()
    vi.mocked(os.openExternal).mockRejectedValue(new Error('Launch Services unavailable'))

    await expect(openLink({ href: 'https://example.com' }, os)).rejects.toMatchObject({
      code: 'IO_ERROR',
      message: 'Launch Services unavailable',
    })
  })

  it('turns shell.openPath error text into a structured IO failure', async () => {
    const os = host()
    vi.mocked(os.openPath).mockResolvedValue('The file does not exist')

    await expect(openLink({ href: 'missing.pdf', sourcePath: '/vault/Note.excalidraw' }, os)).rejects.toMatchObject({
      code: 'IO_ERROR',
      message: 'The file does not exist',
      path: '/vault/missing.pdf',
    })
  })
})
