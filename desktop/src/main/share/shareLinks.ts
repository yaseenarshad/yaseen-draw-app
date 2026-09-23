/**
 * THE VAULT'S SHARE MEMORY (YAZ-1799 D3): `<vault>/.yaseendraw/shares.json` —
 * `{ version: 1, shares: { "<vault-relative path>": { id, allowDownload, sharedAt, updatedAt } } }` —
 * one random id (the `/b/<id>` link) and the owner's download permission per board.
 *
 * In the vault, not in app state, because it is a fact ABOUT the vault's boards: a synced vault
 * on another machine knows which of its boards are shared (and could update / stop them once that
 * machine is set up with the same Cloudflare account). Keys are vault-relative so it survives the
 * vault moving on disk. Read through `vaultConfig.ts`, so it is lazy (reading creates nothing) and
 * written atomically like `favorites.json` and `github.json`.
 *
 * Every write is a read-modify-write on one per-vault chain (`updateShares`), so two windows
 * sharing, renaming or stopping at once never lose each other's entry. An in-app rename rewrites
 * the key (`fsHooks.ts`); one made OUTSIDE the app keeps its old key, so Settings flags the record
 * "no board at this path" while its link stays live.
 */
import path from 'node:path'
import { isFiniteNumber, isRecord } from '@shared/guards'
import { BridgeFailure } from '../fs/fsUtils'
import { readConfigDetailed, writeConfig } from '../vaultConfig'
import { createChain } from '../watchedFolder'

export const SHARES_FILE = 'shares.json'
const VERSION = 1

export interface ShareRecord {
  id: string
  allowDownload: boolean
  sharedAt: number
  updatedAt: number
}

export type ShareMap = Record<string, ShareRecord>

const parseRecord = (v: unknown): ShareRecord | null =>
  isRecord(v) && typeof v.id === 'string' && v.id !== '' && isFiniteNumber(v.sharedAt) && isFiniteNumber(v.updatedAt)
    ? // A record with no flag is an older one: downloads on, the new-share default.
      { id: v.id, allowDownload: v.allowDownload !== false, sharedAt: v.sharedAt, updatedAt: v.updatedAt }
    : null

export async function readShares(root: string): Promise<ShareMap> {
  const read = await readConfigDetailed(root, SHARES_FILE)
  if (read.state === 'absent') return {}
  if (read.state === 'malformed') throw new BridgeFailure('INVALID_CONFIG', `.yaseendraw/${SHARES_FILE} is not valid JSON: ${read.error}`, { path: read.file })
  const raw = read.value
  if (!isRecord(raw) || !isRecord(raw.shares)) return {}
  const out: ShareMap = {}
  for (const [rel, rec] of Object.entries(raw.shares)) {
    const parsed = parseRecord(rec)
    if (parsed !== null) out[rel] = parsed
  }
  return out
}

/** One chain per vault root: every write to its shares.json queues here. */
const chains = new Map<string, ReturnType<typeof createChain>>()
const chainFor = (root: string) => chains.get(root) ?? chains.set(root, createChain()).get(root)!
const write = (root: string, shares: ShareMap) => writeConfig(root, SHARES_FILE, { version: VERSION, shares })

export const writeShares = (root: string, shares: ShareMap): Promise<void> => chainFor(root).run(() => write(root, shares))

/**
 * Read, change and write back as one step on the vault's chain. `change` edits the map in place
 * and returns whether it changed anything — nothing is written (or created) when it did not.
 */
export const updateShares = (root: string, change: (shares: ShareMap) => boolean): Promise<void> =>
  chainFor(root).run(async () => {
    const shares = await readShares(root)
    if (change(shares)) await write(root, shares)
  })

/** The key for `abs` under `root` — POSIX separators, and refused when it escapes the vault. */
export function relKey(root: string, abs: string): string {
  const rel = path.relative(root, abs)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new BridgeFailure('BAD_REQUEST', 'the board is not inside this vault', { path: abs })
  return rel.split(path.sep).join('/')
}

export const absFromKey = (root: string, key: string): string => path.join(root, ...key.split('/'))
