import { describe, expect, it } from 'vitest'
import {
  ASSETS_DIR,
  ORPHAN_MAX_AGE_MS,
  assetFileName,
  extForMime,
  fileIdOfAssetName,
  isValidFileId,
  mimeForAssetExt,
  parseDataUrl,
  planOrphanSweep,
  referencedFileIds,
  stripEmbeddedFiles,
  unpersistedFiles,
  type AssetListingEntry,
  type DrawingFileData,
} from './drawingAssets'

const png = (payload = 'aGk='): DrawingFileData => ({ mimeType: 'image/png', dataURL: `data:image/png;base64,${payload}` })

describe('names and mimes', () => {
  it('maps every mime the store keeps, and nothing else', () => {
    expect(extForMime('image/png')).toBe('png')
    expect(extForMime('image/jpeg')).toBe('jpg')
    expect(extForMime('image/svg+xml')).toBe('svg')
    expect(extForMime('image/avif')).toBe('avif')
    expect(extForMime('image/bmp')).toBeNull()
    expect(extForMime('application/json')).toBeNull()
  })

  it('reads back every extension it writes — and `jpeg`, which it never writes but files carry', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp', 'image/avif']) {
      expect(mimeForAssetExt(extForMime(mime)!), mime).toBe(mime)
    }
    expect(mimeForAssetExt('jpeg')).toBe('image/jpeg')
    expect(mimeForAssetExt('PNG')).toBe('image/png') // a file from another OS may shout
    expect(mimeForAssetExt('excalidraw')).toBeNull()
    expect(mimeForAssetExt('txt')).toBeNull()
  })

  it('names a file `<id>.<ext>` and refuses a mime it cannot store', () => {
    expect(assetFileName('abc123', 'image/png')).toBe('abc123.png')
    expect(assetFileName('abc123', 'image/bmp')).toBeNull()
  })

  it('reads the id back out of a name, and refuses dot-entries and empty stems', () => {
    expect(fileIdOfAssetName('abc123.png')).toBe('abc123')
    expect(fileIdOfAssetName('abc.123.png')).toBe('abc.123')
    expect(fileIdOfAssetName('noext')).toBe('noext')
    expect(fileIdOfAssetName('.DS_Store')).toBeNull()
    expect(fileIdOfAssetName('.png')).toBeNull()
  })

  it('lives under the vault-root folder the tree hides', () => {
    expect(ASSETS_DIR).toBe('assets')
  })
})

