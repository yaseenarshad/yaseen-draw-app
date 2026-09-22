import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BOARD_META_HEAD_BYTES } from '@shared/drawingAssets'
import { readBoardHead } from './boardHead'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'board-head-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

const stamped = (extra = '') => `{\n  "yaseendraw": {\n    "createdAt": 1,\n    "updatedAt": 2\n  },\n  "type": "excalidraw",\n  "elements": [${extra}]\n}\n`

describe('readBoardHead (🔒 YAZ-1834 D6)', () => {
  it('answers the block, mtime and size of a stamped board from one open', async () => {
    const file = path.join(root, 'a.excalidraw')
    await writeFile(file, stamped())
    const st = await stat(file)
    expect(await readBoardHead(file)).toEqual({ block: { createdAt: 1, updatedAt: 2 }, mtime: st.mtimeMs, size: st.size })
  })

  it('answers a null block, with the stat, for a board without one', async () => {
    const file = path.join(root, 'legacy.excalidraw')
    await writeFile(file, '{"type":"excalidraw","elements":[]}')
    const st = await stat(file)
    expect(await readBoardHead(file)).toEqual({ block: null, mtime: st.mtimeMs, size: st.size })
  })

  it('reads only the head of a big board and still finds the block', async () => {
    const file = path.join(root, 'big.excalidraw')
    const big = stamped(Array.from({ length: 2000 }, (_, i) => `{"id":"${i}"}`).join(','))
    expect(big.length).toBeGreaterThan(BOARD_META_HEAD_BYTES * 10)
    await writeFile(file, big)
    expect((await readBoardHead(file))?.block).toEqual({ createdAt: 1, updatedAt: 2 })
  })

  it('is null for a missing file and rethrows anything else', async () => {
    expect(await readBoardHead(path.join(root, 'nope.excalidraw'))).toBeNull()
    await expect(readBoardHead(root)).rejects.toMatchObject({ code: 'EISDIR' })
  })
})
