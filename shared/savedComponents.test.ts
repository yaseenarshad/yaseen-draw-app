/**
 * The saved-component RULES (🔒 YAZ-1775 D5, YAZ-1819), with no disk and no engine: slugging, the index's
 * shape, and what a fragment has to look like before it may be written or inserted.
 */
import { describe, expect, it } from 'vitest'
import { MAX_COMPONENT_NAME_LENGTH, type ComponentItem } from './types'
import {
  EMPTY_COMPONENTS_INDEX,
  MAX_COMPONENT_SLUG_LENGTH,
  componentFileName,
  componentPreviewName,
  indexFromSlugs,
  isValidComponentSlug,
  normalizeComponentName,
  parseComponentFragment,
  putComponentItem,
  removeComponentItem,
  renameComponentItem,
  sanitizeComponentsIndex,
  slugForComponentName,
  slugOfComponentFile,
  slugOfComponentPreview,
  uniqueComponentSlug,
} from './savedComponents'

const item = (over: Partial<ComponentItem> = {}): ComponentItem => ({ slug: 'a-card', name: 'A card', elementCount: 2, createdAt: 10, updatedAt: 10, ...over })

describe('slugForComponentName — kebab of the name', () => {
  it('lowercases and joins the words with hyphens', () => {
    expect(slugForComponentName('Customer Acquisition Cost')).toBe('customer-acquisition-cost')
  })

  it('collapses every run of punctuation, spacing and symbols into ONE hyphen, and trims the ends', () => {
    expect(slugForComponentName('  ***Flow --- chart!!  ')).toBe('flow-chart')
    expect(slugForComponentName('a/b\\c:d')).toBe('a-b-c-d')
  })

  it('keeps digits, and never emits a leading or trailing hyphen', () => {
    expect(slugForComponentName('Step 2 — done')).toBe('step-2-done')
    expect(slugForComponentName('-edge-')).toBe('edge')
  })

  it('a name with nothing sluggable in it still gets a usable slug', () => {
    // Non-latin names are common and must not become an empty path segment.
    expect(slugForComponentName('漢字')).toBe('component')
    expect(slugForComponentName('!!!')).toBe('component')
    expect(slugForComponentName('')).toBe('component')
  })

  it('never produces a path separator, a dot or a control character — it IS a filename', () => {
    for (const hostile of ['../escape', 'a\u0000b', '.hidden', 'a.b.c', 'C:\\Windows', 'a\nb']) {
      const slug = slugForComponentName(hostile)
      expect(isValidComponentSlug(slug), hostile).toBe(true)
    }
  })

  it('is bounded, so a pasted paragraph cannot become a filename the OS refuses', () => {
    expect(slugForComponentName('word '.repeat(80)).length).toBeLessThanOrEqual(MAX_COMPONENT_SLUG_LENGTH)
  })
})

describe('uniqueComponentSlug — -2, -3 (never -1)', () => {
  it('a free slug is used as it is', () => {
    expect(uniqueComponentSlug('card', new Set())).toBe('card')
  })

  it('a taken slug counts up from 2, skipping the ones already there', () => {
    expect(uniqueComponentSlug('card', new Set(['card']))).toBe('card-2')
    expect(uniqueComponentSlug('card', new Set(['card', 'card-2', 'card-3']))).toBe('card-4')
  })

  it('the suffixed slug is still a valid one, however long the base and however high the count', () => {
    expect(isValidComponentSlug(uniqueComponentSlug('card', new Set(['card'])))).toBe(true)
    // A maximum-length stem plus `-100`: the reserve has to grow with the number, or the slug
    // overflows and every later read, preview and delete of that component is refused.
    const long = 'a'.repeat(MAX_COMPONENT_SLUG_LENGTH)
    const taken = new Set([long])
    for (let n = 2; n <= 101; n++) {
      const slug = uniqueComponentSlug(long, taken)
      expect(slug.length, slug).toBeLessThanOrEqual(MAX_COMPONENT_SLUG_LENGTH)
      expect(isValidComponentSlug(slug), slug).toBe(true)
      taken.add(slug)
    }
  })
})

describe('slugOfComponentPreview — half the watcher’s relevance filter', () => {
  it('reads a slug back off a preview name, and nothing else', () => {
    expect(slugOfComponentPreview('a-card.png')).toBe('a-card')
    expect(slugOfComponentPreview(componentPreviewName('long-one-2'))).toBe('long-one-2')
  })

  it('refuses a fragment, a tmp file, a bad slug and a bare extension', () => {
    expect(slugOfComponentPreview(componentFileName('a-card'))).toBeNull()
    expect(slugOfComponentPreview('a-card.png.tmp-1')).toBeNull()
    expect(slugOfComponentPreview('..png')).toBeNull()
    expect(slugOfComponentPreview('.png')).toBeNull()
    expect(slugOfComponentPreview('A-Card.png')).toBeNull()
  })
})

