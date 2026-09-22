import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BridgeFailure } from './fs/fsUtils'
import { SECRETS_FILE, createSecrets, type SecretCipher, type Secrets } from './secrets'

/**
 * A stand-in for Electron's `safeStorage`: a reversible scramble that is visibly NOT the
 * plaintext, so a test can prove the file never holds the value. `available` flips the
 * keychain away, `epoch` makes a blob from "another machine" undecryptable.
 */
function fakeCipher(state: { available: boolean; epoch: string }): SecretCipher {
  return {
    isEncryptionAvailable: () => state.available,
    encryptString: (s) => Buffer.from(`${state.epoch}|${[...s].reverse().join('')}`),
    decryptString: (b) => {
      const [epoch, body] = b.toString().split('|')
      if (epoch !== state.epoch) throw new Error('decryption failed')
      return [...body].reverse().join('')
    },
  }
}

let dir: string
let file: string
let state: { available: boolean; epoch: string }
let secrets: Secrets
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-secrets-'))
  file = path.join(dir, SECRETS_FILE)
  state = { available: true, epoch: 'k1' }
  secrets = createSecrets(file, fakeCipher(state))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const onDisk = async () => JSON.parse(await readFile(file, 'utf8')) as { version: number; values: Record<string, string> }

describe('createSecrets (🔒 YAZ-1775 D4)', () => {
  it('nothing stored: has is false, read is null, and asking creates no file', async () => {
    expect(await secrets.has('pixabayApiKey')).toBe(false)
    expect(await secrets.read('pixabayApiKey')).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })

  it('set stores the value ENCRYPTED, base64, under { version: 1, values }; has flips; read gives it back', async () => {
    await secrets.set('pixabayApiKey', 'hunter2-key')
    const disk = await onDisk()
    expect(disk.version).toBe(1)
    expect(Object.keys(disk.values)).toEqual(['pixabayApiKey'])
    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain('hunter2-key')
    expect(Buffer.from(disk.values.pixabayApiKey, 'base64').toString()).toBe('k1|yek-2retnuh')
    expect(await secrets.has('pixabayApiKey')).toBe(true)
    expect(await secrets.read('pixabayApiKey')).toBe('hunter2-key')
  })

  it('set with null clears the name and leaves the others; clearing an absent name still answers', async () => {
    await secrets.set('a', '1')
    await secrets.set('b', '2')
    await secrets.set('a', null)
    expect(Object.keys((await onDisk()).values)).toEqual(['b'])
    expect(await secrets.has('a')).toBe(false)
    expect(await secrets.has('b')).toBe(true)
    await secrets.set('zzz', null)
    expect(Object.keys((await onDisk()).values)).toEqual(['b'])
  })

  it('a value set again replaces the old one', async () => {
    await secrets.set('a', 'first')
    await secrets.set('a', 'second')
    expect(await secrets.read('a')).toBe('second')
  })

  it('encryption unavailable: set rejects ENCRYPTION_UNAVAILABLE and writes nothing; has is false even for a stored value; read is null', async () => {
    await secrets.set('a', 'x')
    state.available = false
    await expect(secrets.set('b', 'y')).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' })
    await expect(secrets.set('b', 'y')).rejects.toBeInstanceOf(BridgeFailure)
    expect(Object.keys((await onDisk()).values)).toEqual(['a'])
    expect(await secrets.has('a')).toBe(false)
    expect(await secrets.read('a')).toBeNull()
  })

  it('a blob this machine cannot decrypt (the file came from another machine) reads as not set', async () => {
    await secrets.set('a', 'x')
    state.epoch = 'k2'
    expect(await secrets.has('a')).toBe(false)
    expect(await secrets.read('a')).toBeNull()
    // Setting it again on THIS machine repairs it.
    await secrets.set('a', 'x')
    expect(await secrets.has('a')).toBe(true)
  })

  it('a corrupt file is moved aside as secrets.json.corrupt-<epoch> and treated as empty', async () => {
    await writeFile(file, '{ nope')
    expect(await secrets.has('a')).toBe(false)
    await secrets.set('a', 'x')
    const names = (await readdir(dir)).sort()
    expect(names).toEqual([SECRETS_FILE, expect.stringMatching(/^secrets\.json\.corrupt-\d+$/)])
    expect(await secrets.read('a')).toBe('x')
  })

  it('a file with the wrong version is corrupt too; a non-string ROW in a good file is just ignored', async () => {
    await writeFile(file, JSON.stringify({ version: 2, values: {} }))
    expect(await secrets.has('a')).toBe(false)
    expect((await readdir(dir)).some((n) => n.startsWith('secrets.json.corrupt-'))).toBe(true)
    await writeFile(file, JSON.stringify({ version: 1, values: { a: 7, b: Buffer.from('k1|x').toString('base64') } }))
    expect(await secrets.has('a')).toBe(false)
    expect(await secrets.read('b')).toBe('x')
  })

  it('concurrent sets serialise — every name lands', async () => {
    await Promise.all(['a', 'b', 'c'].map((n) => secrets.set(n, n)))
    expect(Object.keys((await onDisk()).values).sort()).toEqual(['a', 'b', 'c'])
  })
})
