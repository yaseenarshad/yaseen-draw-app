import type { PropertyDecl } from './types'

/**
 * The column every folder page is BORN with (YAZ-1513): a Select whose options are in the order
 * the board shows them. Lives in `shared/` (YAZ-1549) so the one-shot seed script under `tools/`
 * reads the SAME declaration the app births — `client/src/views/folderPageSettings.ts` re-exports
 * it for the renderer, and `tools/seedDefaultColumns.mjs` loads it through the shared TS loader.
 */
export const DEFAULT_COLUMNS: Readonly<Record<string, PropertyDecl>> = {
  status: { kind: 'select', options: ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'] },
}
