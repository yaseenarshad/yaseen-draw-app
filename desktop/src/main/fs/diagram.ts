/**
 * THE DIAGRAM DOCUMENT'S TWO DOORS (🔒 YAZ-1802 D6) — `drawing.ts`'s twin for a `.drawio`.
 *
 * `diagram:load` and `diagram:save` are the ONLY way a `.drawio` opened AS A DOCUMENT reads and
 * writes. Simpler than a drawing's pair on purpose: a diagram's pictures live inside its own XML
 * (a data URI in a cell's style), so there is no `assets/` store to land first — a load is the
 * text and its mtime, a save is the text back.
 *
 * THE DOCUMENT IS VALIDATED HERE, not only in the iframe: an empty, corrupt, truncated or
 * not-draw.io `.drawio` comes back as one `IO_ERROR` naming the path and the reason
 * (`diagramDocumentError`), which the editor shows as a readable error pane — and because it
 * never mounts draw.io on it, it can never autosave over a file it failed to load. The check is
 * the OUTLINE only (a draw.io root, closed at the end); draw.io decides what the cells mean.
 *
 * THE SAVE is `drawing:save`'s rules exactly: the request is shape-checked like a body, the
 * `expectedMtime` guard refuses with `CONFLICT` and writes NOTHING, a file that is gone is not a
 * conflict, and the write is atomic (tmp + rename). The dates ride the same write (🔒 YAZ-1802 D7):
 * `createdAt` from the CURRENT file's head (or its pre-save mtime, the first time), `updatedAt`
 * now, stamped onto the root `<mxfile>` by `stampDiagramMeta` — draw.io drops attributes it does
 * not know, so the renderer never sends them back. A refused save stamps nothing.
 */
import path from 'node:path'
import type { DiagramLoadRequest, DiagramLoadResponse, DiagramSaveRequest, DiagramSaveResponse } from '@shared/types'
import { MAX_DIAGRAM_BYTES } from '@shared/types'
import { isDiagram } from '@shared/fileKind'
import { diagramDocumentError, stampDiagramMeta } from '@shared/diagramFile'
import { readBoardHead } from './boardHead'
import { readBoundedRegularFile } from './boundedRead'
import { atomicWrite, BridgeFailure, fsCall, requireAbsPath, requireDir } from './fsUtils'

const TOO_LARGE = `diagram exceeds ${MAX_DIAGRAM_BYTES} bytes`

/** A `.drawio` path — vault-relative or absolute — resolved INSIDE `dir`; any other kind is refused. */
export function resolveDiagram(dir: string, rel: unknown): string {
  if (typeof rel !== 'string' || rel.trim() === '' || rel.includes('\0')) throw new BridgeFailure('BAD_REQUEST', "missing 'path'")
  const file = path.resolve(dir, rel)
  if (!file.startsWith(dir + path.sep)) throw new BridgeFailure('BAD_REQUEST', 'path escapes the vault root', { path: rel })
  if (!isDiagram(file)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .drawio files open as diagrams', { path: file })
  return file
}

/** The request's `{ root, path }` pair, validated once for both doors. */
function target(raw: unknown): { dir: string; file: string; body: Record<string, unknown> } {
  if (typeof raw !== 'object' || raw === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
  const body = raw as Record<string, unknown>
  const dir = requireAbsPath(body.root, 'root')
  return { dir, file: resolveDiagram(dir, body.path), body }
}

export async function loadDiagram(req: DiagramLoadRequest): Promise<DiagramLoadResponse> {
  const { dir, file } = target(req)
  await requireDir(dir)
  const snapshot = await readBoundedRegularFile(file, MAX_DIAGRAM_BYTES, TOO_LARGE)
  const xml = snapshot.data.toString('utf8')
  const problem = diagramDocumentError(xml)
  if (problem !== null) throw new BridgeFailure('IO_ERROR', problem, { path: file })
  return { path: file, xml, mtime: snapshot.mtime, size: snapshot.size }
}

export async function saveDiagram(req: DiagramSaveRequest): Promise<DiagramSaveResponse> {
  const { dir, file, body } = target(req)
  const { xml, expectedMtime } = body
  if (typeof xml !== 'string') throw new BridgeFailure('BAD_REQUEST', "'xml' must be a string", { path: file })
  if (expectedMtime !== undefined && typeof expectedMtime !== 'number') throw new BridgeFailure('BAD_REQUEST', "'expectedMtime' must be a number", { path: file })
  // Every check before any write: a diagram the editor could not have produced is refused whole.
  const problem = diagramDocumentError(xml)
  if (problem !== null) throw new BridgeFailure('BAD_REQUEST', `'xml' is not a draw.io diagram: ${problem}`, { path: file })
  await requireDir(dir)
  // The file as it is now: its dates and mtime in one open, serving both the guard and the stamp.
  const prior = await fsCall(file, () => readBoardHead(file))
  const now = Date.now()
  const priorMeta = prior?.block ? { createdAt: prior.block.createdAt, updatedAt: prior.block.updatedAt } : null
  const stamped = stampDiagramMeta(xml, { createdAt: prior?.mtime ?? now, updatedAt: now }, priorMeta)
  if (Buffer.byteLength(stamped, 'utf8') > MAX_DIAGRAM_BYTES) throw new BridgeFailure('TOO_LARGE', TOO_LARGE, { path: file })
  if (expectedMtime !== undefined && prior !== null && prior.mtime !== expectedMtime) {
    // A file that is GONE is not a conflict (the `drawing:save` rule): the tab's copy is the only one left.
    throw new BridgeFailure('CONFLICT', 'diagram changed on disk since last read', { path: file, mtime: prior.mtime })
  }
  const { mtime, size } = await fsCall(file, () => atomicWrite(file, stamped))
  return { path: file, mtime, size }
}
