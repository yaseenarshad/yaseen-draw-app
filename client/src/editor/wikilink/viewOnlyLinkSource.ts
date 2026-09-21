import { isViewOnly } from '@shared/fileKind'
import type { ViewOnlyCatalog, ViewOnlyEntry } from '../../links/viewOnlyCatalog'

export interface ViewOnlyLinkTarget {
  /** Recognized view-only page target, without an optional heading/block suffix. */
  page: string
  /** Full target before `|display`, retained for an honest unsupported-suffix notice. */
  raw: string
  hasSubtarget: boolean
}

/** Recognized explicit-extension view-only target, or null for every semantic Markdown target. */
export function viewOnlyLinkTarget(inner: string): ViewOnlyLinkTarget | null {
  const raw = inner.split('|', 1)[0].trim()
  const hash = raw.indexOf('#')
  const page = (hash < 0 ? raw : raw.slice(0, hash)).trim()
  return isViewOnly(page) ? { page, raw, hasSubtarget: hash >= 0 } : null
}

export interface ViewOnlyLinkSource {
  readonly ready: boolean
  readonly catalog: ViewOnlyCatalog | null
  readonly targets: readonly ViewOnlyEntry[]
  readonly resolve: ((target: string) => string | null) | null
  subscribe(listener: () => void): () => void
}

export interface MutableViewOnlyLinkSource extends ViewOnlyLinkSource {
  update(catalog: ViewOnlyCatalog): void
  reset(): void
}

export function createViewOnlyLinkSource(): MutableViewOnlyLinkSource {
  let current: ViewOnlyCatalog | null = null
  const listeners = new Set<() => void>()
  return {
    get ready() { return current !== null },
    get catalog() { return current },
    get targets() { return current?.entries ?? [] },
    get resolve() { return current?.resolve ?? null },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    update(catalog) {
      current = catalog
      listeners.forEach((listener) => listener())
    },
    reset() {
      if (current === null) return
      current = null
      listeners.forEach((listener) => listener())
    },
  }
}
