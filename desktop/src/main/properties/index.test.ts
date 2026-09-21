import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { PropertiesResponse } from '@shared/types'
import { failure, until } from '../fs/testFixture'
import { activeConfigWatcherRoots, VAULT_CONFIG_DIR } from '../vaultConfig'
import { getProperties, removeProperty, setProperty, subscribeProperties } from './index'

const roots: string[] = []
const offs: Array<() => void> = []
afterEach(async () => {
  offs.splice(0).forEach((off) => off())
  await until(() => activeConfigWatcherRoots().length === 0)
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-properties-'))
  roots.push(root)
  return root
}

const file = (root: string) => path.join(root, VAULT_CONFIG_DIR, 'properties.json')

async function seed(root: string, content: unknown): Promise<void> {
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(file(root), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`)
}

const onDisk = async (root: string): Promise<unknown> => JSON.parse(await readFile(file(root), 'utf8'))

describe('getProperties', () => {
  it('absent file → no declarations, no error, and NEVER creates .yaseendocs (lazy, LOCKED)', async () => {
    const root = await makeRoot()
    expect(await getProperties(root)).toEqual({ root, version: 1, properties: {} })
    expect(await readdir(root)).toEqual([])
  })

  it('parses a valid v1 file: vault-wide declarations with their optional fields', async () => {
    const root = await makeRoot()
    await seed(root, {
      version: 1,
      properties: { funnel_stages: { kind: 'multi-link', target: 'funnel-stage', required: true }, unit: { kind: 'text' }, related: { kind: 'multi-link' } },
    })
    const props = await getProperties(root)
    expect(props.error).toBeUndefined()
    expect(props.version).toBe(1)
    expect(props.properties).toEqual({
      funnel_stages: { kind: 'multi-link', target: 'funnel-stage', required: true },
      unit: { kind: 'text' },
      related: { kind: 'multi-link' },
    })
  })

  it('an unknown property kind reads as text (forward compat); the file keeps the original string', async () => {
    const root = await makeRoot()
    await seed(root, { version: 1, properties: { due: { kind: 'datetime' } } })
    expect((await getProperties(root)).properties.due).toEqual({ kind: 'text' })
    expect(((await onDisk(root)) as { properties: { due: { kind: string } } }).properties.due.kind).toBe('datetime')
  })

  it('corrupt JSON / non-object root / missing or non-numeric version → no declarations + error string', async () => {
    const root = await makeRoot()
    await seed(root, '{not json')
    let props = await getProperties(root)
    expect(props.properties).toEqual({})
    expect(props.error).toBeTruthy()
    await seed(root, [1, 2])
    props = await getProperties(root)
    expect(props.error).toBeTruthy()
    await seed(root, { properties: {} }) // no version at all
    props = await getProperties(root)
    expect(props.error).toBeTruthy()
    await seed(root, { version: '1', properties: {} }) // non-numeric version
    props = await getProperties(root)
    expect(props.error).toBeTruthy()
  })

  it('version > 1 reads best-effort with NO error and reports the file version', async () => {
    const root = await makeRoot()
    await seed(root, { version: 2, properties: { unit: { kind: 'text' } }, future_section: true })
    const props = await getProperties(root)
    expect(props.error).toBeUndefined()
    expect(props.version).toBe(2)
    expect(props.properties.unit).toEqual({ kind: 'text' })
  })

  it('an old types.json is simply not read — properties.json is the only file this module knows', async () => {
    const root = await makeRoot()
    await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
    await writeFile(path.join(root, VAULT_CONFIG_DIR, 'types.json'), `${JSON.stringify({ version: 1, properties: { legacy: { kind: 'text' } } })}\n`)
    expect(await getProperties(root)).toEqual({ root, version: 1, properties: {} })
  })

  it('root missing / not a dir / relative → NOT_FOUND / NOT_A_DIRECTORY / NOT_ABSOLUTE', async () => {
    const root = await makeRoot()
    expect((await failure(getProperties(path.join(root, 'gone')))).code).toBe('NOT_FOUND')
    await writeFile(path.join(root, 'a-file'), 'x')
    expect((await failure(getProperties(path.join(root, 'a-file')))).code).toBe('NOT_A_DIRECTORY')
    expect((await failure(getProperties('rel'))).code).toBe('NOT_ABSOLUTE')
  })
})

describe('setProperty', () => {
  it('the first mutation lazily creates .yaseendocs/properties.json with a version-1 skeleton', async () => {
    const root = await makeRoot()
    await setProperty(root, 'related', { kind: 'multi-link' })
    expect(await onDisk(root)).toEqual({ version: 1, properties: { related: { kind: 'multi-link' } } })
    expect((await getProperties(root)).properties.related).toEqual({ kind: 'multi-link' })
  })

  it('upserts one declaration at a time; siblings are untouched', async () => {
    const root = await makeRoot()
    await setProperty(root, 'related', { kind: 'multi-link' })
    await setProperty(root, 'unit', { kind: 'text' })
    await setProperty(root, 'related', { kind: 'link', target: 'kpi' }) // replaces just that one
    expect((await getProperties(root)).properties).toEqual({ related: { kind: 'link', target: 'kpi' }, unit: { kind: 'text' } })
  })

  it('rejects bad property names (grammar ^[a-z][a-z0-9_]*$) and writes nothing', async () => {
    const root = await makeRoot()
    for (const bad of ['Foo', 'foo-bar', '1x', '', 'füü', 'foo bar']) {
      expect((await failure(setProperty(root, bad, { kind: 'text' }))).code).toBe('BAD_REQUEST')
    }
    expect((await failure(setProperty(root, 42 as never, { kind: 'text' }))).code).toBe('BAD_REQUEST')
    expect(await readdir(root)).toEqual([]) // no dotfolder from rejected mutations
  })

  it("accepts 'page_type' like any other name — the identity rule died with the type system (YAZ-836)", async () => {
    const root = await makeRoot()
    await setProperty(root, 'page_type', { kind: 'text' })
    expect((await getProperties(root)).properties.page_type).toEqual({ kind: 'text' })
  })

  it('rejects bad declarations (kind outside the enum, wrong-typed target/required)', async () => {
    const root = await makeRoot()
    expect((await failure(setProperty(root, 'a', { kind: 'datetime' as never }))).code).toBe('BAD_REQUEST')
    expect((await failure(setProperty(root, 'a', { kind: 'link', target: 7 as never }))).code).toBe('BAD_REQUEST')
    expect((await failure(setProperty(root, 'a', { kind: 'text', required: 'yes' as never }))).code).toBe('BAD_REQUEST')
    expect((await failure(setProperty(root, 'a', null as never))).code).toBe('BAD_REQUEST')
    expect(await readdir(root)).toEqual([])
  })

  it('ignores unknown keys in the incoming declaration (they never reach disk)', async () => {
    const root = await makeRoot()
    await setProperty(root, 'unit', { kind: 'text', future: true } as never)
    expect(((await onDisk(root)) as { properties: { unit: Record<string, unknown> } }).properties.unit).toEqual({ kind: 'text' })
  })
})

describe('removeProperty', () => {
  it('removes a declaration; an unknown name is a no-op that creates nothing', async () => {
    const root = await makeRoot()
    await removeProperty(root, 'ghost_prop') // absent file: no-op, no creation
    expect(await readdir(root)).toEqual([])
    await setProperty(root, 'related', { kind: 'multi-link' })
    await setProperty(root, 'unit', { kind: 'text' })
    await removeProperty(root, 'related')
    await removeProperty(root, 'ghost_prop') // no-op
    expect((await getProperties(root)).properties).toEqual({ unit: { kind: 'text' } })
  })
})

describe('corrupt and newer-version files (R2.5)', () => {
  it('every mutation on a corrupt file rejects INVALID_CONFIG; the bytes are never touched or moved aside', async () => {
    const root = await makeRoot()
    await seed(root, '{broken json')
    expect((await failure(setProperty(root, 'a', { kind: 'text' }))).code).toBe('INVALID_CONFIG')
    expect((await failure(removeProperty(root, 'a'))).code).toBe('INVALID_CONFIG')
    expect(await readFile(file(root), 'utf8')).toBe('{broken json') // byte-identical, no move-aside
    expect(await readdir(path.join(root, VAULT_CONFIG_DIR))).toEqual(['properties.json'])
  })

  it('a version > 1 file rejects mutations with INVALID_CONFIG and stays untouched', async () => {
    const root = await makeRoot()
    await seed(root, { version: 2, properties: {} })
    expect((await failure(setProperty(root, 'a', { kind: 'text' }))).code).toBe('INVALID_CONFIG')
    expect((await failure(removeProperty(root, 'a'))).code).toBe('INVALID_CONFIG')
    expect(await onDisk(root)).toEqual({ version: 2, properties: {} })
  })

  it('mutations on a missing root reject NOT_FOUND and never create it', async () => {
    const root = await makeRoot()
    const gone = path.join(root, 'gone')
    expect((await failure(setProperty(gone, 'a', { kind: 'text' }))).code).toBe('NOT_FOUND')
    expect(await readdir(root)).toEqual([])
  })
})

describe('unknown-field preservation (external round-trip without data loss)', () => {
  it('a mutation keeps unknown fields at top level and property level', async () => {
    const root = await makeRoot()
    await seed(root, {
      version: 1,
      future_top: { keep: 'me' },
      properties: { related: { kind: 'multi-link', future_prop: [1, 2] } },
    })
    await setProperty(root, 'funnel_stages', { kind: 'multi-link', target: 'funnel-stage' })
    const disk = (await onDisk(root)) as { version: number; future_top: unknown; properties: Record<string, Record<string, unknown>> }
    expect(disk.future_top).toEqual({ keep: 'me' }) // top level
    expect(disk.properties.related).toEqual({ kind: 'multi-link', future_prop: [1, 2] }) // sibling untouched
    expect(disk.properties.funnel_stages).toEqual({ kind: 'multi-link', target: 'funnel-stage' })
  })
})

describe('write ordering', () => {
  it('two mutations fired concurrently both land (the read-modify-write is serialised per root)', async () => {
    const root = await makeRoot()
    await Promise.all([setProperty(root, 'first', { kind: 'text' }), setProperty(root, 'second', { kind: 'number' })])
    expect((await getProperties(root)).properties).toEqual({ first: { kind: 'text' }, second: { kind: 'number' } })
  })
})

describe('subscribeProperties', () => {
  const collect = (root: string): PropertiesResponse[] => {
    const seen: PropertiesResponse[] = []
    offs.push(subscribeProperties(root, (props) => seen.push(props)))
    return seen
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('an own mutation notifies with the freshly-read declarations', async () => {
    const root = await makeRoot()
    const seen = collect(root)
    await sleep(200) // let the watcher settle
    await setProperty(root, 'related', { kind: 'multi-link' })
    await until(() => seen.length >= 1)
    const last = seen[seen.length - 1]
    expect(last?.root).toBe(root)
    expect(last?.properties).toEqual({ related: { kind: 'multi-link' } })
  })

  it('an external edit to properties.json notifies with the parsed declarations; other config files never do', async () => {
    const root = await makeRoot()
    await setProperty(root, 'related', { kind: 'multi-link' })
    const seen = collect(root)
    await sleep(300) // let the watcher finish its initial scan
    await writeFile(file(root), `${JSON.stringify({ version: 1, properties: { unit: { kind: 'number' } } }, null, 2)}\n`)
    await until(() => seen.length >= 1)
    expect(seen[seen.length - 1]?.properties).toEqual({ unit: { kind: 'number' } })
    const count = seen.length
    await writeFile(path.join(root, VAULT_CONFIG_DIR, 'view.json'), '{"open":true}')
    await sleep(500)
    expect(seen.length).toBe(count) // view.json is not this file
  })

  it('an external edit that corrupts the file notifies an errored, empty snapshot (live repair loop)', async () => {
    const root = await makeRoot()
    await setProperty(root, 'related', { kind: 'multi-link' })
    const seen = collect(root)
    await sleep(300)
    await writeFile(file(root), '{broken')
    await until(() => seen.length >= 1 && seen[seen.length - 1]?.error !== undefined)
    expect(seen[seen.length - 1]?.properties).toEqual({})
  })
})


it('round-trips ordered select declarations and rejects invalid options without touching config', async () => {
  const root = await makeRoot()
  await setProperty(root, 'status', { kind: 'select', options: ['Later', 'Ready'] })
  await setProperty(root, 'labels', { kind: 'multi-select', options: ['Blue', 'Green'] })
  expect((await getProperties(root)).properties.status).toEqual({ kind: 'select', options: ['Later', 'Ready'] })
  expect((await getProperties(root)).properties.labels).toEqual({ kind: 'multi-select', options: ['Blue', 'Green'] })
  const before = await readFile(file(root), 'utf8')
  for (const options of [['Ready', 'Ready'], [''], ['   ']]) {
    await expect(setProperty(root, 'status', { kind: 'select', options })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await readFile(file(root), 'utf8')).toBe(before)
  }
})

it('reads malformed options tolerantly without rewriting stored declarations', async () => {
  const root = await makeRoot()
  await seed(root, { version: 1, properties: { status: { kind: 'select', options: ['B', null, 'A', 'B', ''] } } })
  const before = await readFile(file(root), 'utf8')
  expect((await getProperties(root)).properties.status.options).toEqual(['B', 'A'])
  expect(await readFile(file(root), 'utf8')).toBe(before)
})

it('round-trips all option sort modes without sorting stored options; rejects invalid modes atomically', async () => {
  const root = await makeRoot()
  for (const optionSort of ['ascending', 'descending', 'manual'] as const) {
    await setProperty(root, 'status', { kind: 'select', options: ['Z', 'A'], optionSort })
    expect((await getProperties(root)).properties.status).toEqual({ kind: 'select', options: ['Z', 'A'], optionSort })
  }
  const before = await readFile(file(root), 'utf8')
  for (const optionSort of ['ASC', '', null, 1]) {
    await expect(setProperty(root, 'status', { kind: 'select', optionSort } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await readFile(file(root), 'utf8')).toBe(before)
  }
})

it('ignores an unknown stored option sort mode without rewriting config', async () => {
  const root = await makeRoot()
  await seed(root, { version: 1, properties: { status: { kind: 'select', options: ['Z', 'A'], optionSort: 'future-mode' } } })
  const before = await readFile(file(root), 'utf8')
  expect((await getProperties(root)).properties.status).toEqual({ kind: 'select', options: ['Z', 'A'] })
  expect(await readFile(file(root), 'utf8')).toBe(before)
})
