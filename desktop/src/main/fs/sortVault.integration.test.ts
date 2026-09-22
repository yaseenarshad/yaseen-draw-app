import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { TreeNode } from '@shared/types'
import { sortTree } from '@shared/treeSort'
import { loadDrawing, saveDrawing } from './drawing'
import { tree } from './tree'

/**
 * 1835F — the locked sort scenarios against the REAL tree door and the vault
 * `tools/seedSortDemoVault.mjs` builds (the demo Yasin approved). `sortTree` is the same pure rule
 * the sidebar applies; this proves it over real files, real mtimes and real junk. No Playwright.
 * `.integration.test.ts` because it forks `node`: seconds, not milliseconds.
 */

const run = promisify(execFile)
const SEED = path.resolve(__dirname, '../../../../tools/seedSortDemoVault.mjs')

let work: string
let vault: string
beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'yd-1835f-'))
  vault = path.join(work, 'Sidebar Sort and Board Info')
  await run(process.execPath, [SEED, '--vault', vault])
}, 60_000)
afterAll(async () => {
  await chmod(path.join(vault, 'Locked — chmod 000, still listed.excalidraw'), 0o644).catch(() => undefined)
  await rm(work, { recursive: true, force: true })
})

const names = (nodes: TreeNode[]) => nodes.map((n) => n.name.replace(/\.excalidraw$/, ''))
const dirOf = (nodes: TreeNode[], name: string) => {
  const d = nodes.find((n) => n.name === name)
  if (d === undefined || d.type !== 'dir') throw new Error(`no folder ${name}`)
  return d.children
}
const sorted = async (order: 'name' | 'updated' | 'created') => sortTree((await tree(vault)).tree, order)

describe('1835F — the sort orders on the seeded vault', () => {
  it('folders lead by name under every order; the root boards land in three different orders', async () => {
    const folders = ['Alpha folder', 'Empty folder', 'Fifteen boards', 'mixed Case Folder', 'Zed folder — sorts by name, not by date']
    const byName = names(await sorted('name'))
    const byUpdated = names(await sorted('updated'))
    const byCreated = names(await sorted('created'))
    for (const list of [byName, byUpdated, byCreated]) expect(list.slice(0, 5)).toEqual(folders)
    // Name: case-insensitive, accents in place, non-Latin last.
    expect(byName.slice(5, 9)).toEqual(['Apple — old, edited yesterday', 'Bad block — createdAt is a string', 'Banana — newest board, never edited', 'big Big BIG — three cases'])
    expect(byName.at(-1)).toBe('日本語 — non-latin name')
    // Updated: the future-dated board first, then the legacy board touched 5 minutes ago (mtime is its
    // date), then the newest board; the block beats today's mtime on "Cloned", which sorts as 2022.
    expect(byUpdated.slice(5, 8)).toEqual(['Future — updated next year', 'Legacy — no block, mtime 5 minutes ago', 'Banana — newest board, never edited'])
    expect(byUpdated.indexOf('Cloned — block says 2022, mtime says today')).toBeGreaterThan(byUpdated.indexOf('Elder — the oldest board of all'))
    expect(byUpdated.indexOf('Tie 1 — same updated as Tie 2')).toBe(byUpdated.indexOf('Tie 2 — same updated as Tie 1') - 1)
    // Created: a legacy board's mtime is its birth too, so the one touched 5 minutes ago leads; epoch zero is last.
    expect(byCreated.slice(5, 7)).toEqual(['Legacy — no block, mtime 5 minutes ago', 'Banana — newest board, never edited'])
    expect(byCreated.at(-1)).toBe('Epoch — created in 1970')
    // The three disagree.
    expect(byUpdated).not.toEqual(byName)
    expect(byCreated).not.toEqual(byName)
    expect(byCreated).not.toEqual(byUpdated)
  })

  it('folder contents follow the order at every depth', async () => {
    const alpha = dirOf(await sorted('updated'), 'Alpha folder')
    expect(names(alpha)).toEqual(['Deep', 'Top of alpha', 'Legacy inside alpha'])
    expect(names(dirOf(alpha, 'Deep'))).toEqual(['Deeper', 'Middle board'])
    const fifteen = names(dirOf(await sorted('updated'), 'Fifteen boards'))
    expect(fifteen[0]).toBe('Board 01')
    expect(fifteen.at(-1)).toBe('Board 15')
  })

  it('every junk board is listed under every order, without meta, and nothing throws', async () => {
    const junk = ['Corrupt — not JSON', 'Empty — zero bytes', 'Misplaced — block is LAST, so it is ignored', 'Bad block — createdAt is a string', 'Locked — chmod 000, still listed']
    for (const order of ['name', 'updated', 'created'] as const) {
      const list = await sorted(order)
      for (const name of junk) {
        const node = list.find((n) => n.name.startsWith(name))
        expect(node, `${name} under ${order}`).toBeDefined()
        expect(node).not.toHaveProperty('meta')
      }
    }
  })

  it('saving a legacy board stamps it and moves it to the top under Last updated; a backfilled board keeps Created', async () => {
    const legacy = path.join(vault, 'Legacy — no block, mtime 90 days ago.excalidraw')
    const doc = await loadDrawing({ root: vault, path: legacy })
    await saveDrawing({ root: vault, path: legacy, json: doc.json, expectedMtime: doc.mtime, newFiles: [] })
    const byUpdated = names(await sorted('updated'))
    // Only the future-dated board (next year) can sit above a save made just now.
    expect(byUpdated.slice(5, 7)).toEqual(['Future — updated next year', 'Legacy — no block, mtime 90 days ago'])
    const cloud = path.join(vault, 'From the cloud — 2021 board with cloudId.excalidraw')
    const cdoc = await loadDrawing({ root: vault, path: cloud })
    await saveDrawing({ root: vault, path: cloud, json: cdoc.json, expectedMtime: cdoc.mtime, newFiles: [] })
    const block = (JSON.parse(await readFile(cloud, 'utf8')) as { yaseendraw: Record<string, unknown> }).yaseendraw
    expect(block).toMatchObject({ createdAt: Date.UTC(2021, 2, 4, 15, 6), cloudId: 'k97abc12' })
    expect(names(await sorted('created')).indexOf('From the cloud — 2021 board with cloudId')).toBeGreaterThan(10)
  })
})
