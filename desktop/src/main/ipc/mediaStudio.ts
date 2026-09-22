/**
 * THE IMAGE STUDIO'S THREE DOORS (🔒 D4, YAZ-1818): `media:search`, `media:preview`,
 * `media:import`. The guard layer only — every decision is `main/media/`'s, every request is
 * validated whole here first, because a sandboxed renderer's arguments are input.
 *
 * WHY THE SECRETS INSTANCE IS PASSED IN: `registerSecretsIpc` owns `userData/secrets.json` and
 * returns the one object that can `read` it. Threading it here is what lets the providers build a
 * Pixabay request without the key ever existing outside main (🔒 D4). A second `createSecrets`
 * would be a second writer to the same file.
 *
 * THE CACHE IS SWEPT ONCE, AT REGISTRATION, DETACHED. `<userData>/media-cache/` is bounded by age
 * and nothing else, so the moment the app starts is exactly when yesterday's entries should go —
 * and the first search must not wait for a `readdir` of it.
 */
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { isMediaBytesProvider, isMediaSearchSource, PIXABAY_SECRET, type MediaBytesRequest, type MediaSearchRequest } from '@shared/types'
import { CH } from '../../channels'
import { BridgeFailure } from '../fs/fsUtils'
import { createMediaCache, type MediaCache } from '../media/cache'
import { MEDIA_CACHE_DIR } from '../media/cachePolicy'
import { createMediaProviders, type MediaProviders } from '../media/providers'
import type { Secrets } from '../secrets'
import { isRecord } from '@shared/guards'
import { handle } from './envelope'

function requireSearchRequest(v: unknown): MediaSearchRequest {
  if (!isRecord(v)) throw new BridgeFailure('BAD_REQUEST', 'missing request')
  if (typeof v.q !== 'string') throw new BridgeFailure('BAD_REQUEST', "'q' must be a string")
  if (!isMediaSearchSource(v.source)) throw new BridgeFailure('BAD_REQUEST', "'source' must be all, iconify or pixabay")
  if (v.cursor !== undefined && v.cursor !== null && typeof v.cursor !== 'string') throw new BridgeFailure('BAD_REQUEST', "'cursor' must be a string or null")
  return { q: v.q, source: v.source, cursor: (v.cursor as string | null | undefined) ?? null }
}

function requireBytesRequest(v: unknown): MediaBytesRequest {
  if (!isRecord(v)) throw new BridgeFailure('BAD_REQUEST', 'missing request')
  // `shape` is deliberately not one of these: a shape is drawn by the renderer from its own
  // catalog and has no bytes to fetch (🔒 D4).
  if (!isMediaBytesProvider(v.provider)) throw new BridgeFailure('BAD_REQUEST', "'provider' must be pixabay or iconify")
  if (typeof v.id !== 'string' || v.id === '') throw new BridgeFailure('BAD_REQUEST', "'id' must be a non-empty string")
  return { provider: v.provider, id: v.id }
}

/** Exposed for the tests, which drive the handlers against a stub `fetch` and a temp cache folder. */
export interface MediaStudioIpc {
  providers: MediaProviders
  cache: MediaCache
  folder: string
}

export function registerMediaStudioIpc(userData: string, secrets: Secrets, fetchImpl: typeof globalThis.fetch = globalThis.fetch): MediaStudioIpc {
  const folder = join(userData, MEDIA_CACHE_DIR)
  const cache = createMediaCache(folder)
  const providers = createMediaProviders({ fetch: fetchImpl, readPixabayKey: () => secrets.read(PIXABAY_SECRET), cache })

  // Detached: the folder has to exist before the first write, and yesterday's entries have to go,
  // but neither is something a renderer should ever wait behind.
  void mkdir(folder, { recursive: true })
    .then(() => cache.sweep())
    .then(
      (swept) => {
        if (swept > 0) console.log(`[media-cache] swept ${swept} expired entr${swept === 1 ? 'y' : 'ies'}`)
      },
      (err: unknown) => console.warn('[media-cache] could not prepare', folder, err),
    )

  handle(CH.mediaSearch, async (req: unknown) => providers.search(requireSearchRequest(req)))
  handle(CH.mediaPreview, async (req: unknown) => providers.preview(requireBytesRequest(req)))
  handle(CH.mediaImport, async (req: unknown) => providers.import(requireBytesRequest(req)))

  return { providers, cache, folder }
}
