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
 * ⚠ OPEN QUESTION (prototype call): a board renamed or moved OUTSIDE the app keeps its old key
 * here, so its record looks orphaned (Settings flags it) while its link stays live. An in-app
 * rename does not follow it either yet — see the report.
 */
import path from 'node:path'
import { isFiniteNumber, isRecord } from '@shared/guards'
import { BridgeFailure } from '../fs/fsUtils'
import { readConfigDetailed, writeConfig } from '../vaultConfig'

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

export const writeShares = (root: string, shares: ShareMap): Promise<void> => writeConfig(root, SHARES_FILE, { version: VERSION, shares })

/** The key for `abs` under `root` — POSIX separators, and refused when it escapes the vault. */
export function relKey(root: string, abs: string): string {
  const rel = path.relative(root, abs)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new BridgeFailure('BAD_REQUEST', 'the board is not inside this vault', { path: abs })
  return rel.split(path.sep).join('/')
}

export const absFromKey = (root: string, key: string): string => path.join(root, ...key.split('/'))
