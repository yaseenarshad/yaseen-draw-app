import type { PropertiesResponse, PropertyDecl, PropertyKind } from '@shared/types'
import { PROPERTY_KINDS, PROPERTY_NAME } from '@shared/types'
import { readPropertyOptions, validPropertyOptions, validPropertyOptionSort } from '@shared/propertyOptions'
import { BridgeFailure, requireAbsPath, requireDir } from '../fs/fsUtils'
import { readConfigDetailed, subscribeConfig, writeConfig } from '../vaultConfig'

/**
 * Vault-wide property declarations (YAZ-835): `<root>/.yaseendraw/properties.json` read and
 * written through the vaultConfig plumbing (GRO-2188). Electron-free, like the vault index.
 *
 * Lazy (LOCKED): `getProperties` never creates anything; the first successful mutation creates
 * the dotfolder and the file. Every mutation is a read-modify-write on the raw parsed object —
 * only the keys the mutation names are touched, then the whole object is re-serialised, so
 * unknown fields at every level (top, property) survive external tools' additions
 * byte-for-nothing-lost. Mutations are serialised per root (the store's write-chain idiom) so
 * two can't interleave reads.
 *
 * Corrupt / newer files (R2.5): unparsable JSON, a non-object root or a missing/non-numeric
 * `version` read as no declarations plus an `error` string, and every mutation rejects
 * `INVALID_CONFIG` — the file is NEVER overwritten or moved aside (the opposite of the app-state
 * store's policy, deliberately: app state is disposable, the user's schema is not). A numeric
 * `version` > 1 reads best-effort (known fields consumed, no error) but also refuses mutations:
 * writing a v1 shape over a newer file would destroy fields this version doesn't know.
 */

export const PROPERTIES_FILE = 'properties.json'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---------- input validation (strict at the IPC boundary: a write is config, not content) ----------

function requirePropertyName(name: unknown): string {
  if (typeof name !== 'string' || !PROPERTY_NAME.test(name)) {
    throw new BridgeFailure('BAD_REQUEST', `property names are snake_case (${String(PROPERTY_NAME)})`, { path: String(name) })
  }
  return name
}

