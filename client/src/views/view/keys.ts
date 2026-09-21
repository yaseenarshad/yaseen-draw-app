/**
 * The ONE canonical spelling of a view property key, shared by every menu, view and typing
 * rung (GRO-2135). The Filter menu's rule ↔ expression model this file was carved out of in
 * YAZ-846 RETURNED in YAZ-1224 (the YAZ-1218 filter restoration) and lives beside it in
 * `view/filterRows.ts`; the Filter menu and its button come back in YAZ-1226-1229.
 */

/** `status` → `note.status`; `file.x` / `formula.x` / `note.x` unchanged. */
export function canonicalKey(key: string): string {
  return key.startsWith('file.') || key.startsWith('formula.') || key.startsWith('note.') ? key : `note.${key}`
}
