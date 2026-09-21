import { MAX_PDF_BYTES, type PdfResponse } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import { BridgeFailure, requireAbsPath } from './fsUtils'
import { readBoundedRegularFile } from './boundedRead'

/** Read-only binary boundary used only by Chromium's native PDF viewer. */
export async function readPdf(path: string): Promise<PdfResponse> {
  const p = requireAbsPath(path, 'path')
  if (fileKind(p) !== 'pdf') {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only PDF files can be read as PDF', { path: p })
  }

  const snapshot = await readBoundedRegularFile(p, MAX_PDF_BYTES, `PDF exceeds ${MAX_PDF_BYTES} bytes`)
  return { path: p, data: snapshot.data, mtime: snapshot.mtime, size: snapshot.size }
}
