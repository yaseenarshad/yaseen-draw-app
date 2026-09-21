import path from 'node:path'
import { fileKind } from '@shared/fileKind'
import { IMAGE_VIEW_MIME, MAX_IMAGE_BYTES, type ImageResponse } from '@shared/types'
import { readBoundedRegularFile } from './boundedRead'
import { BridgeFailure, requireAbsPath } from './fsUtils'

/** Exact-path, bounded binary boundary used only by the static raster-image viewer. */
export async function readImage(filePath: string): Promise<ImageResponse> {
  const file = requireAbsPath(filePath, 'path')
  if (fileKind(file) !== 'image') {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only supported raster images can be read as images', { path: file })
  }

  const extension = path.extname(file).toLowerCase() as keyof typeof IMAGE_VIEW_MIME
  const snapshot = await readBoundedRegularFile(file, MAX_IMAGE_BYTES, `image exceeds ${MAX_IMAGE_BYTES} bytes`)
  return { path: file, data: snapshot.data, mime: IMAGE_VIEW_MIME[extension], mtime: snapshot.mtime, size: snapshot.size }
}
