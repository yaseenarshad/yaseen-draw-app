import { parentPort, workerData } from 'node:worker_threads'
import { vaultStorage } from './storage'

// The thread `vaultStorageOffThread` starts (YAZ-1801 D8): one measure, one message, then it exits.
// A rejection surfaces as the Worker's `error` event.
void vaultStorage(workerData as string).then((stats) => parentPort?.postMessage(stats))