describe('isValidComponentSlug — the path-segment guard', () => {
  it('accepts lowercase words joined by single hyphens', () => {
    expect(isValidComponentSlug('a')).toBe(true)
    expect(isValidComponentSlug('a-card-2')).toBe(true)
  })

  it('refuses every shape that could leave the components folder or name something else', () => {
    for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', 'a.b', 'A', 'a b', '-a', 'a-', 'a--b', 'a\u0000', 'a\n', 'ä']) {
      expect(isValidComponentSlug(bad), bad).toBe(false)
    }
  })

  it('refuses anything that is not a string', () => {
    for (const bad of [undefined, null, 3, {}, []]) expect(isValidComponentSlug(bad)).toBe(false)
  })
})

describe('componentFileName / componentPreviewName / slugOfComponentFile', () => {
  it('a slug names both files, and the fragment name reads back as the slug', () => {
    expect(componentFileName('a-card')).toBe('a-card.excalidraw')
    expect(componentPreviewName('a-card')).toBe('a-card.png')
    expect(slugOfComponentFile('a-card.excalidraw')).toBe('a-card')
  })

  it('anything that is not a valid fragment name reads back as null', () => {
    for (const bad of ['a-card.png', 'a-card', 'A-Card.excalidraw', '.excalidraw', 'a.b.excalidraw']) {
      expect(slugOfComponentFile(bad), bad).toBe(null)
    }
  })
})

describe('normalizeComponentName', () => {
  it('trims, and rejects a name that is nothing but whitespace', () => {
    expect(normalizeComponentName('  A card  ')).toBe('A card')
    expect(normalizeComponentName('   ')).toBe(null)
    expect(normalizeComponentName(7)).toBe(null)
  })

  it('caps at the web app’s own length rather than rejecting a long one', () => {
    expect(normalizeComponentName('x'.repeat(500))).toBe('x'.repeat(MAX_COMPONENT_NAME_LENGTH))
  })
})

describe('sanitizeComponentsIndex — lenient file, strict row', () => {
  it('a well-formed index reads back row for row', () => {
    expect(sanitizeComponentsIndex({ version: 1, items: [item()] })).toEqual({ version: 1, items: [item()] })
  })

  it('a bad ROW is dropped and the rest survive — one hand edit does not cost the library', () => {
    const good = item({ slug: 'good' })
    expect(sanitizeComponentsIndex({ version: 1, items: [{ slug: 'Bad Slug', name: 'x', elementCount: 1, createdAt: 1, updatedAt: 1 }, good] })).toEqual({ version: 1, items: [good] })
    expect(sanitizeComponentsIndex({ version: 1, items: [{ ...item(), elementCount: 'two' }, good] })).toEqual({ version: 1, items: [good] })
  })

  it('a duplicate slug keeps the FIRST row only — the folder has one file per slug', () => {
    const first = item({ name: 'first' })
    expect(sanitizeComponentsIndex({ version: 1, items: [first, item({ name: 'second' })] })).toEqual({ version: 1, items: [first] })
  })

  it('anything that is not a version-1 index at all is null — the caller moves the file aside', () => {
    for (const bad of [null, 3, [], {}, { version: 2, items: [] }, { version: 1, items: {} }]) {
      expect(sanitizeComponentsIndex(bad)).toBe(null)
    }
  })

  it('an empty index is a valid index', () => {
    expect(sanitizeComponentsIndex({ version: 1, items: [] })).toEqual(EMPTY_COMPONENTS_INDEX)
  })
})

describe('indexFromSlugs — the index REBUILT from the folder (🔒 YAZ-1775 D5)', () => {
  const seen = [
    { slug: 'beta', elementCount: 3, createdAt: 20, updatedAt: 20 },
    { slug: 'alpha', elementCount: 1, createdAt: 10, updatedAt: 30 },
  ]

  it('names a rebuilt row after its own slug and orders by updatedAt, newest first', () => {
    expect(indexFromSlugs(seen, EMPTY_COMPONENTS_INDEX)).toEqual({
      version: 1,
      items: [
        { slug: 'alpha', name: 'alpha', elementCount: 1, createdAt: 10, updatedAt: 30 },
        { slug: 'beta', name: 'beta', elementCount: 3, createdAt: 20, updatedAt: 20 },
      ],
    })
  })

  it('a row the OLD index still knows keeps its name and its dates — a rebuild is not a reset', () => {
    const known = { version: 1 as const, items: [item({ slug: 'alpha', name: 'Alpha board', elementCount: 9, createdAt: 1, updatedAt: 2 })] }
    expect(indexFromSlugs(seen, known).items.find((i) => i.slug === 'alpha')).toEqual({ slug: 'alpha', name: 'Alpha board', elementCount: 9, createdAt: 1, updatedAt: 2 })
  })

  it('a row whose FILE is gone drops out — the folder is the truth, the index is the cache', () => {
    const known = { version: 1 as const, items: [item({ slug: 'ghost' })] }
    expect(indexFromSlugs([], known)).toEqual(EMPTY_COMPONENTS_INDEX)
  })
})

