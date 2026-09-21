/**
 * The drawing refresh feed (YAZ-878, third build unit of the Excalidraw embed YAZ-852).
 *
 * A subscribe/poke holder carrying no state at all — only the poke. A subscriber, on a poke
 * naming its target, drops that target's cached scene and re-reads it. Nothing else moves: no
 * remount, no document change, no transaction the autosave can see.
 *
 * ONE per mount, given to the modal (YAZ-879, the first and only poker: a save redraws every
 * view of that target in place).
 */

/** How a poke reaches the previews; see `createDrawingFeed`. */
export interface DrawingFeed {
  /** Wakes on every poke, with the poked target exactly as the embed spells it. */
  subscribe(listener: (target: string) => void): () => void
}

export interface MutableDrawingFeed extends DrawingFeed {
  /** "This drawing changed on disk" — `target` is the embed's raw ref (path or basename). */
  poke(target: string): void
}

export function createDrawingFeed(): MutableDrawingFeed {
  const listeners = new Set<(target: string) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    poke(target) {
      listeners.forEach((l) => l(target))
    },
  }
}
