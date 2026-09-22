/**
 * WHAT A SLIDE IS (YAZ-1820): `excalidraw-app/presentation/slides.ts` ported — the rules that turn
 * a board's top-level FRAMES into an ordered deck, and the two writes that change that order.
 *
 * 🔒 THE ORDER LIVES IN THE FILE, NOT IN A STORE. A slide's position is
 * `frame.customData.presentationOrder` (the engine writes `customData` into the scene, so it
 * travels with the board, survives a copy to another machine, and needs no shell state at all).
 * The in-package contract (`packages/excalidraw/presentation/CONTRACT.md`) also writes the number
 * into `customData.yaseenPresentation.presentationOrder` for GENERATED decks, so both keys are
 * read, the root one first — a deck the canvas skill produced and a deck a human dragged into
 * shape are the same deck.
 *
 * THE ORDER IS A REQUEST, NOT A GUARANTEE. A file is user data: two frames can claim slot 2, a
 * frame can claim slot 9 of a three-frame deck, and a frame can claim nothing at all. So an
 * UNAMBIGUOUS claim (in range, and the only one for its slot) takes its slot; everything else
 * fills the gaps in scene order. The answer is therefore always exactly the top-level frames,
 * numbered 1..n with no holes, whatever the file says — which is what the sidebar renders and
 * what the player steps through.
 *
 * ONLY TOP-LEVEL FRAMES. A frame nested inside another frame is a shape in a slide, not a slide.
 *
 * ENGINE-BOUND BY DESIGN: `newElementWith` — the element package's own "copy with these fields,
 * version bumped" — comes in as an argument (`engine.ts`'s lazy rule, `componentData.ts`'s
 * precedent), so these rules test with a stub and without the package. Elements come in as
 * `unknown` and are narrowed here, for the same reason: the file is user data.
 */
import type { ExcalidrawElementModule } from '../engine'

/** The one element-package value these rules need. */
export type SlideElementApi = Pick<ExcalidrawElementModule, 'newElementWith'>

