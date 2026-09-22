/**
 * What a launch was asked to OPEN (YAZ-1815). macOS fires `open-file` with the path, but Windows
 * and Linux put it in ARGV instead — `process.argv` on a cold start, the `second-instance` argv
 * when the app is already running — and there is no event, so this is the only place those paths
 * exist. `main/index.ts` turns each one into a `yaseendraw://` link, so a double-click travels the
 * routing path every deep link takes.
 */
import { isSupportedFile } from '@shared/fileKind'

/**
 * The openable file paths in `argv`, in order. `skip` is how many leading entries belong to the
 * launcher rather than the user: 1 for a packaged app (`argv[0]` is the executable), and
 * `main/index.ts` passes `app.isPackaged ? 1 : 2` because in dev `argv[1]` is the app directory.
 */
export function openableFileArgs(argv: readonly string[], skip = 1): string[] {
  return argv.slice(skip).filter((arg) => arg !== '' && !arg.startsWith('-') && !arg.includes('://') && isSupportedFile(arg))
}