describe('putComponentItem / renameComponentItem / removeComponentItem', () => {
  it('a new item goes to the head, which is where the list is read from', () => {
    const index = putComponentItem(EMPTY_COMPONENTS_INDEX, item({ slug: 'a' }))
    expect(putComponentItem(index, item({ slug: 'b', updatedAt: 20 })).items.map((i) => i.slug)).toEqual(['b', 'a'])
  })

  it('an item with a slug already there REPLACES it in place rather than doubling it', () => {
    const index = putComponentItem(EMPTY_COMPONENTS_INDEX, item({ slug: 'a', name: 'old' }))
    const next = putComponentItem(index, item({ slug: 'a', name: 'new' }))
    expect(next.items).toEqual([item({ slug: 'a', name: 'new' })])
  })

  it('rename changes the name and the stamp, and NOTHING else — the slug is the identity', () => {
    const index = putComponentItem(EMPTY_COMPONENTS_INDEX, item({ slug: 'a', name: 'old', createdAt: 5 }))
    expect(renameComponentItem(index, 'a', 'new', 99).items).toEqual([item({ slug: 'a', name: 'new', createdAt: 5, updatedAt: 99 })])
  })

  it('renaming a slug that is not there is the same index, unchanged by identity', () => {
    const index = putComponentItem(EMPTY_COMPONENTS_INDEX, item())
    expect(renameComponentItem(index, 'nope', 'x', 1)).toBe(index)
  })

  it('remove drops exactly the one row, and removing a stranger is the same index', () => {
    const index = putComponentItem(putComponentItem(EMPTY_COMPONENTS_INDEX, item({ slug: 'a' })), item({ slug: 'b' }))
    expect(removeComponentItem(index, 'a').items.map((i) => i.slug)).toEqual(['b'])
    expect(removeComponentItem(index, 'nope')).toBe(index)
  })
})

describe('parseComponentFragment — what may be written, and what may be inserted', () => {
  const fragment = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-draw', elements: [{ id: 'e1', type: 'rectangle' }], appState: {}, files: {}, ...over })

  it('reads the elements and the embedded files out of a whole document', () => {
    const files = { abc: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' } }
    expect(parseComponentFragment(fragment({ files }))).toEqual({ elements: [{ id: 'e1', type: 'rectangle' }], files })
  })

  it('a fragment with no files at all reads as an empty map', () => {
    expect(parseComponentFragment(fragment()).files).toEqual({})
  })

  it('throws on anything that is not an Excalidraw document with elements', () => {
    expect(() => parseComponentFragment('not json')).toThrow()
    expect(() => parseComponentFragment('[]')).toThrow()
    expect(() => parseComponentFragment(JSON.stringify({ type: 'excalidraw', version: 2 }))).toThrow()
  })

  it('throws on an EMPTY component — a fragment with no elements is not one', () => {
    expect(() => parseComponentFragment(fragment({ elements: [] }))).toThrow(/at least one element/)
  })

  it('drops a soft-deleted element rather than inserting a ghost', () => {
    const json = fragment({ elements: [{ id: 'e1', type: 'rectangle' }, { id: 'e2', type: 'rectangle', isDeleted: true }] })
    expect(parseComponentFragment(json).elements).toEqual([{ id: 'e1', type: 'rectangle' }])
  })

  it('throws when an image element names bytes the fragment does not carry — 🔒 YAZ-1775 D5 says self-contained', () => {
    const json = fragment({ elements: [{ id: 'e1', type: 'image', fileId: 'missing' }] })
    expect(() => parseComponentFragment(json)).toThrow(/missing/)
  })

  it('accepts an image element whose bytes ARE embedded', () => {
    const json = fragment({
      elements: [{ id: 'e1', type: 'image', fileId: 'abc' }],
      files: { abc: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' } },
    })
    expect(parseComponentFragment(json).elements).toHaveLength(1)
  })
})