/** Known fields only, each type-checked; unknown keys are ignored (the `setFolder` patch posture). */
function requirePropertyDecl(raw: unknown): PropertyDecl {
  if (!isRecord(raw)) throw new BridgeFailure('BAD_REQUEST', 'property declaration must be an object')
  if (typeof raw.kind !== 'string' || !(PROPERTY_KINDS as readonly string[]).includes(raw.kind)) {
    throw new BridgeFailure('BAD_REQUEST', `'kind' must be one of ${PROPERTY_KINDS.join(', ')}`)
  }
  const decl: PropertyDecl = { kind: raw.kind as PropertyKind }
  if (raw.target !== undefined) {
    if (typeof raw.target !== 'string') throw new BridgeFailure('BAD_REQUEST', "'target' must be a string")
    decl.target = raw.target
  }
  if (raw.required !== undefined) {
    if (typeof raw.required !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'required' must be a boolean")
    decl.required = raw.required
  }
  if (raw.options !== undefined) {
    if (!validPropertyOptions(raw.options)) throw new BridgeFailure('BAD_REQUEST', "'options' must be a list of unique non-empty labels")
    decl.options = [...raw.options]
  }
  if (raw.optionSort !== undefined) {
    if (!validPropertyOptionSort(raw.optionSort)) throw new BridgeFailure('BAD_REQUEST', "'optionSort' must be manual, ascending, or descending")
    decl.optionSort = raw.optionSort
  }
  return decl
}

// ---------- reading (best-effort: known fields consumed, names passed through as data) ----------

function parseDecls(raw: unknown): Record<string, PropertyDecl> {
  const out: Record<string, PropertyDecl> = {}
  if (!isRecord(raw)) return out
  for (const [name, decl] of Object.entries(raw)) {
    if (!isRecord(decl)) continue
    // An unknown or missing `kind` string is preserved on disk and read as text (forward compat).
    const kind = typeof decl.kind === 'string' && (PROPERTY_KINDS as readonly string[]).includes(decl.kind) ? (decl.kind as PropertyKind) : 'text'
    const clean: PropertyDecl = { kind }
    if (typeof decl.target === 'string') clean.target = decl.target
    if (typeof decl.required === 'boolean') clean.required = decl.required
    const options = readPropertyOptions(decl.options)
    if (options !== undefined) clean.options = options
    if (validPropertyOptionSort(decl.optionSort)) clean.optionSort = decl.optionSort
    out[name] = clean
  }
  return out
}

const empty = (root: string, error?: string): PropertiesResponse =>
  error === undefined ? { root, version: 1, properties: {} } : { root, version: 1, properties: {}, error }

/** Why a raw document refuses mutations; null when it is a mutable v1 object. */
function immutableReason(raw: unknown): string | null {
  if (!isRecord(raw)) return 'properties.json is not a JSON object'
  if (raw.version === 1) return null
  if (typeof raw.version === 'number' && Number.isFinite(raw.version) && raw.version > 1) {
    return `properties.json has version ${raw.version}, written by a newer app version`
  }
  return "properties.json has a missing or invalid 'version'"
}

async function read(root: string): Promise<PropertiesResponse> {
  const res = await readConfigDetailed(root, PROPERTIES_FILE)
  if (res.state === 'absent') return empty(root)
  if (res.state === 'malformed') return empty(root, `properties.json is not valid JSON: ${res.error}`)
  const raw = res.value
  const reason = immutableReason(raw)
  const record = raw as Record<string, unknown>
  // A numeric version > 1 is readable best-effort (no error); everything else immutable is corrupt.
  if (reason !== null && !(isRecord(raw) && typeof record.version === 'number' && record.version > 1)) return empty(root, reason)
  return { root, version: record.version as number, properties: parseDecls(record.properties) }
}

/** Empty declarations (no error) when the file does not exist; never creates anything. */
export async function getProperties(root: string): Promise<PropertiesResponse> {
  const r = requireAbsPath(root, 'root')
  await requireDir(r)
  return read(r)
}

// ---------- mutation (serialised read-modify-write per root; unknown fields preserved) ----------

/** Per-root promise chain, the store's idiom: two mutations (or notify re-reads) can't interleave. */
const chains = new Map<string, Promise<unknown>>()

function chained<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(root) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  chains.set(
    root,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}

/** `fn` edits the raw document in place and says whether anything changed; unchanged skips the write. */
async function mutate(root: string, fn: (raw: Record<string, unknown>) => boolean): Promise<void> {
  await requireDir(root)
  const res = await readConfigDetailed(root, PROPERTIES_FILE)
  let raw: Record<string, unknown>
  if (res.state === 'absent') {
    raw = { version: 1, properties: {} } // lazy creation: the first mutation makes the skeleton
  } else if (res.state === 'malformed') {
    throw new BridgeFailure('INVALID_CONFIG', `properties.json is unreadable and will not be overwritten: ${res.error}`, { path: res.file })
  } else {
    const reason = immutableReason(res.value)
    if (reason !== null) throw new BridgeFailure('INVALID_CONFIG', `${reason}; mutations are refused so nothing is lost`)
    raw = res.value as Record<string, unknown>
  }
  if (fn(raw)) await writeConfig(root, PROPERTIES_FILE, raw)
}

/** The value at `obj[key]` as a record, replacing non-record garbage with a fresh one. */
function ensureRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = obj[key]
  if (isRecord(current)) return current
  const fresh: Record<string, unknown> = {}
  obj[key] = fresh
  return fresh
}

/** Upsert one vault-wide declaration; creates the dotfolder and the file on demand. */
export async function setProperty(root: string, name: string, decl: PropertyDecl): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const n = requirePropertyName(name)
  const d = requirePropertyDecl(decl)
  return chained(r, () =>
    mutate(r, (raw) => {
      ensureRecord(raw, 'properties')[n] = d
      return true
    }),
  )
}

/** Removing an unknown property is a no-op (and never creates the file). */
export async function removeProperty(root: string, name: string): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const n = requirePropertyName(name)
  return chained(r, () =>
    mutate(r, (raw) => {
      if (!isRecord(raw.properties) || !(n in raw.properties)) return false
      delete raw.properties[n]
      return true
    }),
  )
}

/**
 * Fires with the freshly-read declarations after any change to properties.json — an own mutation
 * (vaultConfig notifies synchronously) or an external edit (its dotfolder watcher). Re-reads run
 * through the same per-root chain as mutations, so notifications deliver in order. Returns an
 * unsubscribe.
 */
export function subscribeProperties(root: string, listener: (properties: PropertiesResponse) => void): () => void {
  const r = requireAbsPath(root, 'root')
  return subscribeConfig(r, (change) => {
    if (change.name !== PROPERTIES_FILE) return
    void chained(r, async () => {
      try {
        listener(await read(r))
      } catch (err) {
        console.warn(`[properties] re-read of ${r} failed: ${String(err)}`) // e.g. the root vanished mid-notify
      }
    })
  })
}
