/**
 * The drawing refresh feed (YAZ-878, third build unit of the Excalidraw embed YAZ-852).
 *
 * The `WikilinkResolveSource` subscribe/poke idiom (`editor/wikilink/wikilinkPlugin.ts`) cut down
 * to its smallest honest shape: a holder App owns, carrying no state at all — only the poke. A
 * preview plugin subscribes once and, on a poke naming its target, drops that target's cached
 * scene and re-reads it. Nothing else moves: no remount, no document change, no transaction the
 * autosave can see.
 *
 * ONE per editor mount, made by `CrepeHost` and given to BOTH the preview plugin and the modal
 * (YAZ-879, the first and only poker: a save redraws every preview of that target in place).
 * Absent from `createCrepe`, previews still render; they just never live-refresh.
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
