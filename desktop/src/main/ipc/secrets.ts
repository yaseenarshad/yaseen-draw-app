import { join } from 'node:path'
import { CH } from '../../channels'
import { BridgeFailure } from '../fs/fsUtils'
import { createSecrets, SECRETS_FILE, type Secrets } from '../secrets'
import { isRecord } from '@shared/guards'
import { PIXABAY_SECRET } from '@shared/types/library'
import { handle } from './envelope'

/**
 * The `secrets.*` half of `window.yaseenDraw` (🔒 YAZ-1775 D4, YAZ-1842 D1, YAZ-1817): two channels, `set` and `has`.
 * There is deliberately no third — a renderer can never ask for a value. `read` is on the
 * returned instance, for main's own callers (YAZ-1818's providers) only. Secrets are NOT app state:
 * nothing here touches the store, so a key can never ride `state:changed` into a renderer.
 */

const requireName = (v: unknown): string => {
  if (typeof v !== 'string' || v === '') throw new BridgeFailure('BAD_REQUEST', "'name' must be a non-empty string")
  return v
}

/**
 * The only names a renderer may WRITE. Sharing's Cloudflare token and upload password are stored by
 * main itself (`share:setup`), so a renderer must not be able to overwrite them and break sharing.
 */
export const RENDERER_WRITABLE_SECRETS: readonly string[] = [PIXABAY_SECRET]

export function registerSecretsIpc(userData: string): Secrets {
  const secrets = createSecrets(join(userData, SECRETS_FILE))
  handle(CH.secretsSet, async (req: unknown) => {
    if (!isRecord(req)) throw new BridgeFailure('BAD_REQUEST', 'missing request')
    const name = requireName(req.name)
    if (!RENDERER_WRITABLE_SECRETS.includes(name)) throw new BridgeFailure('BAD_REQUEST', `'${name}' is not a secret this window may set`)
    // `''` is not a value: storing it would make `has` say yes to a key that is not there.
    if (req.value !== null && (typeof req.value !== 'string' || req.value === '')) throw new BridgeFailure('BAD_REQUEST', "'value' must be a non-empty string or null")
    await secrets.set(name, req.value)
  })
  handle(CH.secretsHas, async (req: unknown) => {
    if (!isRecord(req)) throw new BridgeFailure('BAD_REQUEST', 'missing request')
    return secrets.has(requireName(req.name))
  })
  return secrets
}
