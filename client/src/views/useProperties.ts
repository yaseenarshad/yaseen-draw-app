import { useEffect, useRef, useState } from 'react'
import type { PropertiesApi, PropertiesResponse } from '@shared/types'
import { api } from '../api'

/**
 * The vault's property declarations (YAZ-835): one `properties.get(root)` fetch per root, live
 * replaced through `onChange` (same-root events only), mirroring `useIndex`. Components consume
 * this hook — and mutate through the `properties` object below — never the storage directly, so
 * both sides re-render identically wherever the change came from.
 */

/**
 * The bridge, wrapped: the real `.yaseendocs/properties.json` surface
 * (`window.yaseenDocs.properties`, `BridgeRequestError`-wrapped via `api`). Tests fake it by
 * installing `propertiesStub` as `window.yaseenDocs.properties` — the stub implements this same
 * interface.
 */
export const properties: PropertiesApi = api.properties

export type PropertiesStatus = 'pending' | 'ready' | 'error'

export interface PropertiesState {
  status: PropertiesStatus
  /**
   * null until the first fetch resolves (and after a failed one). An untouched vault is
   * `{properties:{}}` — never an error. A corrupt properties.json is NOT a fetch error
   * either: status stays 'ready' with `properties.error` set — consumers degrade to
   * no-declaration behavior (inference-only typing) and surface the string where index errors
   * already show.
   */
  properties: PropertiesResponse | null
  /** Fetch failure message; null unless `status` is 'error'. */
  error: string | null
}

/**
 * `root` is nullable so App can own ONE of these beside `wikilinks` (YAZ-846) — hooks cannot be
 * conditional, and a window with no vault open must not fetch. A null root is 'pending' with no
 * declarations and no bridge call at all.
 */
export function useProperties(root: string | null): PropertiesState {
  const [status, setStatus] = useState<PropertiesStatus>('pending')
  const [response, setResponse] = useState<PropertiesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped on unmount/root change AND on every broadcast: only a still-fresh fetch may commit.
  const generation = useRef(0)

  useEffect(() => {
    const gen = ++generation.current
    setStatus('pending')
    setResponse(null)
    setError(null)
    if (root === null) return
    properties.get(root).then(
      (res) => {
        if (gen !== generation.current) return
        setResponse(res)
        setStatus('ready')
        setError(null)
      },
      (err: unknown) => {
        if (gen !== generation.current) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      },
    )
    const unsubscribe = properties.onChange((res) => {
      if (res.root !== root) return
      generation.current++ // a broadcast is always fresher than any in-flight get
      setResponse(res)
      setStatus('ready')
      setError(null)
    })
    return () => {
      generation.current++
      unsubscribe()
    }
  }, [root])

  return { status, properties: response, error }
}
