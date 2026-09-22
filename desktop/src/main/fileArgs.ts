/**
 * What a launch was asked to OPEN (YAZ-1815, YAZ-1815).
 *
 * The app claims `.excalidraw` as an Owner file association (🔒 YAZ-1775 D1), and the OS
 * delivers a double-clicked file differently on each platform:
 *
 * - **macOS** fires `open-file` with the path — before `ready` on a cold start. `main/index.ts`
 *   encodes it as a `yaseendraw://` link and pushes it onto the link queue, so it travels the one
 *   routing path every deep link takes.
 * - **Windows / Linux** put the path in the process ARGV instead: in `process.argv` for the launch
 *   that starts the app, and in the `second-instance` argv when the app is already running. There
 *   is no event; this is the only place those paths exist.
 *
 * So argv gets read on both occasions and turned into the same queue pushes. The filter below is
 * deliberately narrow: an argument counts only when it is not a switch and names a file of a kind
 * this app owns. Everything else — the executable, the `.` that `electron-vite dev` passes, every
 * `--flag`, a `yaseendraw://` URL (the caller handles those itself) — is not a file to open.
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
