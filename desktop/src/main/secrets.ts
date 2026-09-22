/**
 * THE SECRETS DOOR (🔒 D4, YAZ-1817): `userData/secrets.json` =
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
import { readFile, rename } from 'node:fs/promises'
import { atomicWrite, BridgeFailure, fsCall } from './fs/fsUtils'
import { isRecord } from '@shared/guards'

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
  let chain: Promise<unknown> = Promise.resolve()

  async function load(): Promise<Values> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    if (isRecord(parsed) && parsed.version === 1 && isRecord(parsed.values)) {
      return Object.fromEntries(Object.entries(parsed.values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    }
    const backup = `${file}.corrupt-${Date.now()}`
    await rename(file, backup).then(
      () => console.error(`[secrets] ${file} is not a valid secrets file; moved to ${backup}`),
      (err: unknown) => console.error(`[secrets] ${file} is not a valid secrets file and could not be moved aside: ${String(err)}`),
    )
    return {}
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
      const run = chain.then(async () => {
        const values = await load()
        if (value === null) delete values[name]
        else values[name] = cipher.encryptString(value).toString('base64')
        await fsCall(file, () => atomicWrite(file, `${JSON.stringify({ version: 1, values }, null, 2)}\n`))
      })
      chain = run.catch(() => undefined)
      return run
    },
    has: (name) => read(name).then((v) => v !== null),
    read,
  }
}
