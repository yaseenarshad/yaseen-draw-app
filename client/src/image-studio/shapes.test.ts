/**
 * The shapes catalog (YAZ-1818). Pure: the Smart Shapes' half of the engine comes in as a stand-in,
 * so the seven basics, the twelve smart entries, the search and the precomputed tile geometry are
 * all provable with no package loaded and no DOM.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SmartShapeDefinition, SmartShapeId } from '@excalidraw/element'
import type { LocalPoint } from '@excalidraw/math'
import { BASIC_SHAPES, buildShapeCatalog, filterShapeCatalog, getShape, shapeDirection, smartShapeAliases, smartShapeCatalog, smartShapePreview, type SmartShapeApi } from './shapes'

const definition = (over: Partial<SmartShapeDefinition> = {}): SmartShapeDefinition => ({
  id: 'arrow-right' as SmartShapeId,
  title: 'Arrow right',
  kind: 'filled-arrow',
  width: 200,
  height: 100,
  closed: true,
  roundness: null,
  defaults: { shaftRatio: 0.5 },
  handles: ['shaft'],
  ...over,
})

/** The three values `@excalidraw/element` would have supplied, as arithmetic we can predict. */
function fakeSmart(definitions: SmartShapeDefinition[] = [definition()]): SmartShapeApi {
  return {
    SMART_SHAPE_DEFINITIONS: definitions,
    generateSmartShapePoints: (_id, width, height) =>
      [
        [0, 0],
        [width, height / 2],
        [0, height],
      ] as unknown as LocalPoint[],
    createSmartShapeMetadata: (id) => ({ version: 1, id, kind: 'filled-arrow', parameters: { shaftRatio: 0.5 } }),
  }
}

describe('the basics, which need no package at all', () => {
  it('is the seven the web app shipped, in its order', () => {
    expect(BASIC_SHAPES.map(({ id }) => id)).toEqual(['rectangle', 'rounded-rectangle', 'circle', 'diamond', 'triangle', 'hexagon', 'star'])
  })

  it('centres a box on the point it is given and gives it the ported stroke', () => {
    const [element] = BASIC_SHAPES[0].create(1000, 500) as unknown as [Record<string, unknown>]
    expect(element).toMatchObject({ type: 'rectangle', x: 920, y: 445, width: 160, height: 110, strokeColor: '#1b1b1f', strokeWidth: 2, roughness: 1 })
  })

  it('rounds the rounded rectangle and nothing else', () => {
    expect((BASIC_SHAPES[1].create(0, 0)[0] as { roundness?: unknown }).roundness).toEqual({ type: 3 })
    expect((BASIC_SHAPES[0].create(0, 0)[0] as { roundness?: unknown }).roundness).toBeUndefined()
  })

  it('closes a polygon by repeating its first point', () => {
    const line = BASIC_SHAPES[4].create(0, 0)[0] as unknown as { points: [number, number][] }
    expect(line.points[0]).toEqual(line.points[line.points.length - 1])
  })
})

describe('the smart shapes, which need the element package', () => {
  it('renders the basics alone until it lands, then grows by the definitions', () => {
    expect(buildShapeCatalog(null)).toHaveLength(BASIC_SHAPES.length)
    expect(buildShapeCatalog(fakeSmart())).toHaveLength(BASIC_SHAPES.length + 1)
  })

  it('never names the twelve itself — whatever the engine defines is what the tab shows', () => {
    const catalog = smartShapeCatalog(fakeSmart([definition({ id: 'brace-left' as SmartShapeId, title: 'Brace left', kind: 'brace', closed: false })]))
    expect(catalog).toHaveLength(1)
    expect(catalog[0]).toMatchObject({ id: 'smart:brace-left', title: 'Brace left', kind: 'brace', direction: 'left' })
  })

  it('inserts ONE line carrying the engine metadata — a real smart shape, not a drawing of one', () => {
    const smart = fakeSmart()
    const [element] = smartShapeCatalog(smart)[0].create(500, 400) as unknown as [Record<string, unknown>]
    expect(element).toMatchObject({ type: 'line', x: 400, y: 350, width: 200, height: 100, backgroundColor: '#1b1b1f' })
    expect(element.customData).toEqual({ yasinSmartShape: { version: 1, id: 'arrow-right', kind: 'filled-arrow', parameters: { shaftRatio: 0.5 } } })
  })

  it('leaves an open shape unfilled', () => {
    const [element] = smartShapeCatalog(fakeSmart([definition({ closed: false })]))[0].create(0, 0) as unknown as [Record<string, unknown>]
    expect(element.backgroundColor).toBe('transparent')
  })

  it('precomputes the tile polygon once, with an 8 % padded viewBox', () => {
    const preview = smartShapePreview(fakeSmart(), definition())
    expect(preview).toMatchObject({ type: 'smart', closed: true, points: '0,0 200,50 0,100' })
    // width 200, height 100 → padding = 200 * 0.08 = 16
    expect(preview.viewBox).toBe('-16 -16 232 132')
  })

  it('builds the preview once per catalog build, not once per render', () => {
    const smart = fakeSmart()
    const generate = vi.spyOn(smart, 'generateSmartShapePoints')
    const catalog = smartShapeCatalog(smart)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(catalog[0].preview.type).toBe('smart')
  })

  it('reads a direction out of the id, and only out of the end of it', () => {
    expect(shapeDirection('arrow-right')).toBe('right')
    expect(shapeDirection('callout-rounded')).toBeUndefined()
    expect(shapeDirection('right-arrow')).toBeUndefined()
  })

  it('has a set of aliases for every smart kind', () => {
    for (const kind of ['filled-arrow', 'chevron', 'brace', 'bracket', 'parenthesis', 'callout'] as const) {
      expect(smartShapeAliases(kind).length).toBeGreaterThan(0)
    }
  })
})

describe('searching the catalog', () => {
  const catalog = buildShapeCatalog(fakeSmart())

  it('answers with everything for an empty query', () => {
    expect(filterShapeCatalog(catalog, '   ')).toHaveLength(catalog.length)
  })

  it('matches on the title, an alias, the kind and the direction', () => {
    expect(filterShapeCatalog(catalog, 'square').map(({ id }) => id)).toEqual(['rectangle'])
    expect(filterShapeCatalog(catalog, 'decision').map(({ id }) => id)).toEqual(['diamond'])
    expect(filterShapeCatalog(catalog, 'pointer').map(({ id }) => id)).toEqual(['smart:arrow-right'])
    expect(filterShapeCatalog(catalog, 'right').map(({ id }) => id)).toEqual(['smart:arrow-right'])
  })

  it('needs EVERY token to match, not any of them', () => {
    expect(filterShapeCatalog(catalog, 'rounded box')).toHaveLength(1)
    expect(filterShapeCatalog(catalog, 'rounded star')).toHaveLength(0)
  })

  it('ignores case, and answers nothing for a word no shape has', () => {
    expect(filterShapeCatalog(catalog, 'HEXAGON')).toHaveLength(1)
    expect(filterShapeCatalog(catalog, 'dodecahedron')).toHaveLength(0)
  })

  it('finds a shape by id, and answers undefined for one that is not there', () => {
    expect(getShape(catalog, 'smart:arrow-right')?.title).toBe('Arrow right')
    expect(getShape(catalog, 'smart:nothing')).toBeUndefined()
    // The Smart Shapes are not in the catalog until the package lands — a click on one is a no-op,
    // never a crash. `ImageStudio` turns that into "That shape is not available yet."
    expect(getShape(buildShapeCatalog(null), 'smart:arrow-right')).toBeUndefined()
  })
})