describe('isValidFileId — this id becomes a path segment', () => {
  it('takes the engine`s own hex ids and the wider plain-token shape', () => {
    expect(isValidFileId('3a7b9f0e1c2d')).toBe(true)
    expect(isValidFileId('A-Z_az09')).toBe(true)
    expect(isValidFileId('a'.repeat(128))).toBe(true)
  })

  it('refuses anything that could leave the folder, forge an extension, or not be a string', () => {
    for (const bad of ['', '..', '../escape', 'a/b', 'a\\b', 'a.png', 'a b', 'a\0b', 'a'.repeat(129), null, undefined, 7, {}, ['a']]) {
      expect(isValidFileId(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('referencedFileIds', () => {
  it('collects live image elements only — a DELETED one keeps its id for undo but not its bytes', () => {
    const ids = referencedFileIds([
      { type: 'image', fileId: 'live' },
      { type: 'image', fileId: 'gone', isDeleted: true },
      { type: 'image', fileId: 'live' }, // the same picture twice
      { type: 'rectangle', fileId: 'notanimage' },
      { type: 'image', fileId: '' },
      { type: 'image' },
      null,
      'nonsense',
    ])
    expect([...ids]).toEqual(['live'])
  })

  it('answers an empty set for an empty scene', () => {
    expect(referencedFileIds([]).size).toBe(0)
  })
})

describe('parseDataUrl', () => {
  it('splits a base64 data URL into its mime and payload', () => {
    expect(parseDataUrl('data:image/png;base64,aGk=')).toEqual({ mimeType: 'image/png', base64: 'aGk=' })
    expect(parseDataUrl('data:image/svg+xml;base64,')).toEqual({ mimeType: 'image/svg+xml', base64: '' })
  })

  it('refuses anything that is not base64 BYTES — a remote URL most of all', () => {
    for (const bad of ['https://example.com/a.png', 'data:image/png,raw', 'data:image/png;base64,<script>', 'not a url', '']) {
      expect(parseDataUrl(bad), bad).toBeNull()
    }
  })
})

describe('stripEmbeddedFiles', () => {
  const legacy = JSON.stringify({ type: 'excalidraw', elements: [{ type: 'image', fileId: 'a' }], files: { a: png(), bad: { mimeType: 'image/png', dataURL: 'https://cdn/x.png' }, worse: 7 } })

  it('lifts the usable entries out and writes the scene with an empty files map', () => {
    const { json, embedded } = stripEmbeddedFiles(legacy)
    expect(Object.keys(embedded)).toEqual(['a'])
    expect(embedded.a).toEqual(png())
    const parsed = JSON.parse(json) as { files: unknown; elements: unknown[] }
    expect(parsed.files).toEqual({})
    // The drawing itself is untouched — only its baggage moved.
    expect(parsed.elements).toEqual([{ type: 'image', fileId: 'a' }])
    expect(json.endsWith('\n')).toBe(true)
  })

  it('is BYTE-STABLE on a scene that is already lean: an untouched save must not churn the vault`s git history', () => {
    const lean = `${JSON.stringify({ type: 'excalidraw', elements: [], files: {} }, null, 2)}\n`
    const { json, embedded } = stripEmbeddedFiles(lean)
    expect(json).toBe(lean)
    expect(embedded).toEqual({})
    // …and running it again over its own output changes nothing either.
    expect(stripEmbeddedFiles(json).json).toBe(lean)
  })

  it('normalises a lean scene that is spelled differently (minified, or with no files key at all)', () => {
    const minified = '{"type":"excalidraw","elements":[]}'
    const { json, embedded } = stripEmbeddedFiles(minified)
    expect(embedded).toEqual({})
    expect(JSON.parse(json)).toEqual({ type: 'excalidraw', elements: [], files: {} })
  })

  it('is idempotent on a legacy scene: the second pass finds nothing left to lift', () => {
    const once = stripEmbeddedFiles(legacy)
    const twice = stripEmbeddedFiles(once.json)
    expect(twice.embedded).toEqual({})
    expect(twice.json).toBe(once.json)
  })

  it('throws on bytes that are not a scene object', () => {
    for (const bad of ['', '{ not json', '[1,2]', 'null', '"a string"']) {
      expect(() => stripEmbeddedFiles(bad), bad).toThrow()
    }
  })
})

describe('unpersistedFiles', () => {
  const files = { b: png('Yg=='), a: png('YQ=='), dead: png('ZA=='), old: png('bw==') }

  it('ships only what is REFERENCED and not already on disk, sorted by id', () => {
    const out = unpersistedFiles(files, new Set(['a', 'b', 'old']), new Set(['old']))
    expect(out.map((f) => f.fileId)).toEqual(['a', 'b'])
    expect(out[0]).toEqual({ fileId: 'a', ...png('YQ==') })
  })

  it('never ships a pasted-then-deleted image', () => {
    expect(unpersistedFiles(files, new Set(['a']), new Set()).map((f) => f.fileId)).toEqual(['a'])
  })

  it('ships nothing when the store already has everything', () => {
    expect(unpersistedFiles(files, new Set(['a', 'b']), new Set(['a', 'b']))).toEqual([])
  })
})

describe('planOrphanSweep', () => {
  const NOW = 1_000_000_000_000
  const old = NOW - ORPHAN_MAX_AGE_MS - 1
  const listing: AssetListingEntry[] = [
    { name: 'kept.png', mtime: old }, // referenced
    { name: 'orphan.png', mtime: old }, // unreferenced AND old
    { name: 'fresh.png', mtime: NOW - 60_000 }, // unreferenced but MINUTES old
    { name: 'notes.txt', mtime: old }, // not an asset
    { name: 'noext', mtime: old },
    { name: '.DS_Store', mtime: old },
    { name: 'subfolder', mtime: old, isDir: true },
  ]

  it('trashes only the unreferenced AND old image assets', () => {
    expect(planOrphanSweep(listing, new Set(['kept']), NOW)).toEqual(['orphan.png'])
  })

  it('never touches a file pasted minutes ago — an unsaved paste is not an orphan', () => {
    expect(planOrphanSweep([{ name: 'fresh.png', mtime: NOW }], new Set(), NOW)).toEqual([])
  })

  it('treats exactly-at-the-boundary as still fresh (the guard is strict)', () => {
    expect(planOrphanSweep([{ name: 'edge.png', mtime: NOW - ORPHAN_MAX_AGE_MS }], new Set(), NOW)).toEqual([])
    expect(planOrphanSweep([{ name: 'edge.png', mtime: NOW - ORPHAN_MAX_AGE_MS - 1 }], new Set(), NOW)).toEqual(['edge.png'])
  })

  it('leaves the user`s own files alone whatever their age: dot-entries, folders, foreign extensions', () => {
    expect(planOrphanSweep(listing, new Set(), NOW).sort()).toEqual(['kept.png', 'orphan.png'])
  })

  it('takes a caller-supplied age so a test does not have to wait a day', () => {
    expect(planOrphanSweep([{ name: 'a.png', mtime: NOW - 10 }], new Set(), NOW, 5)).toEqual(['a.png'])
  })
})
