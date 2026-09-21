export const WORKSPACE_PAGE_MIME = 'application/x-yaseen-workspace-page'

export interface PageDrag {
  path: string
  owner: 'main' | 'right'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function writePageDrag(data: DataTransfer, value: PageDrag): void {
  data.setData(WORKSPACE_PAGE_MIME, JSON.stringify(value))
  data.effectAllowed = 'move'
}

export function readPageDrag(data: DataTransfer): PageDrag | null {
  if (![...data.types].includes(WORKSPACE_PAGE_MIME)) return null
  try {
    const value: unknown = JSON.parse(data.getData(WORKSPACE_PAGE_MIME))
    if (
      !isRecord(value)
      || typeof value.path !== 'string'
      || !value.path.startsWith('/')
      || (value.owner !== 'main' && value.owner !== 'right')
    ) return null
    return { path: value.path, owner: value.owner }
  } catch {
    return null
  }
}
