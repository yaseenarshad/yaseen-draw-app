/** Effective number of leading visible columns frozen for a Table view. */
export function frozenColumnCount(value: unknown, visibleColumns: number): number {
  const visible = Math.max(0, Math.trunc(visibleColumns))
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(visible, Math.max(0, Math.trunc(value)))
}
