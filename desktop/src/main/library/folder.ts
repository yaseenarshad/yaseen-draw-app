/**
 * THE LIBRARY FOLDER (🔒 D5): the one folder every vault shares, where Yaseen Draw's media
 * favorites and saved components will live.
 *
 * `SettingsState.libraryFolder` is the user's absolute path, or null for `<userData>/library`.
 * Only the main process knows where userData is, so only main can resolve it — which is why the
 * Settings row asks through `drawing:library-folder` rather than working it out itself. Main also
 * makes the folder at startup, so the row's hint always names a directory that exists.
 *
 * Electron-free on purpose (userData comes in as an argument), so this unit-tests against a temp
 * dir. The CONTENTS are the siblings' business: `mediaStore.ts` owns `<library>/media.json` (3A),
 * `<library>/components/` is 3C's.
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
