/**
 * The drawing document's IPC (🔒 YAZ-1810): `fs/drawing.ts` behind the standard envelope, and
 * nothing else.
 *
 * NO STORE REPAIR AND NO BROADCAST, exactly like `fs:write-asset` and for the same reason: those
 * exist for paths that MOVE or GO, and a save does neither — it changes bytes at a path every
 * window already knows. A window with the same document open learns of the change from the
 * shared watcher, like any edit made outside the app, and decides for itself (reload when clean,
 * the conflict bar when dirty). One writer telling the others what to think would be a second,
 * competing truth about a file the disk already answers for.
 */
import { CH } from '../../channels'
import { loadDrawing, saveDrawing } from '../fs/drawing'
import { handle } from './envelope'

export function registerDrawingIpc(): void {
  handle(CH.drawingLoad, loadDrawing)
  handle(CH.drawingSave, saveDrawing)
}