/** A frame as a slide: what the panel draws and what the player aims the camera at. */
export interface PresentationFrame {
  readonly id: string
  /** The frame's own name, or null — the panel shows `Slide <order>` for a nameless one. */
  readonly name: string | null
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface OrderedPresentationFrame {
  readonly frame: PresentationFrame
  /** 1-based, contiguous, and the panel's own numbering. */
  readonly order: number
  /** Where the frame sits in the scene array — the tie-break the web app used. */
  readonly sceneIndex: number
}

type JsonRecord = Record<string, unknown>
const isRecord = (v: unknown): v is JsonRecord => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** The two ordering keys, root first — see the module doc. `null` means "no claim". */
export function getPresentationOrder(frame: unknown): number | null {
  if (!isRecord(frame)) return null
  const customData = isRecord(frame.customData) ? frame.customData : null
  if (customData === null) return null
  const rootOrder = customData.presentationOrder
  if (Number.isInteger(rootOrder) && Number(rootOrder) > 0) return Number(rootOrder)
  const generated = customData.yaseenPresentation
  if (isRecord(generated)) {
    const generatedOrder = generated.presentationOrder
    if (Number.isInteger(generatedOrder) && Number(generatedOrder) > 0) return Number(generatedOrder)
  }
  return null
}

/** Live, top-level frames in scene order, narrowed to what a slide is. */
export function getTopLevelFrames(elements: readonly unknown[]): { frame: PresentationFrame; sceneIndex: number; raw: JsonRecord }[] {
  return elements.flatMap((element, sceneIndex) => {
    if (!isRecord(element) || element.type !== 'frame' || element.isDeleted === true) return []
    if (element.frameId !== null && element.frameId !== undefined) return []
    if (typeof element.id !== 'string') return []
    const frame: PresentationFrame = {
      id: element.id,
      name: typeof element.name === 'string' ? element.name : null,
      x: num(element.x),
      y: num(element.y),
      width: num(element.width),
      height: num(element.height),
    }
    return [{ frame, sceneIndex, raw: element }]
  })
}

/** The deck: every top-level frame, numbered 1..n, honouring every unambiguous claim. */
export function getOrderedPresentationFrames(elements: readonly unknown[]): OrderedPresentationFrame[] {
  const frames = getTopLevelFrames(elements)
  const orderCounts = new Map<number, number>()
  const requestedOrders = frames.map(({ raw }) => {
    const order = getPresentationOrder(raw)
    if (order !== null && order <= frames.length) {
      orderCounts.set(order, (orderCounts.get(order) ?? 0) + 1)
      return order
    }
    return null
  })
  const slots: (typeof frames[number] | undefined)[] = Array(frames.length)
  const unresolved: typeof frames[number][] = []

  frames.forEach((entry, index) => {
    const requestedOrder = requestedOrders[index]
    // A slot two frames both claim is a claim neither can have.
    if (requestedOrder !== null && orderCounts.get(requestedOrder) === 1) slots[requestedOrder - 1] = entry
    else unresolved.push(entry)
  })

  let unresolvedIndex = 0
  for (let index = 0; index < slots.length; index += 1) {
    if (!slots[index]) {
      slots[index] = unresolved[unresolvedIndex]
      unresolvedIndex += 1
    }
  }

  return slots.flatMap((entry, index) => (entry ? [{ frame: entry.frame, sceneIndex: entry.sceneIndex, order: index + 1 }] : []))
}

/**
 * Which slide a scene point lands in, or `null` for a miss — the double-click target test.
 * Frames are axis-aligned and never rotated, so bounds are the whole story; slides may OVERLAP
 * (a deck-overview frame drawn around the slides is a real authoring pattern), so the innermost
 * — smallest — frame under the point wins rather than the first one in presentation order.
 */
export function findSlideIndexAtPoint({ x, y }: { x: number; y: number }, slides: readonly OrderedPresentationFrame[]): number | null {
  let bestIndex: number | null = null
  let bestArea = Infinity
  slides.forEach(({ frame }, index) => {
    const inside = x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height
    const area = frame.width * frame.height
    if (inside && area < bestArea) {
      bestIndex = index
      bestArea = area
    }
  })
  return bestIndex
}

/**
 * The deck in `orderedFrameIds` order, written back into every top-level frame's `customData`.
 * The request is completed rather than trusted: ids that are not top-level frames are dropped,
 * duplicates are taken once, and any frame the caller forgot keeps its place at the end — so a
 * stale list can reshuffle the deck but can never lose a slide out of it.
 */
export function reorderPresentationFrames(element: SlideElementApi, elements: readonly unknown[], orderedFrameIds: readonly string[]): unknown[] {
  const current = getOrderedPresentationFrames(elements)
  const topLevelIds = new Set(current.map(({ frame }) => frame.id))
  const uniqueRequestedIds = orderedFrameIds.filter((id, index) => topLevelIds.has(id) && orderedFrameIds.indexOf(id) === index)
  const completeIds = [...uniqueRequestedIds, ...current.map(({ frame }) => frame.id).filter((id) => !uniqueRequestedIds.includes(id))]
  const orderById = new Map(completeIds.map((frameId, index) => [frameId, index + 1]))

  return elements.map((el) => {
    if (!isRecord(el) || el.type !== 'frame') return el
    const order = orderById.get(String(el.id))
    if (order === undefined) return el
    return element.newElementWith(el as never, { customData: { ...(isRecord(el.customData) ? el.customData : {}), presentationOrder: order } } as never)
  })
}

/** One frame's `name`, which is also the slide's label. */
export function renamePresentationFrame(element: SlideElementApi, elements: readonly unknown[], frameId: string, name: string): unknown[] {
  return elements.map((el) => (isRecord(el) && el.type === 'frame' && el.id === frameId ? element.newElementWith(el as never, { name } as never) : el))
}
