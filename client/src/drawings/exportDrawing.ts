/**
 * EXPORT DRAWING… (🔒 YAZ-1775 D3, YAZ-1821): the board as a STANDALONE `.excalidraw` — every image it uses
 * embedded in the file — so it opens in upstream Excalidraw, on excalidraw.com, or on anyone
 * else's machine with its pictures intact.
 *
 * 🔒 YAZ-1775 D3 SAYS THE VAULT FILE NEVER EMBEDS, AND THAT EXPORT IS THE ONE PLACE THAT DOES: a
 * file being sent to someone else has no `assets/` folder to point at. It is a SEPARATE document —
 * `drawing:save` is untouched and the vault file is not read, written or renamed by an export.
 *
 * THE FILES MAP IS THE WHOLE CANVAS'S (everything hydrated out of `assets/` at load, plus anything
 * pasted or inserted since), because the engine's live map is the only place all of it is in one
 * piece. DELETED ELEMENTS' FILES ARE NOT SENT: an undo can leave an image's bytes in that map long
 * after the element is gone, and shipping them would put a picture the user deleted inside a file
 * they are about to hand to someone. `referencedFileIds` is the same rule the save path uses.
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
    // (🔒 YAZ-1775 D3), and an export that refused because of one would be worse than one that is honest.
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
