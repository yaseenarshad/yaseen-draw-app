import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { GITHUB_FILE_WARN_BYTES, MAX_DRAWING_BYTES, type VaultStorageFile, type VaultStorageStats } from '@shared/types'
import { isDrawing } from '@shared/fileKind'
import { ASSETS_DIR } from '@shared/drawingAssets'
import { isSkipped } from '../fs/fsUtils'
import { detectRepo } from './detect'
import { git, resolveGit } from './exec'

/**
 * WHAT A VAULT WEIGHS (YAZ-1801 D2) — the numbers behind Settings › Storage, from the disk and
 * the LOCAL git only. Never the network: GitHub's own view of the repo size needs an API call and
 * a token, and the question the page answers ("will GitHub take this, and what is making it
 * big?") is answered by what is on this machine.
 *
 * Electron-free and never throws for a vault's contents: a corrupt board still has a size (it
 * counts, with 0 embedded), an unreadable one is left out, a folder that is not a repo answers
 * `git: null`. Only a root that is not a directory at all rejects, because there is no answer.
 *
 * THE THREE GIT NUMBERS:
 *  - history = `git count-objects -v`, `size` + `size-pack` (KiB): every object `.git` holds,
 *    loose and packed — what a clone of this repo costs, give or take GitHub's own packing.
 *  - head = the ON-DISK (compressed) size of every object HEAD's tree needs: `rev-list --objects
 *    HEAD^{tree}` piped through `cat-file --batch-check='%(objectsize:disk)'`. Not `ls-tree -l`,
 *    which answers UNCOMPRESSED blob sizes and would make the subtraction below meaningless.
 *  - old versions = max(0, history − head): what a history reset would free (D6 shows the number
 *    and deliberately offers no button — "your files never depend on it").
 */

