/** Every failure the bridge can answer with, and the one size ceiling a caller can hit. */

export type BridgeErrorCode =
  | 'BAD_REQUEST' // missing/invalid argument
  | 'NOT_ABSOLUTE' // path is not absolute
  | 'NOT_FOUND' // path does not exist
  | 'NOT_A_DIRECTORY' // expected a directory
  | 'NOT_A_FILE' // expected a regular file
  | 'UNSUPPORTED_EXTENSION' // file extension is not supported by the requested capability
  | 'ALREADY_EXISTS' // create target already exists
  | 'FORBIDDEN' // OS permission denied
  | 'TOO_LARGE' // a drawing exceeds MAX_DRAWING_BYTES, or a media import exceeds MAX_IMPORT_BYTES (🔒 YAZ-1775 D4)
  | 'IO_ERROR' // any other fs error
  | 'PICKER_FAILED' // native folder dialog could not be run
  | 'INVALID_CONFIG' // a vault config file (e.g. .yaseendraw/github.json) is unusable; the mutation is refused, the file never touched
  | 'UNSUPPORTED_TYPE' // 🔒 YAZ-1775 D4: a media provider answered with something that is not an image (the worker's 415)
  | 'PROVIDER_FAILED' // 🔒 YAZ-1775 D4: a media provider was REACHED and refused, or answered nonsense (the worker's 502)
  | 'NOT_SET_UP' // YAZ-1799: sharing is not set up yet (Settings › Sharing)
  | 'OFFLINE' // 🔒 YAZ-1775 D4: the provider could not be reached at all — a passive state in the UI, never an error banner

/** The one document extension the app opens, edits and creates (🔒 YAZ-1775 D1). */
export const DRAWING_VIEW_EXTENSIONS = ['.excalidraw'] as const

/** The file kinds the app can open in-app. A file of no kind still lists (YAZ-1577). */
export type FileKind = 'drawing'
/**
 * The ceiling on ONE drawing document read through `drawing:load` (🔒 YAZ-1810). A LEGACY
 * `.excalidraw` (an upstream export, or one this app wrote before 🔒 YAZ-1775 D3) embeds its images as
 * base64 and is routinely past 10 MiB before it has been opened once. 200 MiB is the size at
 * which a scene has stopped being a document; the store (🔒 YAZ-1775 D3) keeps every saved file far below it.
 */
export const MAX_DRAWING_BYTES = 200 * 1024 * 1024
