import { COMMENTS_KEY } from '@shared/comments'
import { SETTINGS_KEY } from '../views/folderPageSettings'
import { FOLDER_PAGE_KEY, FOLDER_PAGES_KEY } from './folderPages'

/**
 * The frontmatter keys the app OWNS, in two tiers (YAZ-1513/1549), spelled from the real constants
 * — never a local literal.
 *
 * `RESERVED_KEYS` is what the properties panel shows as "Reserved" with no editor: the folder-page
 * flag, its settings block and the comments store — keys whose VALUE is the app's, not the user's.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([FOLDER_PAGE_KEY, SETTINGS_KEY, COMMENTS_KEY])

/**
 * `APP_OWNED_KEYS` adds the belonging list: its value IS the user's to edit (the panel offers it),
 * but the app reads it to build the Topics tree, so it can be hidden in a view and never deleted as
 * a column. `deleteColumn.ts` refuses this tier.
 */
export const APP_OWNED_KEYS: ReadonlySet<string> = new Set([...RESERVED_KEYS, FOLDER_PAGES_KEY])
