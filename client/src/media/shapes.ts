/**
 * THE SHAPES CATALOG (YAZ-1818): `excalidraw-app/image-studio/shapes.ts` from the web app, ported.
 * Seven basic shapes drawn by hand, plus the engine's own twelve Smart Shapes — arrows, chevrons,
 * braces, brackets, parentheses and callouts — each inserted as a NATIVE element with the
 * `yasinSmartShape` metadata that makes its handles work, not as a picture of one.
 *
 * TWO HALVES, BECAUSE ONE OF THEM COSTS 300 kB. The basics need nothing but arithmetic, so they
 * are a module constant. The Smart Shapes need `SMART_SHAPE_DEFINITIONS` and the point generator
 * out of `@excalidraw/element`, which is why `buildShapeCatalog` takes that module as an argument
 * (`engine.ts`'s `loadExcalidrawElement()` supplies it, lazily): the view renders the basics at
 * once and grows the rest when the package lands. It also makes the whole catalog testable with a
 * hand-written stand-in and no engine at all.
 *
 * PREVIEWS ARE PRECOMPUTED. The web app called `getSmartShapePreview(kind)` from inside the
 * render and re-derived a polygon per tile per frame; building the same polygon once, when the
 * catalog is built, is the same picture — and it is what lets a test assert the geometry without
 * a DOM.
 *
 * `pointFrom` IS COPIED, NOT IMPORTED (`@excalidraw/math`'s one-liner: the tuple, branded). Its
 * package is engine tree too, and the `formFactor.ts` precedent applies — a value import would
 * pull it into the entry chunk for the sake of `[x, y]`.
 */
import type { ExcalidrawElementSkeleton, SmartShapeDefinition, SmartShapeId, SmartShapeMetadata } from '@excalidraw/element'
import type { LocalPoint } from '@excalidraw/math'

/** The three values the Smart Shapes need out of `@excalidraw/element`, and nothing else. */
export interface SmartShapeApi {
  SMART_SHAPE_DEFINITIONS: readonly SmartShapeDefinition[]
  generateSmartShapePoints: (id: SmartShapeId, width: number, height: number, parameters: Record<string, number>) => LocalPoint[]
  createSmartShapeMetadata: (id: SmartShapeId) => SmartShapeMetadata
}

/** The six hand-drawn tile pictures; a smart shape draws its own polygon instead. */
export type BasicPreviewShape = 'rectangle' | 'ellipse' | 'diamond' | 'triangle' | 'hexagon' | 'star'

/** What a tile draws: one of the six stock outlines, or a smart shape's own generated path. */
export type ShapePreview = { type: 'basic'; shape: BasicPreviewShape } | { type: 'smart'; closed: boolean; points: string; viewBox: string }

export interface ShapeCatalogItem {
  id: string
  title: string
  preview: ShapePreview
  kind: string
  direction?: 'right' | 'left' | 'up' | 'down'
  aliases: readonly string[]
  /** The skeletons to insert, centred on a scene point. */
  create: (x: number, y: number) => ExcalidrawElementSkeleton[]
}

/** `pointFrom<LocalPoint>(x, y)` — the branded tuple, without importing the package for it. */
const localPoint = (x: number, y: number): LocalPoint => [x, y] as unknown as LocalPoint

/** Every shape is born with the same stroke: the web app's, so a board looks the same in both. */
const common = {
  strokeColor: '#1b1b1f',
  backgroundColor: 'transparent',
  fillStyle: 'solid' as const,
  strokeWidth: 2 as const,
  roughness: 1 as const,
}

const box = (type: 'rectangle' | 'ellipse' | 'diamond', x: number, y: number): ExcalidrawElementSkeleton[] => [
  { type, x: x - 80, y: y - 55, width: 160, height: 110, ...common },
]

const polygon = (x: number, y: number, points: readonly (readonly [number, number])[]): ExcalidrawElementSkeleton[] => [
  {
    type: 'line',
    x: x - 80,
    y: y - 70,
    width: 160,
    height: 140,
    points: points.map(([pointX, pointY]) => localPoint(pointX, pointY)),
    ...common,
  },
]

const basic = (shape: BasicPreviewShape): ShapePreview => ({ type: 'basic', shape })

/** The seven the engine has no definition for; no package needed to draw or to insert them. */
export const BASIC_SHAPES: readonly ShapeCatalogItem[] = [
  { id: 'rectangle', title: 'Rectangle', preview: basic('rectangle'), kind: 'basic', aliases: ['box', 'square'], create: (x, y) => box('rectangle', x, y) },
  {
    id: 'rounded-rectangle',
    title: 'Rounded rectangle',
    preview: basic('rectangle'),
    kind: 'basic',
    aliases: ['rounded box'],
    create: (x, y) => [{ ...box('rectangle', x, y)[0], roundness: { type: 3 } } as ExcalidrawElementSkeleton],
  },
  { id: 'circle', title: 'Circle', preview: basic('ellipse'), kind: 'basic', aliases: ['ellipse', 'oval'], create: (x, y) => box('ellipse', x, y) },
  { id: 'diamond', title: 'Diamond', preview: basic('diamond'), kind: 'basic', aliases: ['rhombus', 'decision'], create: (x, y) => box('diamond', x, y) },
  {
    id: 'triangle',
    title: 'Triangle',
    preview: basic('triangle'),
    kind: 'polygon',
    aliases: ['three sided'],
    create: (x, y) =>
      polygon(x, y, [
        [80, 0],
        [160, 140],
        [0, 140],
        [80, 0],
      ]),
  },
  {
    id: 'hexagon',
    title: 'Hexagon',
    preview: basic('hexagon'),
    kind: 'polygon',
    aliases: ['six sided'],
    create: (x, y) =>
      polygon(x, y, [
        [40, 0],
        [120, 0],
        [160, 70],
        [120, 140],
        [40, 140],
        [0, 70],
        [40, 0],
      ]),
  },
  {
    id: 'star',
    title: 'Star',
    preview: basic('star'),
    kind: 'polygon',
    aliases: ['favorite'],
    create: (x, y) =>
      polygon(x, y, [
        [80, 0],
        [99, 52],
        [156, 54],
        [111, 88],
        [127, 140],
        [80, 109],
        [33, 140],
        [49, 88],
        [4, 54],
        [61, 52],
        [80, 0],
      ]),
  },
]