/** Sum of every `dataURL` string in a scene's `files` map — the bytes shrink would lift out. */
function embeddedBytesOf(scene: unknown): number {
  if (typeof scene !== 'object' || scene === null || Array.isArray(scene)) return 0
  const files = (scene as Record<string, unknown>).files
  if (typeof files !== 'object' || files === null) return 0
  let total = 0
  for (const entry of Object.values(files as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const { dataURL } = entry as Record<string, unknown>
    if (typeof dataURL === 'string') total += dataURL.length
  }
  return total
}

/** One board as the walk measured it: its size and the `dataURL` text still inside it. */
interface WalkedBoard extends VaultStorageFile {
  embeddedBytes: number
}

interface Walked {
  boards: WalkedBoard[]
  /** Every file at or over the 50 MiB warning, whatever its kind. */
  large: VaultStorageFile[]
  pictures: { bytes: number; count: number }
  other: { bytes: number; count: number }
}

/** One walk of the vault: every board measured (and parsed once for its embedded bytes), `assets/` and the rest summed. */
async function walk(root: string): Promise<Walked> {
  const out: Walked = { boards: [], large: [], pictures: { bytes: 0, count: 0 }, other: { bytes: 0, count: 0 } }
  const stack: Array<{ dir: string; inAssets: boolean }> = [{ dir: root, inAssets: false }]
  while (stack.length > 0) {
    const { dir, inAssets } = stack.pop()!
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      // Dot-entries (`.git`, `.yaseendraw`, Finder's droppings) and `node_modules` are invisible,
      // as they are to every other walk in the app.
      if (isSkipped(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        // Only the TOP-LEVEL `assets/` is the store (🔒 YAZ-1775 D3); a user's own `assets` folder deeper down is theirs.
        stack.push({ dir: full, inAssets: inAssets || (dir === root && e.name === ASSETS_DIR) })
        continue
      }
      if (!e.isFile()) continue
      const st = await stat(full).catch(() => null)
      if (st === null) continue
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (st.size >= GITHUB_FILE_WARN_BYTES) out.large.push({ path: rel, bytes: st.size })
      if (inAssets) {
        out.pictures.bytes += st.size
        out.pictures.count += 1
      } else if (isDrawing(e.name)) {
        let embeddedBytes = 0
        // Past the read ceiling a board is not parsed (it would not open either); it still counts by size.
        if (st.size <= MAX_DRAWING_BYTES) {
          try {
            embeddedBytes = embeddedBytesOf(JSON.parse(await readFile(full, 'utf8')))
          } catch {
            // Corrupt or unreadable: its size is real, its pictures are unknowable.
          }
        }
        out.boards.push({ path: rel, bytes: st.size, embeddedBytes })
      } else {
        out.other.bytes += st.size
        out.other.count += 1
      }
    }
  }
  return out
}

/** `count-objects -v` → `size` + `size-pack`, KiB → bytes. */
function historyBytes(countObjects: string): number {
  let kib = 0
  for (const line of countObjects.split('\n')) {
    const m = /^(size|size-pack):\s*(\d+)/.exec(line.trim())
    if (m !== null) kib += Number.parseInt(m[2], 10)
  }
  return kib * 1024
}

/** The git half; null for a folder that is not a repo, or a machine with no git. */
async function gitNumbers(root: string, candidates?: readonly string[]): Promise<VaultStorageStats['git']> {
  const bin = await resolveGit(candidates)
  if (bin === null) return null
  const facts = await detectRepo(bin, root)
  if (!facts.isRepo) return null
  const counted = await git(bin, root, ['count-objects', '-v'])
  const history = counted.code === 0 ? historyBytes(counted.stdout) : 0
  let head = 0
  // A repo with no commits has no HEAD tree: its snapshot costs nothing yet.
  const objects = await git(bin, root, ['rev-list', '--objects', '--no-object-names', 'HEAD^{tree}'])
  if (objects.code === 0 && objects.stdout.trim() !== '') {
    const sizes = await git(bin, root, ['cat-file', '--batch-check=%(objectsize:disk)'], { input: objects.stdout, timeoutMs: 120_000 })
    if (sizes.code === 0) for (const line of sizes.stdout.split('\n')) head += Number.parseInt(line, 10) || 0
  }
  return { historyBytes: history, headBytes: head, oldVersionsBytes: Math.max(0, history - head) }
}

export async function vaultStorage(root: string, opts?: { candidates?: readonly string[] }): Promise<VaultStorageStats> {
  const st = await stat(root)
  if (!st.isDirectory()) throw new Error(`not a directory: ${root}`)
  const [walked, gitStats] = await Promise.all([walk(root), gitNumbers(root, opts?.candidates)])
  const boards = walked.boards
  const withPictures = boards.filter((b) => b.embeddedBytes > 0)
  return {
    root,
    boards: { bytes: boards.reduce((n, b) => n + b.bytes, 0), count: boards.length },
    pictures: walked.pictures,
    other: walked.other,
    git: gitStats,
    // Ties broken by path so the list is stable across refreshes.
    large: [...walked.large].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)),
    embedded: { bytes: withPictures.reduce((n, b) => n + b.embeddedBytes, 0), boards: withPictures.length },
  }
}

/**
 * D8 — `vaultStorage` on a worker thread, so measuring never freezes the window: the walk
 * JSON.parses every board, and on the main thread that was ~1.3 s of a dead UI on a 230 MB vault.
 * Same function, so the same numbers. `workerFile` is the built `storageWorker.ts` (`?modulePath`
 * in `ipc/storage.ts`). One thread per measure: a measure is rare and a thread starts in ms.
 */
export function vaultStorageOffThread(workerFile: string, root: string): Promise<VaultStorageStats> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: root })
    worker.once('message', resolve)
    worker.once('error', reject)
    // After a message or an error this is a no-op; otherwise the thread died without answering.
    worker.once('exit', (code) => reject(new Error(`storage worker exited with code ${code} before answering`)))
  })
}
