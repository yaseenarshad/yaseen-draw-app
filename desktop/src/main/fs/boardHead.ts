import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { BOARD_META_HEAD_BYTES, parseBoardMetaBlock, type BoardMetaBlock } from '@shared/drawingAssets'

export interface BoardHead {
  /** The `yaseendraw` block off the file head, extras included, or null when there is none to trust (🔒 YAZ-1834 D7). */
  block: BoardMetaBlock | null
  mtime: number
  size: number
}

/**
 * One open, one bounded read, one `fstat`: what the tree walk and the save door both need to
 * know about a board without reading it (🔒 YAZ-1834 D3/D6). The block is ~80 bytes and main
 * always writes it first, so `BOARD_META_HEAD_BYTES` is plenty; a longer head is never read.
 * A missing file, or a path that is not a regular file, answers null; any other failure
 * propagates for the caller to classify.
 */
export async function readBoardHead(file: string): Promise<BoardHead | null> {
  let handle
  try {
    handle = await open(file, 'r')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  try {
    const st = await handle.stat()
    if (!st.isFile()) return null
    const buffer = Buffer.allocUnsafe(Math.min(st.size, BOARD_META_HEAD_BYTES))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return { block: parseBoardMetaBlock(buffer.subarray(0, bytesRead).toString('utf8')), mtime: st.mtimeMs, size: st.size }
  } finally {
    await handle.close()
  }
}
