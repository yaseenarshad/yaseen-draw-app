import { parentPort, workerData } from 'node:worker_threads'
import { shrinkVault } from './fs/shrink'
import { vaultStorage } from './git/storage'
import type { StorageJob } from './storageJob'

// The thread `runOffThread` starts (YAZ-1801 D8, 🔒 D11): one job, one message, then it exits.
// A rejection surfaces as the Worker's `error` event.
const job = workerData as StorageJob
void (job.kind === 'stats' ? vaultStorage(job.root) : shrinkVault(job.root, { skip: job.skip })).then((answer) => parentPort!.postMessage(answer))