/** `arrow-right` → `right`; a shape with no direction in its id has none. */
export function shapeDirection(id: string): ShapeCatalogItem['direction'] {
  const direction = id.match(/-(right|left|up|down)$/)?.[1]
  return direction === 'right' || direction === 'left' || direction === 'up' || direction === 'down' ? direction : undefined
}

/** The words someone would search for that are not already in the title — one set per smart kind. */
export function smartShapeAliases(kind: SmartShapeDefinition['kind']): readonly string[] {
  switch (kind) {
    case 'filled-arrow':
      return ['arrow', 'pointer', 'filled']
    case 'chevron':
      return ['arrowhead', 'direction']
    case 'brace':
      return ['curly', 'curly bracket']
    case 'bracket':
      return ['square bracket']
    case 'parenthesis':
      return ['paren', 'round bracket']
    case 'callout':
      return ['speech', 'annotation', 'label']
  }
}

/**
 * The tile drawing for one smart shape: the engine's own points, in a viewBox padded by 8 % of the
 * larger side so a stroke is never clipped.
 */
export function smartShapePreview(smart: SmartShapeApi, definition: SmartShapeDefinition): Extract<ShapePreview, { type: 'smart' }> {
  const points = smart.generateSmartShapePoints(definition.id, definition.width, definition.height, definition.defaults)
  const xValues = points.map(([x]) => x)
  const yValues = points.map(([, y]) => y)
  const minX = Math.min(...xValues)
  const minY = Math.min(...yValues)
  const maxX = Math.max(...xValues)
  const maxY = Math.max(...yValues)
  const padding = Math.max(maxX - minX, maxY - minY) * 0.08
  return {
    type: 'smart',
    closed: definition.closed,
    points: points.map(([x, y]) => `${x},${y}`).join(' '),
    viewBox: `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`,
  }
}

/**
 * ONE line element carrying the engine's `yasinSmartShape` metadata — which is what makes the
 * inserted shape a real smart shape with its own handles, rather than a frozen polygon.
 */
function smartShapeSkeleton(smart: SmartShapeApi, definition: SmartShapeDefinition, x: number, y: number): ExcalidrawElementSkeleton[] {
  return [
    {
      type: 'line',
      x: x - definition.width / 2,
      y: y - definition.height / 2,
      width: definition.width,
      height: definition.height,
      points: smart.generateSmartShapePoints(definition.id, definition.width, definition.height, definition.defaults),
      strokeColor: '#1b1b1f',
      backgroundColor: definition.closed ? '#1b1b1f' : 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      roughness: 1,
      roundness: definition.roundness,
      customData: { yasinSmartShape: smart.createSmartShapeMetadata(definition.id) },
    } as ExcalidrawElementSkeleton,
  ]
}

/** The twelve, from whatever the engine defines — the app never lists them by name. */
export function smartShapeCatalog(smart: SmartShapeApi): ShapeCatalogItem[] {
  return smart.SMART_SHAPE_DEFINITIONS.map((definition) => ({
    id: `smart:${definition.id}`,
    title: definition.title,
    preview: smartShapePreview(smart, definition),
    kind: definition.kind,
    direction: shapeDirection(definition.id),
    aliases: smartShapeAliases(definition.kind),
    create: (x: number, y: number) => smartShapeSkeleton(smart, definition, x, y),
  }))
}

/** The whole catalog; `null` is "the element package has not landed yet", not an error. */
export function buildShapeCatalog(smart: SmartShapeApi | null): ShapeCatalogItem[] {
  return smart === null ? [...BASIC_SHAPES] : [...BASIC_SHAPES, ...smartShapeCatalog(smart)]
}

/** Every token must appear somewhere in the title, id, kind, direction or aliases. */
export function filterShapeCatalog(catalog: readonly ShapeCatalogItem[], query: string): ShapeCatalogItem[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return [...catalog]
  return catalog.filter((shape) => {
    const searchable = [shape.title, shape.id, shape.kind, shape.direction, ...shape.aliases]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
    return tokens.every((token) => searchable.includes(token))
  })
}

export function getShape(catalog: readonly ShapeCatalogItem[], id: string): ShapeCatalogItem | undefined {
  return catalog.find((shape) => shape.id === id)
}
