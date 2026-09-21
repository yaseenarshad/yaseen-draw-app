/**
 * `useProperties` (YAZ-835): one `properties.get(root)` fetch per root, live-replaced by
 * `properties:changed` broadcasts for that root. Public surface is exactly
 * `{ status, properties, error }`. The bridge (`api.properties`) is mocked; the onChange
 * listeners are captured so tests can push broadcasts. Stub-backed component integration lives
 * in `view/RelationColumn.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PropertiesResponse } from '@shared/types'
import { useProperties, type PropertiesState } from './useProperties'

let listeners: Array<(res: PropertiesResponse) => void> = []
const offSpy = vi.fn()

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    properties: {
      get: vi.fn(),
      onChange: vi.fn((l: (res: PropertiesResponse) => void) => {
        listeners.push(l)
        return offSpy
      }),
    },
  },
}))

import { api } from '../api'

const getFn = vi.mocked(api.properties.get)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const response = (root: string, extra: Partial<PropertiesResponse> = {}): PropertiesResponse => ({ root, version: 1, properties: {}, ...extra })

let root: Root | null = null
let container: HTMLElement | null = null
let state: PropertiesState

function Probe({ vaultRoot }: { vaultRoot: string }) {
  state = useProperties(vaultRoot)
  return null
}

function mount(vaultRoot = '/vault'): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

function rerender(vaultRoot: string): void {
  act(() => root?.render(<Probe vaultRoot={vaultRoot} />))
}

/** Lets the mocked fetch promise resolve and React commit. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function broadcast(res: PropertiesResponse): void {
  act(() => listeners.forEach((l) => l(res)))
}

beforeEach(() => {
  getFn.mockResolvedValue(response('/vault'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  vi.clearAllMocks()
})

describe('useProperties', () => {
  it('is pending on mount, then ready with the fetched declarations — an untouched vault is empty, never an error', async () => {
    mount()
    expect(state.status).toBe('pending')
    expect(state.properties).toBeNull()
    await flush()
    expect(getFn).toHaveBeenCalledWith('/vault')
    expect(state.status).toBe('ready')
    expect(state.properties).toEqual({ root: '/vault', version: 1, properties: {} })
    expect(state.error).toBeNull()
  })

  it('a failed fetch becomes status error with the message; a corrupt file is NOT a fetch error', async () => {
    getFn.mockRejectedValue(new Error('bridge gone'))
    mount()
    await flush()
    expect(state.status).toBe('error')
    expect(state.error).toBe('bridge gone')
    expect(state.properties).toBeNull()

    getFn.mockResolvedValue(response('/other', { error: 'properties.json is not valid JSON: x' }))
    rerender('/other')
    await flush()
    expect(state.status).toBe('ready') // degraded, not failed: the response's error carries the string
    expect(state.properties?.error).toContain('not valid JSON')
  })

  it('a broadcast for this root replaces the declarations live; other roots are ignored', async () => {
    mount()
    await flush()
    broadcast(response('/elsewhere', { properties: { role: { kind: 'text' } } }))
    expect(state.properties?.properties.role).toBeUndefined()
    broadcast(response('/vault', { properties: { unit: { kind: 'text' } } }))
    expect(state.status).toBe('ready')
    expect(state.properties?.properties.unit).toEqual({ kind: 'text' })
  })

  it('a broadcast landing before a slow initial get wins over it', async () => {
    let resolve!: (r: PropertiesResponse) => void
    getFn.mockReturnValue(new Promise<PropertiesResponse>((r) => (resolve = r)))
    mount()
    broadcast(response('/vault', { properties: { unit: { kind: 'text' } } }))
    expect(state.status).toBe('ready')
    resolve(response('/vault')) // the stale fetch must not overwrite the fresher broadcast
    await flush()
    expect(state.properties?.properties.unit).toEqual({ kind: 'text' })
  })

  it('a root change resets to pending and fetches the new root', async () => {
    mount('/vault')
    await flush()
    getFn.mockResolvedValue(response('/other', { properties: { related: { kind: 'multi-link' } } }))
    rerender('/other')
    expect(state.status).toBe('pending')
    expect(state.properties).toBeNull()
    await flush()
    expect(getFn).toHaveBeenLastCalledWith('/other')
    expect(state.properties?.properties.related).toEqual({ kind: 'multi-link' })
  })

  it('unmount unsubscribes from onChange', async () => {
    mount()
    await flush()
    act(() => root?.unmount())
    root = null
    expect(offSpy).toHaveBeenCalled()
  })
})
