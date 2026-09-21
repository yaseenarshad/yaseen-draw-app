import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { BridgeFailure, fsCall } from './fsUtils'

interface FileSnapshot {
  size: number
  mtimeMs: number
  isFile(): boolean
}

/** The narrow FileHandle surface used by the bounded reader and its deterministic tests. */
export interface ReadableFileHandle {
  stat(): Promise<FileSnapshot>
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
}

export interface BoundedFileResponse {
  /** A zero-copy view of the single bounded allocation. */
  data: Buffer
  mtime: number
  size: number
}

/**
 * Read one stable regular-file snapshot without allocating or reading beyond `maxBytes + 1`.
 * The extra byte detects growth past the cap; matching pre/post metadata keeps returned bytes
 * and metadata from describing different file versions.
 */
export async function readBoundedHandle(
  handle: ReadableFileHandle,
  path: string,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<BoundedFileResponse> {
  const before = await handle.stat()
  if (!before.isFile()) throw new BridgeFailure('NOT_A_FILE', 'expected a file', { path })
  if (before.size > maxBytes) throw new BridgeFailure('TOO_LARGE', tooLargeMessage, { path })

  const capacity = Math.min(before.size + 1, maxBytes + 1)
  const buffer = Buffer.allocUnsafe(capacity)
  let bytesRead = 0
  while (bytesRead < capacity) {
    const chunk = await handle.read(buffer, bytesRead, capacity - bytesRead, bytesRead)
    if (chunk.bytesRead === 0) break
    bytesRead += chunk.bytesRead
  }

  const after = await handle.stat()
  if (bytesRead > maxBytes) throw new BridgeFailure('TOO_LARGE', tooLargeMessage, { path })
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytesRead !== before.size) {
    throw new BridgeFailure('IO_ERROR', 'file changed while being read; try again', { path })
  }

  return { data: buffer.subarray(0, bytesRead), mtime: after.mtimeMs, size: after.size }
}

/** Open, snapshot-read, and always close one absolute path through the bounded reader. */
export async function readBoundedRegularFile(path: string, maxBytes: number, tooLargeMessage: string): Promise<BoundedFileResponse> {
  return fsCall(path, async () => {
    const handle = await open(path, 'r')
    try {
      return await readBoundedHandle(handle, path, maxBytes, tooLargeMessage)
    } finally {
      await handle.close()
    }
  })
}
