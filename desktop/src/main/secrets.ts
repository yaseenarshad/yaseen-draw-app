/**
 * THE SECRETS DOOR (🔒 YAZ-1775 D4, YAZ-1817): `userData/secrets.json` =
 * `{ version: 1, values: Record<name, base64(safeStorage.encryptString(value))> }`.
 *
 * THE RULE, and it has no exceptions: **the renderer never receives a value.** It may write one
 * (`set`) and ask whether one is there (`has`); reading (`read`) is main's alone — 3B's provider
 * code calls it when it builds a Pixabay request. That is why the Pixabay key is not a
 * `SettingsState` field: the store is broadcast to every window on every change, and a key in it
 * would be a key in every renderer's devtools console.
 *
 * Electron-free: the cipher comes in as an argument (production passes `safeStorage`), so the
 * module unit-tests against a temp dir with a fake. `has` answers "stored AND decryptable on this
 * machine" — a `secrets.json` copied from another Mac is a file full of blobs this keychain cannot
 * open, and the honest answer to "is the key set?" is then no. With no keychain at all
 * (`isEncryptionAvailable()` false — some Linux sessions) `set` refuses with
 * `ENCRYPTION_UNAVAILABLE` rather than falling back to plaintext, and `has` is false.
 *
 * Lazy, like every other file this app owns: reading never creates the file; a corrupt one is
 * moved aside as `secrets.json.corrupt-<epoch>` (the `store.ts` posture). Writes are atomic and
 * chained.
 */

import { atomicWrite, BridgeFailure, fsCall } from './fs/fsUtils'
import { isRecord } from '@shared/guards'
import { createChain, readOrQuarantine } from './watchedFolder'
import { stat } from 'node:fs/promises'

export const SECRETS_FILE = 'secrets.json'

/** The slice of Electron's `safeStorage` this module uses. */
export interface SecretCipher {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface Secrets {
  /** Store `value` encrypted, or clear the name with null. Rejects `ENCRYPTION_UNAVAILABLE` without a keychain. */
  set(name: string, value: string | null): Promise<void>
  /** Stored AND decryptable on this machine. The only question a renderer may ask. */
  has(name: string): Promise<boolean>
  /** The plaintext, for MAIN only (3B's providers). Null when absent, undecryptable, or without a keychain. */
  read(name: string): Promise<string | null>
}

type Values = Record<string, string>

export function createSecrets(file: string, cipher: SecretCipher): Secrets {
  /** Writes chain so two read-modify-writes never interleave. */
  const chain = createChain()
  /**
   * The parsed file, kept while its mtime says nothing has changed. `providers.ts` asks for the key
   * on every search, every preview and every import, and re-reading plus re-parsing the file each
   * time is the cost this saves; the mtime check keeps an outside edit honest for one `stat`.
   */
  let cached: { mtimeMs: number; values: Values } | null = null

  const parse = (raw: unknown): Values | null =>
    isRecord(raw) && raw.version === 1 && isRecord(raw.values)
      ? Object.fromEntries(Object.entries(raw.values).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : null

  async function load(): Promise<Values> {
    const mtimeMs = await stat(file).then((st) => st.mtimeMs, () => null)
    if (mtimeMs === null) return {}
    if (cached !== null && cached.mtimeMs === mtimeMs) return cached.values
    const values = (await readOrQuarantine(file, parse, 'secrets', 'a valid secrets file')) ?? {}
    cached = { mtimeMs, values }
    return values
  }

  const decrypt = (blob: string): string | null => {
    try {
      return cipher.decryptString(Buffer.from(blob, 'base64'))
    } catch {
      return null
    }
  }

  async function read(name: string): Promise<string | null> {
    if (!cipher.isEncryptionAvailable()) return null
    const blob = (await load())[name]
    return blob === undefined ? null : decrypt(blob)
  }

  return {
    set(name, value) {
      if (!cipher.isEncryptionAvailable()) return Promise.reject(new BridgeFailure('ENCRYPTION_UNAVAILABLE', 'this machine cannot encrypt secrets'))
      return chain.run(async () => {
        const values = { ...(await load()) }
        if (value === null) delete values[name]
        else values[name] = cipher.encryptString(value).toString('base64')
        const { mtime } = await fsCall(file, () => atomicWrite(file, `${JSON.stringify({ version: 1, values }, null, 2)}\n`))
        cached = { mtimeMs: mtime, values }
      })
    },
    has: (name) => read(name).then((v) => v !== null),
    read,
  }
}
