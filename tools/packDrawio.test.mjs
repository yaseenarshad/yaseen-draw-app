import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { DRAWIO_TAG, WAR_BYTES, WAR_SHA256, WAR_URL } from './packDrawio.mjs'
import { fontFaceCss, fontWeightOf, isPrunedEntry, isSafeEntryName, isUnpacked, layOverlay, readZipEntries, unpackWebapp, verifyArchive } from './lib/drawioPack.mjs'

/** A minimal zip writer (local headers + central directory + end record) — enough to feed the reader. */
function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data, method } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const body = method === 8 ? deflateRawSync(data) : data
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, body)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

const temps = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaz-1802-pack-'))
  temps.push(dir)
  return dir
}
/** Every file under `dir`, relative, sorted. */
const filesIn = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1)).sort()
const pinOf = (archive, tag = 'v1') => ({ tag, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') })
const file = (name, text, method = 8) => ({ name, data: Buffer.from(text), method })

describe('packDrawio (🔒 YAZ-1802 D5)', () => {
  it('pins ONE release, and main serves the same tag the script unpacks', () => {
    expect(DRAWIO_TAG).toBe('v31.5.2')
    expect(WAR_URL).toBe('https://github.com/jgraph/drawio/releases/download/v31.5.2/draw.war')
    expect(WAR_BYTES).toBe(53_946_815)
    expect(WAR_SHA256).toMatch(/^[0-9a-f]{64}$/)
    const assets = readFileSync(new URL('../desktop/src/main/drawio/assets.ts', import.meta.url), 'utf8')
    expect(assets).toContain(`export const DRAWIO_TAG = '${DRAWIO_TAG}'`)
  })
})

describe('readZipEntries', () => {
  it('reads stored and deflated entries and directories', () => {
    const big = Buffer.from('draw.io '.repeat(2000))
    const entries = readZipEntries(zip([
      { name: 'js/', data: Buffer.alloc(0), method: 0 },
      { name: 'index.html', data: Buffer.from('<html></html>'), method: 0 },
      { name: 'js/app.min.js', data: big, method: 8 },
    ]))
    expect(entries.map((e) => [e.name, e.isDir])).toEqual([['js/', true], ['index.html', false], ['js/app.min.js', false]])
    expect(entries[1].data().toString()).toBe('<html></html>')
    expect(entries[2].data().equals(big)).toBe(true)
  })

  it('refuses something that is not a zip', () => {
    expect(() => readZipEntries(Buffer.from('not a zip at all, just some bytes'))).toThrow(/not a zip/)
  })
})

describe('verifyArchive — the pin (🔒 YAZ-1802 D5)', () => {
  const archive = zip([file('index.html', '<html></html>')])

  it('accepts exactly the pinned bytes', () => {
    expect(() => verifyArchive(archive, pinOf(archive))).not.toThrow()
  })

  it('refuses a wrong size, and a wrong sha256 naming both hashes', () => {
    expect(() => verifyArchive(archive, { ...pinOf(archive), bytes: 1 })).toThrow(`draw.war is ${archive.length} bytes, expected 1`)
    const pinned = 'f'.repeat(64)
    expect(() => verifyArchive(archive, { ...pinOf(archive), sha256: pinned })).toThrow(`draw.war sha256 ${pinOf(archive).sha256} does not match the pinned ${pinned}`)
  })
})

describe('unpackWebapp + isUnpacked (🔒 YAZ-1802 D5)', () => {
  const war = zip([
    { name: 'js/', data: Buffer.alloc(0), method: 0 },
    file('index.html', '<html></html>', 0),
    file('js/PreConfig.js', '/* draw.io stub */'),
    file('js/viewer-static.min.js', 'viewer'),
    file('stencils/LICENSE', 'stencil terms'),
    file('WEB-INF/web.xml', '<web-app/>'),
    file('service-worker.js', 'sw'),
  ])

  it('writes the webapp pruned, licences kept, stamped with the pin', () => {
    const dir = join(temp(), 'v1')
    expect(unpackWebapp(war, dir, pinOf(war))).toBe(4)
    expect(filesIn(dir)).toEqual(['.yaseen-pack.json', 'index.html', 'js/PreConfig.js', 'js/viewer-static.min.js', 'stencils/LICENSE'])
    expect(isUnpacked(dir, pinOf(war))).toBe(true)
  })

  it('is idempotent by the stamp: another tag or hash, or no folder at all, means unpack', () => {
    const dir = join(temp(), 'v1')
    expect(isUnpacked(dir, pinOf(war))).toBe(false)
    unpackWebapp(war, dir, pinOf(war))
    expect(isUnpacked(dir, pinOf(war, 'v2'))).toBe(false)
    expect(isUnpacked(dir, { ...pinOf(war), sha256: '0'.repeat(64) })).toBe(false)
  })

  it('replaces a previous unpack whole — nothing of the old release lingers', () => {
    const dir = join(temp(), 'v1')
    unpackWebapp(war, dir, pinOf(war))
    const next = zip([file('index.html', '<html>new</html>')])
    unpackWebapp(next, dir, pinOf(next, 'v2'))
    expect(filesIn(dir)).toEqual(['.yaseen-pack.json', 'index.html'])
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('<html>new</html>')
  })

  it('refuses an archive with an unsafe entry name and leaves nothing behind', () => {
    const parent = temp()
    const dir = join(parent, 'v1')
    expect(() => unpackWebapp(zip([file('index.html', 'ok'), file('../escape.js', 'x')]), dir, { tag: 'v1', sha256: 'x' })).toThrow(/unsafe entry name/)
    expect(readdirSync(parent)).toEqual([])
  })
})

describe('layOverlay (🔒 YAZ-1802 D17)', () => {
  function fixture() {
    const root = temp()
    const dir = join(root, 'webapp')
    mkdirSync(join(dir, 'js'), { recursive: true })
    writeFileSync(join(dir, 'js/PreConfig.js'), '/* draw.io stub */')
    writeFileSync(join(dir, 'index.html'), '<html></html>')
    const overlay = join(root, 'overlay')
    mkdirSync(join(overlay, 'js'), { recursive: true })
    writeFileSync(join(overlay, 'js/PreConfig.js'), '/* ours */')
    writeFileSync(join(overlay, 'LICENSE-drawio.txt'), 'Apache')
    const fonts = join(root, 'fonts')
    for (const folder of ['Assistant', 'Inter', 'Roboto', 'IBMPlexMono', 'LiberationSerif']) {
      mkdirSync(join(fonts, folder), { recursive: true })
      writeFileSync(join(fonts, folder, `${folder}-Regular.woff2`), 'woff2')
      writeFileSync(join(fonts, folder, 'README.txt'), 'not a font')
    }
    return { dir, overlay, fonts }
  }

  it('lays our files over draw.io’s, then the woff2 fonts and their sheet; draw.io’s other files stay', () => {
    const { dir, overlay, fonts } = fixture()
    layOverlay(dir, overlay, fonts)
    expect(readFileSync(join(dir, 'js/PreConfig.js'), 'utf8')).toBe('/* ours */')
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('<html></html>')
    expect(existsSync(join(dir, 'LICENSE-drawio.txt'))).toBe(true)
    expect(filesIn(join(dir, 'yaseen-fonts'))).toEqual(['Assistant/Assistant-Regular.woff2', 'IBMPlexMono/IBMPlexMono-Regular.woff2', 'Inter/Inter-Regular.woff2', 'LiberationSerif/LiberationSerif-Regular.woff2', 'Roboto/Roboto-Regular.woff2', 'fonts.css'])
    expect(readFileSync(join(dir, 'yaseen-fonts/fonts.css'), 'utf8')).toContain("url('app://drawio/yaseen-fonts/Inter/Inter-Regular.woff2')")
  })

  it('runs again byte for byte, and a font gone from the source is gone from the webapp', () => {
    const { dir, overlay, fonts } = fixture()
    layOverlay(dir, overlay, fonts)
    writeFileSync(join(fonts, 'Inter', 'Inter-Bold.woff2'), 'woff2')
    layOverlay(dir, overlay, fonts)
    rmSync(join(fonts, 'Inter', 'Inter-Bold.woff2'))
    layOverlay(dir, overlay, fonts)
    expect(filesIn(join(dir, 'yaseen-fonts', 'Inter'))).toEqual(['Inter-Regular.woff2'])
  })

  it('the real overlay ships draw.io’s Apache-2.0 licence, which the war does not carry', () => {
    const licence = readFileSync(new URL('../desktop/drawio-overlay/LICENSE-drawio.txt', import.meta.url), 'utf8')
    expect(licence).toContain('Apache License')
    expect(licence).toContain('Version 2.0, January 2004')
  })
})

describe('isSafeEntryName', () => {
  it('refuses any name that could land outside the target folder', () => {
    for (const bad of ['', '/etc/passwd', '../x', 'js/../../x', 'a\\b', 'a\0b']) expect(isSafeEntryName(bad), bad).toBe(false)
    for (const ok of ['index.html', 'js/app.min.js', 'img/lib/a..b.png']) expect(isSafeEntryName(ok), ok).toBe(true)
  })
})

describe('isPrunedEntry', () => {
  it('drops the servlet folders, source maps, the service worker and the cloud pages', () => {
    for (const name of ['WEB-INF/web.xml', 'META-INF/MANIFEST.MF', 'js/app.min.js.map', 'service-worker.js', 'workbox-05b6c01b.js', 'github.html', 'connect/x.js', 'js/dropbox/a.js'])
      expect(isPrunedEntry(name), name).toBe(true)
  })

  it('keeps what the offline editor and the viewer load, and every licence', () => {
    for (const name of ['index.html', 'js/bootstrap.js', 'js/app.min.js', 'js/viewer-static.min.js', 'js/PreConfig.js', 'js/PostConfig.js', 'stencils/basic.xml', 'resources/dia.txt', 'styles/grapheditor.css', 'math4/es5/startup.js', 'stencils/LICENSE', 'templates/LICENSE', 'js/libavoid-js/LICENSE'])
      expect(isPrunedEntry(name), name).toBe(false)
  })
})

describe('fontFaceCss (🔒 YAZ-1802 D12)', () => {
  it('one @font-face per file, weight read off the name, every URL absolute on the drawio origin', () => {
    const css = fontFaceCss([{ family: 'IBM Plex Mono', folder: 'IBMPlexMono', files: ['IBMPlexMono-Regular.woff2', 'IBMPlexMono-Bold.woff2'] }], 'app://drawio/yaseen-fonts')
    expect(css.trim().split('\n')).toEqual([
      "@font-face { font-family: 'IBM Plex Mono'; src: url('app://drawio/yaseen-fonts/IBMPlexMono/IBMPlexMono-Bold.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }",
      "@font-face { font-family: 'IBM Plex Mono'; src: url('app://drawio/yaseen-fonts/IBMPlexMono/IBMPlexMono-Regular.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }",
    ])
    expect([fontWeightOf('Assistant-SemiBold.woff2'), fontWeightOf('Assistant-Medium.woff2'), fontWeightOf('Inter-Regular.woff2')]).toEqual([600, 500, 400])
  })
})
