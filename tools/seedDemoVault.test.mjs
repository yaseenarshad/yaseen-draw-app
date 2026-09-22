import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXT, assetFileName, defaultOrigin, defaultVault, fileIdFor, fracIndex, parseArgs } from './lib/seedDemoVault.mjs'

/**
 * `tools/seedDemoVault.mjs` writes a ~130 MB vault, so the suite covers the pure rules only: the
 * content-id and filename the app resolves assets by, the element ordering key, and the argument
 * parsing that decides WHICH directory gets wiped.
 */

describe('asset naming', () => {
  it('ids an asset by the SHA-1 of its bytes, like Excalidraw generateIdFromFile', () => {
    const bytes = Buffer.from('hello')
    expect(fileIdFor(bytes)).toBe(createHash('sha1').update(bytes).digest('hex'))
    expect(fileIdFor(bytes)).toMatch(/^[0-9a-f]{40}$/)
  })

  it('gives the same id to the same bytes, so one image pasted twice is one file (🔒 YAZ-1775 D3)', () => {
    expect(fileIdFor(Buffer.from('same'))).toBe(fileIdFor(Buffer.from('same')))
    expect(fileIdFor(Buffer.from('same'))).not.toBe(fileIdFor(Buffer.from('other')))
  })

  it('names the file <sha1>.<ext> for every mime the vault seeds', () => {
    const id = fileIdFor(Buffer.from('x'))
    expect(assetFileName(id, 'image/png')).toBe(`${id}.png`)
    expect(assetFileName(id, 'image/jpeg')).toBe(`${id}.jpg`)
    expect(assetFileName(id, 'image/svg+xml')).toBe(`${id}.svg`)
    expect(assetFileName(id, 'image/gif')).toBe(`${id}.gif`)
    expect(Object.keys(EXT)).toHaveLength(4)
  })

  it('refuses a mime it has no extension for rather than writing a bare sha', () => {
    expect(() => assetFileName(fileIdFor(Buffer.from('x')), 'image/tiff')).toThrow(/unsupported asset mime/)
  })
})

describe('fracIndex', () => {
  it('sorts as a string in generation order, which plain counting would not', () => {
    const keys = Array.from({ length: 200 }, (_, i) => fracIndex(i))
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('switches to the longer key form after 62 elements', () => {
    expect(fracIndex(0)).toBe('a0')
    expect(fracIndex(61)).toBe('az')
    expect(fracIndex(62)).toBe('b00')
  })
})

describe('parseArgs', () => {
  it('defaults to the demo vault and the bare origin beside it on the Desktop', () => {
    const args = parseArgs([])
    expect(args.vault).toBe(path.join(homedir(), 'Desktop', 'Port to Electron App - Local Version'))
    expect(args.origin).toBe(path.join(homedir(), 'Desktop', 'Port to Electron App - Local Version (origin).git'))
    expect(args.vault).toBe(defaultVault())
    expect(args.origin).toBe(defaultOrigin())
  })

  it('takes --vault and --origin and resolves them to absolute paths', () => {
    const args = parseArgs(['--vault', 'scratch/vault', '--origin', 'scratch/origin.git'])
    expect(args.vault).toBe(path.resolve('scratch/vault'))
    expect(args.origin).toBe(path.resolve('scratch/origin.git'))
  })

  it('leaves the other path at its default when only one is given', () => {
    expect(parseArgs(['--vault', '/tmp/v']).origin).toBe(defaultOrigin())
    expect(parseArgs(['--origin', '/tmp/o.git']).vault).toBe(defaultVault())
  })

  it('throws rather than wiping a default the caller did not mean', () => {
    expect(() => parseArgs(['--vault'])).toThrow(/needs a directory/)
    expect(() => parseArgs(['--vault', '--origin', '/tmp/o.git'])).toThrow(/needs a directory/)
    expect(() => parseArgs(['--vualt', '/tmp/v'])).toThrow(/unknown argument/)
    expect(() => parseArgs(['/tmp/v'])).toThrow(/unknown argument/)
  })

  it('reports --help without deciding anything else', () => {
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs([]).help).toBe(false)
  })
})
