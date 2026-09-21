import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseVaultUrl, resolveVaultUrl, revealVaultImage, serveVaultImage } from './vaultProtocol'

/**
 * `app://vault/<root>/<ref…>?from=<dir>` (YAZ-1658, YAZ-1656 D1): the image URL the renderer
 * builds and main serves. `parseVaultUrl` is the grammar, `serveVaultImage` the `protocol.handle`
 * branch with the file fetch injected, `revealVaultImage` the context menu's Reveal (YAZ-1666)
 * with the Finder call injected — so nothing here touches Electron.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The renderer's grammar, verbatim: root as ONE encoded segment, the ref split on `/`, `from` as a query. */
function vaultUrl(root: string, ref: string, from?: string): string {
  const base = `app://vault/${encodeURIComponent(root)}/${ref.split('/').map(encodeURIComponent).join('/')}`
  return from === undefined ? base : `${base}?from=${encodeURIComponent(from)}`
}

let root: string
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-vault-url-'))
  await Promise.all([mkdir(path.join(root, 'pics'), { recursive: true }), mkdir(path.join(root, 'notes', 'sub'), { recursive: true })])
  await Promise.all([
    writeFile(path.join(root, 'pics', 'a b.png'), PNG),
    writeFile(path.join(root, 'pics', 'pic.png'), PNG),
    writeFile(path.join(root, 'notes', 'pic.png'), PNG),
    writeFile(path.join(root, 'ünï.PNG'), PNG),
    writeFile(path.join(root, 'sketch.excalidraw'), '{"type":"excalidraw"}'),
    writeFile(path.join(root, 'note.md'), '# note'),
  ])
})
afterAll(() => rm(root, { recursive: true, force: true }))

