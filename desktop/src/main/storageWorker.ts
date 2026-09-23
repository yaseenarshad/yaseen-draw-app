import { parentPort, workerData } from 'node:worker_threads'
import { runStorageJob, type StorageJob } from './storageJob'

// The thread `runOffThread` starts (YAZ-1801 D8, 🔒 D11): one job, one message, then it exits.
// A rejection surfaces as the Worker's `error` event.
void runStorageJob(workerData as StorageJob).then((answer) => parentPort?.postMessage(answer))
