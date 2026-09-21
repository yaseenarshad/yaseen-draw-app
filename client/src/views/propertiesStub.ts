import type { PropertiesApi, PropertiesResponse } from '@shared/types'

/**
 * In-memory `PropertiesApi`: the tests' stand-in for `window.yaseenDocs.properties` (same
 * interface, same semantics as the real `.yaseendocs/properties.json` bridge). `get` on an
 * untouched root resolves `{ properties: {} }` — empty, never an error, and never creates state
 * (lazy-creation is the bridge's rule too); the first mutation creates the per-root store and
 * fires every `onChange` listener with a fresh snapshot. `version` is the constant 1, exactly
 * like the real bridge (the file's format version, never a mutation counter — GRO-2204).
 */

const stores = new Map<string, PropertiesResponse>()
const listeners = new Set<(properties: PropertiesResponse) => void>()

const empty = (root: string): PropertiesResponse => ({ root, version: 1, properties: {} })

function store(root: string): PropertiesResponse {
  let s = stores.get(root)
  if (s === undefined) {
    s = empty(root)
    stores.set(root, s)
  }
  return s
}

function changed(s: PropertiesResponse): void {
  const snapshot = structuredClone(s)
  for (const listener of listeners) listener(snapshot)
}

export const propertiesStub: PropertiesApi = {
  get: (root) => Promise.resolve(structuredClone(stores.get(root) ?? empty(root))),
  setProperty: (root, name, def) => {
    const s = store(root)
    s.properties[name] = def
    changed(s)
    return Promise.resolve()
  },
  removeProperty: (root, name) => {
    const s = store(root)
    delete s.properties[name]
    changed(s)
    return Promise.resolve()
  },
  onChange: (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** Tests only: drop every stored declaration and every listener. */
export function resetPropertiesStub(): void {
  stores.clear()
  listeners.clear()
}
