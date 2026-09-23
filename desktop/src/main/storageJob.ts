import { Worker } from 'node:worker_threads'
import type { ShrinkResult, VaultStorageStats } from '@shared/types'
import { shrinkVault } from './fs/shrink'
import { vaultStorage } from './git/storage'

/**
 * Settings › Storage's two heavy jobs, run OFF the main thread (YAZ-1801 D8, 🔒 D11): measuring
 * (`git/storage.ts`) JSON.parses every board, and "Move pictures out" (`fs/shrink.ts`) parses and
 * rewrites them — on the main thread that was ~1.3 s and ~4 s of a frozen window. ONE worker file
 * (`storageWorker.ts`) serves both, told which by a tagged job, and ONE helper spawns it.
 *
 * Same functions, so the same answers. One short-lived thread per job: a job is rare and a thread
 * starts in ms. Shrink's own mtime re-check before each write (D5) still guards against a save
 * landing while the worker is between its read and its write.
 */

export type StorageJob = { kind: 'stats'; root: string } | { kind: 'shrink'; root: string; skip: readonly string[] }

interface Answers {
  stats: VaultStorageStats
  shrink: ShrinkResult
}

/** The job, in whichever thread calls it — the worker's whole body. */
export function runStorageJob(job: StorageJob): Promise<VaultStorageStats | ShrinkResult> {
  return job.kind === 'stats' ? vaultStorage(job.root) : shrinkVault(job.root, { skip: job.skip })
}

/** `job` on a fresh worker. `workerFile` is the built `storageWorker.ts` (`?modulePath` in `ipc/storage.ts`). */
export function runOffThread<J extends StorageJob>(workerFile: string, job: J): Promise<Answers[J['kind']]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: job })
    worker.once('message', resolve)
    worker.once('error', reject)
    // After a message or an error this is a no-op; otherwise the thread died without answering.
    worker.once('exit', (code) => reject(new Error(`storage worker exited with code ${code} before answering`)))
  })
}