describe('parseVaultUrl', () => {
  it('decodes the root, re-joins the ref segments, and carries `from` only when present', () => {
    expect(parseVaultUrl(vaultUrl('/v/my vault', 'pics/a b.png'))).toEqual({ root: '/v/my vault', ref: 'pics/a b.png' })
    expect(parseVaultUrl(vaultUrl('/v', 'ünï.PNG', 'notes/sub'))).toEqual({ root: '/v', ref: 'ünï.PNG', from: 'notes/sub' })
    expect(parseVaultUrl(vaultUrl('/v', 'pic.png', ''))).toEqual({ root: '/v', ref: 'pic.png', from: '' })
  })

  it('a ref segment holding a `?` or `#` survives, because the renderer encoded it', () => {
    expect(parseVaultUrl(vaultUrl('/v', 'q?a#b.png'))).toEqual({ root: '/v', ref: 'q?a#b.png' })
  })

  it('rejects other schemes and hosts: the renderer bundle host is not a vault', () => {
    expect(parseVaultUrl('https://vault/%2Fv/pic.png')).toBeNull()
    expect(parseVaultUrl('app://yaseen/index.html')).toBeNull()
    expect(parseVaultUrl('app://VAULTS/%2Fv/pic.png')).toBeNull()
    expect(parseVaultUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(parseVaultUrl('not a url')).toBeNull()
  })

  it('rejects a relative root, an empty ref, and a malformed escape', () => {
    expect(parseVaultUrl('app://vault/v/pic.png')).toBeNull()
    expect(parseVaultUrl('app://vault/%2Fv')).toBeNull()
    expect(parseVaultUrl('app://vault/%2Fv/')).toBeNull()
    expect(parseVaultUrl('app://vault/%2Fv/%E0%A4%A.png')).toBeNull()
    expect(parseVaultUrl('app://vault')).toBeNull()
  })

  it('a `..` in the URL path eats the root segment and leaves a relative one — null, in every spelling the parser collapses', () => {
    // `/%2FUsers%2Fx/../../etc/passwd` → pathname `/etc/passwd`: root "etc" is not absolute.
    expect(parseVaultUrl('app://vault/%2FUsers%2Fx/../../etc/passwd')).toBeNull()
    expect(parseVaultUrl('app://vault/%2FUsers%2Fx/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
    expect(parseVaultUrl('app://vault/%2FUsers%2Fx/.%2e/etc/x.png')).toBeNull()
    expect(parseVaultUrl(`app://vault/${encodeURIComponent('/v')}/../pic.png`)).toBeNull()
  })

  it('a `..` can only swap the root for another absolute root the renderer could have named outright', () => {
    expect(parseVaultUrl('app://vault/%2Fv/../%2Fother/x.png')).toEqual({ root: '/other', ref: 'x.png' })
  })

  it('a `..` encoded inside a ref segment is not collapsed — it reaches the resolver as a ref', () => {
    expect(parseVaultUrl('app://vault/%2FUsers%2Fx/..%2F..%2Fetc%2Fx.png')).toEqual({ root: '/Users/x', ref: '../../etc/x.png' })
  })
})

describe('resolveVaultUrl', () => {
  const file = async (url: string) => (await resolveVaultUrl(url))?.path ?? null

  it('walks the Obsidian order: note-relative, then root-relative, then basename', async () => {
    expect(await file(vaultUrl(root, 'pic.png', 'notes'))).toBe(path.join(root, 'notes', 'pic.png'))
    expect(await file(vaultUrl(root, 'pics/pic.png', 'notes'))).toBe(path.join(root, 'pics', 'pic.png'))
    expect(await file(vaultUrl(root, 'a b.png', 'notes/sub'))).toBe(path.join(root, 'pics', 'a b.png'))
    expect(await file(vaultUrl(root, 'ünï.PNG'))).toBe(path.join(root, 'ünï.PNG'))
  })

  it('a ref in the wrong case still lands on the file: the path step on APFS, the basename walk on a case-sensitive volume', async () => {
    const found = await file(vaultUrl(root, 'ÜNÏ.png'))
    expect(found?.toLowerCase()).toBe(path.join(root, 'ünï.png').toLowerCase())
  })

  it('the mime comes from the ref extension, lowercased, whatever the file is spelled', async () => {
    expect((await resolveVaultUrl(vaultUrl(root, 'ünï.PNG')))?.mime).toBe('image/png')
    expect((await resolveVaultUrl(vaultUrl(root, 'pics/pic.png')))?.mime).toBe('image/png')
  })

  it('serves IMAGE_EXTENSIONS only: a drawing, a note or a directory under the same root is null', async () => {
    expect(await resolveVaultUrl(vaultUrl(root, 'sketch.excalidraw'))).toBeNull()
    expect(await resolveVaultUrl(vaultUrl(root, 'note.md'))).toBeNull()
    expect(await resolveVaultUrl(vaultUrl(root, 'pics'))).toBeNull()
  })

  it('null for a miss, an escape, or a URL that does not parse', async () => {
    expect(await resolveVaultUrl(vaultUrl(root, 'missing.png'))).toBeNull()
    expect(await resolveVaultUrl(vaultUrl(root, 'missing.png', '..'))).toBeNull()
    expect(await resolveVaultUrl('https://example.com/pic.png')).toBeNull()
  })

  it('an escaping `from` is skipped, not honoured: the basename walk still answers from INSIDE the vault', async () => {
    expect(await file(vaultUrl(root, 'pic.png', '..'))).toBe(path.join(root, 'notes', 'pic.png'))
  })

  it('a ref escaping the root never reaches a file outside it, on the note step or the root step', async () => {
    const outside = path.join(root, '..', 'escaped-yaz1658.png')
    await writeFile(outside, PNG)
    try {
      expect(await resolveVaultUrl(vaultUrl(root, '../escaped-yaz1658.png'))).toBeNull()
      expect(await resolveVaultUrl(vaultUrl(root, '../../escaped-yaz1658.png', 'notes'))).toBeNull()
      expect(await resolveVaultUrl(vaultUrl(root, outside))).toBeNull()
    } finally {
      await rm(outside, { force: true })
    }
  })
})

describe('serveVaultImage', () => {
  const fetchFile = () => vi.fn(async (_fileUrl: string) => new Response('bytes'))

  it('200 with the asset pipe mime and no-cache, the body streamed from the file fetch of the resolved path', async () => {
    const fetcher = fetchFile()
    const res = await serveVaultImage(new Request(vaultUrl(root, 'a b.png', 'notes')), fetcher)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    expect(await res.text()).toBe('bytes')
    expect(fetcher).toHaveBeenCalledWith(pathToFileURL(path.join(root, 'pics', 'a b.png')).toString())
  })

  it('404 — and no file fetch — for a miss, an escape, a non-image and a foreign host', async () => {
    const fetcher = fetchFile()
    const outside = path.join(root, '..', 'escaped-yaz1658.png')
    await writeFile(outside, PNG)
    try {
      for (const url of [vaultUrl(root, 'missing.png'), vaultUrl(root, '../escaped-yaz1658.png'), vaultUrl(root, 'sketch.excalidraw'), vaultUrl(root, 'note.md'), 'app://yaseen/index.html']) {
        expect((await serveVaultImage(new Request(url), fetcher)).status, url).toBe(404)
      }
    } finally {
      await rm(outside, { force: true })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('revealVaultImage', () => {
  it('a vault src reveals the file the protocol would have served', async () => {
    const reveal = vi.fn(async (_file: string) => undefined)
    await revealVaultImage(vaultUrl(root, 'pic.png', 'notes'), reveal)
    expect(reveal).toHaveBeenCalledWith(path.join(root, 'notes', 'pic.png'))
  })

  it('an http, data: or bundle src is a no-op: there is no file to reveal', async () => {
    const reveal = vi.fn(async (_file: string) => undefined)
    for (const src of ['https://example.com/pic.png', 'data:image/png;base64,AAAA', 'app://yaseen/logo.png', vaultUrl(root, 'missing.png')]) {
      await revealVaultImage(src, reveal)
    }
    expect(reveal).not.toHaveBeenCalled()
  })
})
