/**
 * THE LIBRARY FOLDER (🔒 YAZ-1775 D5): the one folder every vault shares, holding `media.json`
 * (`mediaStore.ts`) and `components/` (`componentStore.ts`).
 *
 * Only the main process knows where userData is, so only main can resolve
 * `SettingsState.libraryFolder` — which is why the Settings row asks through
 * `drawing:library-folder`. Electron-free on purpose (userData comes in as an argument).
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** The folder's name under userData when the setting is null. */
export const DEFAULT_LIBRARY_DIR = 'library'

export function resolveLibraryFolder(setting: string | null, userData: string): string {
  return setting ?? join(userData, DEFAULT_LIBRARY_DIR)
}

/**
 * Resolve and `mkdir -p`. A folder that cannot be made is still the ANSWER rather than a throw:
 * the Settings row's job is to say where the library should be, and a launch must not fail
 * because a path the user picked has since gone read-only or been unplugged.
 */
export async function ensureLibraryFolder(setting: string | null, userData: string): Promise<string> {
  const folder = resolveLibraryFolder(setting, userData)
  await mkdir(folder, { recursive: true }).catch((err: unknown) => console.warn('[library] could not create', folder, err))
  return folder
}
