// The create race, pinned (YAZ-985 → fixed by YAZ-986): the watcher's live `scanFile` is
// fire-and-forget, and `getIndex` used to snapshot the records map without draining it — so a
// snapshot requested while a just-created file was mid-scan silently missed that file, and the
// renderer (whose refetch is edge-triggered, once) never asked again. The gate below holds the
// live scan open deliberately, which the polling `until` idiom in live.test.ts can never do.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeViewsFixture } from '../fs/viewsFixture'
import { _evictAll, getIndex } from './index'

const gate = vi.hoisted(() => {
  let release = (): void => undefined
  let open: Promise<void> | null = null
  return {
    calls: new Set<string>(),
    close: (): void => {
      open = new Promise((r) => (release = r))
    },
    open: (): void => {
      release()
      open = null
    },
    held: (): Promise<void> | null => open,
  }
})

// Every importer of `./scan` (the live watcher path AND reconcile's cold scan) goes through the
// gate; it starts open, so only the window this test closes deliberately is ever delayed.
vi.mock('./scan', async (importOriginal) => {
  const real = await importOriginal<typeof import('./scan')>()
  return {
    scanFile: async (root: string, file: string) => {
      gate.calls.add(file)
      const held = gate.held()
      if (held !== null) await held
      return real.scanFile(root, file)
    },
  }
})

const until = async (pred: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('getIndex: drains in-flight watcher scans (YAZ-986)', () => {
  let root: string
  let cleanup: () => Promise<void>
  beforeAll(async () => {
    ;({ root, cleanup } = await makeViewsFixture())
    await getIndex(root) // cold build with the gate open; the watcher is live from here on
  })
  afterAll(async () => {
    gate.open()
    _evictAll()
    await cleanup()
  })

  it('a snapshot requested while a created note is mid-scan still includes that note', async () => {
    const file = path.join(root, 'Raced.md')
    gate.close()
    await writeFile(file, '---\nfolder_pages:\n  - "[[VSL-v1]]"\n---\n\n# raced\n')
    await until(() => gate.calls.has(file)) // the watcher fired; the scan is now in flight, held
    const snapshot = getIndex(root) // the renderer's one refetch, arriving mid-scan
    setTimeout(() => gate.open(), 100) // the scan finishes a beat later, as under real load
    const { records } = await snapshot
    expect(records.some((r) => r.path === file)).toBe(true)
  })
})
