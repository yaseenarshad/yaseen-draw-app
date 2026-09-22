/**
 * EXPORT DRAWING… (🔒 D3, YAZ-1821): the board as a STANDALONE `.excalidraw` — every image it uses
 * embedded in the file — so it opens in upstream Excalidraw, on excalidraw.com, or on anyone
 * else's machine with its pictures intact.
 *
 * 🔒 D3 SAYS THE VAULT FILE NEVER EMBEDS, AND THAT EXPORT IS THE ONE PLACE THAT DOES. A board in a
 * vault is a lean scene (`files: {}`) beside a shared `<vault>/assets/` folder, because embedding
 * base64 makes multi-MB files that git rewrites on every save. A file being sent to someone else
 * has no `assets/` folder to point at, so the bytes have to travel with it. This module is that
 * one exception, and it is a SEPARATE document: `drawing:save` is untouched and the vault file is
 * not read, written or renamed by an export.
 *
 * THE FILES MAP IS THE WHOLE CANVAS'S. Everything 2E hydrated out of `assets/` at load, plus
 * anything pasted, imported or inserted since and not yet saved — the engine's live map is the
 * only place all of it is in one piece, which is why the assembly takes it rather than re-reading
 * the store.
 *
 * DELETED ELEMENTS' FILES ARE NOT SENT. An undo can leave an image's bytes in the engine's map long
 * after the element is gone; shipping them would put a picture the user deleted inside a file they
 * are about to hand to someone. `referencedFileIds` is the same rule 2E's save path uses, so the
 * two never disagree. The engine's own `serializeAsJSON(…, 'local')` filters again
 * (`filterOutDeletedFiles`) — belt and braces, and idempotent, which is the only kind of
 * redundancy worth having.
 *
 * ENGINE-BOUND BY DESIGN: `serializeAsJSON` comes in as an argument (`engine.ts`'s lazy rule), so
 * this tests with a stub and names the package nowhere.
 */
import { referencedFileIds } from '@shared/drawingAssets'
import { stripExt } from '../lib/paths'
import type { ExcalidrawModule } from './engine'

/** The engine value an export needs — the library's OWN writer, the same one a save uses. */
export type ExportEngine = Pick<ExcalidrawModule, 'serializeAsJSON'>

/** What the canvas holds right now: its elements, its appState, and its live image map. */
export interface ExportableScene {
  elements: readonly unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

/** The files a standalone copy has to carry: exactly the ones a LIVE image element names. */
export function embeddedFiles(elements: readonly unknown[], files: Record<string, unknown>): Record<string, unknown> {
  const referenced = referencedFileIds(elements)
  const embedded: Record<string, unknown> = {}
  for (const id of referenced) {
    const entry = files[id]
    // A missing byte is not an error: the board already draws the engine's placeholder for it
    // (🔒 D3), and an export that refused because of one would be worse than one that is honest.
    if (entry !== undefined) embedded[id] = entry
  }
  return embedded
}

/**
 * The bytes of the standalone file. `serializeAsJSON(…, 'local')` is the library's own writer — the
 * same one "Save to disk" uses and the same one the vault save uses — so element cleanup and the
 * appState whitelist are its rules, not ours. Two things are ours: the files map above, and a
 * trailing newline, so an exported file and a saved one differ only in what they carry.
 */
export function assembleStandaloneScene(engine: ExportEngine, scene: ExportableScene): string {
  return `${engine.serializeAsJSON(scene.elements as never, scene.appState as never, embeddedFiles(scene.elements, scene.files) as never, 'local')}\n`
}

/** The save dialog's default name: the board's own name, with the extension it is getting back. */
export function exportFileName(boardName: string): string {
  const name = stripExt(boardName).trim()
  return `${name === '' ? 'Drawing' : name}.excalidraw`
}
