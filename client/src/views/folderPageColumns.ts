/**
 * Reconcile a folder page's declarations onto its existing DIRECT members (YAZ-999). The index is
 * only a cheap presence filter; `writePropertyIfMissing` checks the latest file bytes again, so a
 * stale snapshot or concurrent user edit can never be overwritten.
 */
import type { IndexRecord } from '@shared/types'
import type { ColumnDecl } from './folderPageSettings'
import { emptyColumnValue } from './scaffold'
import { writePropertyIfMissing } from './writeProperty'

interface MissingColumn {
  member: IndexRecord
  key: string
  column: ColumnDecl
}

export async function backfillFolderPageColumns(
  members: readonly IndexRecord[],
  columns: Readonly<Record<string, ColumnDecl>>,
): Promise<void> {
  const missing: MissingColumn[] = members.flatMap((member) =>
    Object.entries(columns)
      .filter(([key]) => !Object.prototype.hasOwnProperty.call(member.properties, key))
      .map(([key, column]) => ({ member, key, column })),
  )
  if (missing.length === 0) return

  const results = await Promise.allSettled(
    missing.map(({ member, key, column }) => writePropertyIfMissing(member.path, key, emptyColumnValue(column))),
  )
  const failed = results.flatMap((result, index) => (result.status === 'rejected' ? [missing[index]!] : []))
  if (failed.length === 0) return

  throw new Error(
    `Could not initialize ${failed.length} column ${failed.length === 1 ? 'value' : 'values'}: ${failed
      .map(({ member, key }) => `${member.basename}.${key}`)
      .join('; ')}`,
  )
}
