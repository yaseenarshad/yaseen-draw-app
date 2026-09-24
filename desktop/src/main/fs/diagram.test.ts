import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DIAGRAM_CREATED_ATTR, DIAGRAM_UPDATED_ATTR, EMPTY_DIAGRAM_XML, parseDiagramMetaAttrs } from '@shared/diagramFile'
import { loadDiagram, saveDiagram } from './diagram'
import { buildTree } from './fsUtils'
import { failure } from './testFixture'

/**
 * The diagram document's two doors (🔒 YAZ-1802 D6) against a real temp vault: what opens, what is
 * refused with a readable reason, the mtime guard, and the dates main stamps on the root (D7).
 */
let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'yaz-1802-diagram-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

const PAGE = '<diagram id="p" name="Page-1"><mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel></diagram>'
const doc = (attrs = '', page = PAGE) => `<mxfile${attrs}>${page}</mxfile>\n`

async function seed(rel: string, body: string): Promise<string> {
  const file = path.join(root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  return file
}

describe('diagram:load', () => {
  it('answers the XML exactly as it is on disk, with its mtime and size — compressed pages too', async () => {
    const body = doc(' host="x"', '<diagram id="c" name="Zipped">7ZfBbqMwEIafhmPEFmQqPAAAA</diagram>')
    const file = await seed('Flow.drawio', body)
    const res = await loadDiagram({ root, path: 'Flow.drawio' })
    expect(res).toEqual({ path: file, xml: body, mtime: (await stat(file)).mtimeMs, size: Buffer.byteLength(body) })
  })

  it('opens UPPERCASE.DRAWIO and a unicode path in a nested folder', async () => {
    await seed('UPPERCASE.DRAWIO', doc())
    await seed('Ünïcödé 📊/Deep/Flow ✨.drawio', doc())
    expect((await loadDiagram({ root, path: 'UPPERCASE.DRAWIO' })).xml).toBe(doc())
    expect((await loadDiagram({ root, path: 'Ünïcödé 📊/Deep/Flow ✨.drawio' })).xml).toBe(doc())
  })

  it('refuses an empty, corrupt, foreign-XML or cut-short file with IO_ERROR naming the reason', async () => {
    const cases: Array<[string, string, RegExp]> = [
      ['Empty.drawio', '', /empty/],
      ['Corrupt.drawio', 'this is not xml', /not a draw.io diagram/],
      ['Foreign.drawio', '<note><to>Tove</to></note>', /not a draw.io diagram/],
      ['Cut.drawio', '<mxfile><diagram id="a">', /cut short/],
    ]
    for (const [name, body, why] of cases) {
      const file = await seed(name, body)
      const err = await failure(loadDiagram({ root, path: name }))
      expect(err.code, name).toBe('IO_ERROR')
      expect(err.message, name).toMatch(why)
      expect(err.path, name).toBe(file)
    }
  })

  it('refuses every other kind (UNSUPPORTED_EXTENSION), a .drawio.svg included, and paths out of the vault', async () => {
    await seed('image.drawio.svg', '<svg/>')
    await seed('b.excalidraw', '{"elements":[]}')
    expect((await failure(loadDiagram({ root, path: 'image.drawio.svg' }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(loadDiagram({ root, path: 'b.excalidraw' }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(loadDiagram({ root, path: '../x.drawio' }))).code).toBe('BAD_REQUEST')
    expect((await failure(loadDiagram({ root, path: 'missing.drawio' }))).code).toBe('NOT_FOUND')
  })
})

describe('diagram:save', () => {
  it('writes the XML atomically with both dates first on the root; created is kept, updated moves', async () => {
    const file = await seed('Flow.drawio', doc(` ${DIAGRAM_CREATED_ATTR}="1000" ${DIAGRAM_UPDATED_ATTR}="2000"`))
    const { mtime } = await loadDiagram({ root, path: 'Flow.drawio' })
    const before = Date.now()
    // draw.io drops attributes it does not know: the save arrives WITHOUT the dates.
    const res = await saveDiagram({ root, path: 'Flow.drawio', xml: doc(' host="drawio"'), expectedMtime: mtime })
    const written = await readFile(file, 'utf8')
    const meta = parseDiagramMetaAttrs(written)
    expect(meta?.createdAt).toBe(1000)
    expect(meta?.updatedAt).toBeGreaterThanOrEqual(before)
    expect(written).toMatch(new RegExp(`^<mxfile ${DIAGRAM_CREATED_ATTR}="1000" ${DIAGRAM_UPDATED_ATTR}="\\d+" host="drawio">`))
    expect(res).toEqual({ path: file, mtime: (await stat(file)).mtimeMs, size: Buffer.byteLength(written) })
  })

  it('a diagram with no dates (written elsewhere) is born them on its first save, aged by its file', async () => {
    const file = await seed('Plain.drawio', doc())
    const { mtimeMs } = await stat(file)
    await saveDiagram({ root, path: 'Plain.drawio', xml: doc() })
    expect(parseDiagramMetaAttrs(await readFile(file, 'utf8'))?.createdAt).toBe(mtimeMs)
  })

  it('a bare <mxGraphModel> file gains its dates with the first save, which draw.io always writes as an <mxfile>', async () => {
    const file = await seed('Bare.drawio', '<mxGraphModel><root><mxCell id="0" /></root></mxGraphModel>\n')
    const { mtime } = await loadDiagram({ root, path: 'Bare.drawio' })
    await saveDiagram({ root, path: 'Bare.drawio', xml: doc(), expectedMtime: mtime })
    expect(parseDiagramMetaAttrs(await readFile(file, 'utf8'))?.createdAt).toBe(mtime)
  })

  it('a save with no expectedMtime (Version history\'s Restore) writes over a changed file and keeps its created date', async () => {
    const file = await seed('Flow.drawio', doc(` ${DIAGRAM_CREATED_ATTR}="1000" ${DIAGRAM_UPDATED_ATTR}="2000"`))
    await writeFile(file, doc(` ${DIAGRAM_CREATED_ATTR}="1000" ${DIAGRAM_UPDATED_ATTR}="3000" host="outside"`))
    await saveDiagram({ root, path: 'Flow.drawio', xml: doc(' host="restored"') })
    const written = await readFile(file, 'utf8')
    expect(written).toContain('host="restored"')
    expect(parseDiagramMetaAttrs(written)?.createdAt).toBe(1000)
  })

  it('CONFLICT on a stale mtime, and NOTHING is written', async () => {
    const file = await seed('Flow.drawio', doc())
    const err = await failure(saveDiagram({ root, path: 'Flow.drawio', xml: doc(' host="mine"'), expectedMtime: 1 }))
    expect(err.code).toBe('CONFLICT')
    expect(err.mtime).toBe((await stat(file)).mtimeMs)
    expect(await readFile(file, 'utf8')).toBe(doc())
  })

  it('a file that is GONE is not a conflict: the tab’s copy lands', async () => {
    await saveDiagram({ root, path: 'Gone.drawio', xml: doc(), expectedMtime: 123 })
    expect(parseDiagramMetaAttrs(await readFile(path.join(root, 'Gone.drawio'), 'utf8'))).not.toBeNull()
  })

  it('refuses XML draw.io could not have produced (BAD_REQUEST) and a non-diagram path, before touching the disk', async () => {
    const file = await seed('Flow.drawio', doc())
    expect((await failure(saveDiagram({ root, path: 'Flow.drawio', xml: '' }))).code).toBe('BAD_REQUEST')
    expect((await failure(saveDiagram({ root, path: 'Flow.drawio', xml: '{"elements":[]}' }))).code).toBe('BAD_REQUEST')
    expect((await failure(saveDiagram({ root, path: 'Flow.drawio', xml: 42 as never }))).code).toBe('BAD_REQUEST')
    expect((await failure(saveDiagram({ root, path: 'b.excalidraw', xml: doc() }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(file, 'utf8')).toBe(doc())
  })
})

describe('fs:tree reads a diagram’s dates off its head (🔒 YAZ-1802 D7)', () => {
  it('a stamped diagram carries meta and kind "diagram"; an unstamped one and a .drawio.svg carry none', async () => {
    await seed('Stamped.drawio', doc(` ${DIAGRAM_CREATED_ATTR}="1000" ${DIAGRAM_UPDATED_ATTR}="2000" agent="${'x'.repeat(400)}"`))
    await seed('Plain.drawio', EMPTY_DIAGRAM_XML)
    await seed('image.drawio.svg', '<svg/>')
    const byName = Object.fromEntries((await buildTree(root)).map((n) => [n.name, n]))
    expect(byName['Stamped.drawio']).toMatchObject({ kind: 'diagram', meta: { createdAt: 1000, updatedAt: 2000 } })
    expect(byName['Plain.drawio']).toMatchObject({ kind: 'diagram' })
    expect(byName['Plain.drawio']).not.toHaveProperty('meta')
    expect(byName['image.drawio.svg']).toMatchObject({ kind: null })
  })
})
