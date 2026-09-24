import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DRAWIO_CSP, DRAWIO_ORIGIN, drawioFilePath, resolveDrawioDir, serveDrawio } from './assets'

describe('drawioFilePath — the traversal guard (🔒 YAZ-1802 D4)', () => {
  const dir = '/app/out/drawio'

  it('maps a URL path to a file inside the webapp; `/` is index.html', () => {
    expect(drawioFilePath(dir, '/')).toBe('/app/out/drawio/index.html')
    expect(drawioFilePath(dir, '/js/PostConfig.js')).toBe('/app/out/drawio/js/PostConfig.js')
    expect(drawioFilePath(dir, '/yaseen-fonts/Inter/Inter%20Regular.woff2')).toBe('/app/out/drawio/yaseen-fonts/Inter/Inter Regular.woff2')
  })

  it('never answers a path outside the folder, however it is spelled', () => {
    for (const p of ['/../secret', '/js/../../secret', '/%2e%2e/secret', '/%2E%2E%2Fsecret', '/..%2f..%2fetc/passwd', '/a%00b', '/%E0%A4%A']) expect(drawioFilePath(dir, p), p).toBeNull()
    expect(drawioFilePath(dir, '/js/../index.html')).toBe('/app/out/drawio/index.html')
  })
})

describe('resolveDrawioDir (🔒 YAZ-1802 D5)', () => {
  const opts = { mainDir: '/repo/desktop/out/main', appPath: '/repo/desktop' }

  it('dev serves the pack cache when it is there, else the built copy', () => {
    const cache = path.join('/repo/desktop/.cache/drawio', 'v31.5.2')
    expect(resolveDrawioDir({ ...opts, isPackaged: false, exists: (p) => p === path.join(cache, 'index.html') })).toBe(cache)
    expect(resolveDrawioDir({ ...opts, isPackaged: false, exists: () => false })).toBe('/repo/desktop/out/drawio')
  })

  it('a packaged app only ever serves out/drawio beside its main bundle', () => {
    expect(resolveDrawioDir({ ...opts, isPackaged: true, exists: () => true })).toBe('/repo/desktop/out/drawio')
  })
})

describe('DRAWIO_CSP (🔒 YAZ-1802 D4)', () => {
  const directive = (name: string) => DRAWIO_CSP.split('; ').find((d) => d.startsWith(`${name} `)) ?? ''

  it('closes the network: fetch, images, fonts and frames admit this origin (plus inline data) only', () => {
    expect(directive('connect-src')).toBe(`connect-src 'self' ${DRAWIO_ORIGIN}`)
    expect(directive('img-src')).toBe(`img-src 'self' ${DRAWIO_ORIGIN} data: blob:`)
    expect(directive('font-src')).toBe(`font-src 'self' ${DRAWIO_ORIGIN} data:`)
    expect(directive('default-src')).toBe(`default-src 'self' ${DRAWIO_ORIGIN}`)
    expect(DRAWIO_CSP).not.toMatch(/https?:|\*/)
    expect(directive('object-src')).toBe("object-src 'none'")
  })
})

describe('serveDrawio — one app://drawio request (🔒 YAZ-1802 D4 / D17)', () => {
  const dir = '/app/out/drawio'
  const file = () => vi.fn(async () => new Response('js', { headers: { 'Content-Type': 'text/javascript' } }))

  it('answers the file with its own headers plus the CSP; dev adds no-store, a packaged app caches', async () => {
    const fetchFile = file()
    const dev = await serveDrawio(dir, '/js/PostConfig.js', { fetchFile, noStore: true })
    expect(fetchFile).toHaveBeenCalledWith('file:///app/out/drawio/js/PostConfig.js')
    expect(await dev.text()).toBe('js')
    expect([dev.status, dev.headers.get('Content-Type'), dev.headers.get('Content-Security-Policy'), dev.headers.get('Cache-Control')]).toEqual([200, 'text/javascript', DRAWIO_CSP, 'no-store'])
    const packaged = await serveDrawio(dir, '/', { fetchFile, noStore: false })
    expect(fetchFile).toHaveBeenLastCalledWith('file:///app/out/drawio/index.html')
    expect(packaged.headers.get('Cache-Control')).toBeNull()
  })

  it('a traversal is a 404 that never touches the disk, and a missing file a 404 — both under the CSP', async () => {
    const fetchFile = file()
    const escape = await serveDrawio(dir, '/%2e%2e/%2e%2e/etc/passwd', { fetchFile, noStore: true })
    expect(fetchFile).not.toHaveBeenCalled()
    const missing = await serveDrawio(dir, '/nope.js', { fetchFile: async () => Promise.reject(new Error('ERR_FILE_NOT_FOUND')), noStore: true })
    for (const res of [escape, missing]) expect([res.status, res.headers.get('Content-Security-Policy')]).toEqual([404, DRAWIO_CSP])
  })

  it('tells the dev log every 404 — how a file the prune should have kept shows up after a bump (🔒 YAZ-1802 D5)', async () => {
    const onNotFound = vi.fn()
    await serveDrawio(dir, '/stencils/aws4.xml', { fetchFile: async () => Promise.reject(new Error('ERR_FILE_NOT_FOUND')), noStore: true, onNotFound })
    const gone = await serveDrawio(dir, '/js/gone.js', { fetchFile: async () => new Response('', { status: 404 }), noStore: true, onNotFound })
    await serveDrawio(dir, '/js/app.min.js', { fetchFile: file(), noStore: true, onNotFound })
    expect(onNotFound.mock.calls).toEqual([['/stencils/aws4.xml'], ['/js/gone.js']])
    expect([gone.status, gone.headers.get('Content-Security-Policy')]).toEqual([404, DRAWIO_CSP])
  })
})

describe('our user agent (🔒 YAZ-1802 D4)', () => {
  it('never names draw.io, so the webapp can never switch into drawio-desktop’s Electron mode', () => {
    // Electron's user agent carries the app's name — the package's, the product's, or `app.setName`'s —
    // and draw.io's `bootstrap.js` wants ` draw.io/` in it.
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { name: string; build: { productName: string } }
    const setName = /app\.setName\('([^']+)'\)/.exec(readFileSync(new URL('../index.ts', import.meta.url), 'utf8'))?.[1]
    for (const name of [pkg.name, pkg.build.productName, setName]) expect(name).toMatch(/^(?!.*draw\.io).+$/i)
  })
})
