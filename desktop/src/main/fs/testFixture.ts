import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BridgeFailure } from './fsUtils'

/** Creates a temp vault with drawings, files with no in-app viewer, and hidden entries; caller removes it via `cleanup`. */
export async function makeFixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'yaseendraw-'))
  await mkdir(path.join(root, 'Zeta', 'inner'), { recursive: true })
  await mkdir(path.join(root, 'alpha'), { recursive: true })
  await mkdir(path.join(root, 'Empty'), { recursive: true })
  await mkdir(path.join(root, 'assets-only'), { recursive: true })
  // The image store (🔒 YAZ-1775 D3) and a user folder of the same name one level down: the tree hides
  // the first and shows the second, and `tree.test.ts` holds that line.
  await mkdir(path.join(root, 'assets'), { recursive: true })
  await mkdir(path.join(root, 'Zeta', 'assets'), { recursive: true })
  await mkdir(path.join(root, '.obsidian'), { recursive: true })
  await mkdir(path.join(root, '.yaseendraw'), { recursive: true })
  await mkdir(path.join(root, '.git'), { recursive: true })
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, 'b.excalidraw'), '{"b":1}\n'),
    writeFile(path.join(root, 'A.excalidraw'), '{"A":1}\n'),
    writeFile(path.join(root, 'notes.txt'), 'not a drawing'),
    writeFile(path.join(root, 'book.epub'), 'no in-app viewer'),
    writeFile(path.join(root, '.hidden.excalidraw'), 'hidden'),
    writeFile(path.join(root, 'Zeta', 'inner', 'deep.excalidraw'), 'deep'),
    writeFile(path.join(root, 'Zeta', 'z.excalidraw'), 'z'),
    writeFile(path.join(root, 'alpha', 'a.excalidraw'), 'a'),
    writeFile(path.join(root, 'assets-only', 'img.png'), 'png'),
    writeFile(path.join(root, 'assets', 'deadbeef.png'), 'stored bytes'),
    writeFile(path.join(root, 'Zeta', 'assets', 'theirs.excalidraw'), '{"elements":[]}'),
    writeFile(path.join(root, '.obsidian', 'workspace.excalidraw'), 'ws'),
    writeFile(path.join(root, '.yaseendraw', 'foo.json'), '{"a":1}'),
    writeFile(path.join(root, 'node_modules', 'pkg', 'README.excalidraw'), 'readme'),
  ])
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

/** The `BridgeFailure` a promise rejects with. */
export async function failure(p: Promise<unknown>): Promise<BridgeFailure> {
  try {
    await p
  } catch (err) {
    if (err instanceof BridgeFailure) return err
    throw new Error(`expected a BridgeFailure, got ${String(err)}`)
  }
  throw new Error('expected the promise to reject')
}

/** Polls `pred` every 20 ms until true, or throws after `ms`. */
export async function until(pred: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}
