import type { TreeNode } from '@shared/types'
import { formatBytes, formatDateTime } from '../lib/format'
import { relativeTime } from '../lib/relativeTime'

type FileNode = Extract<TreeNode, { type: 'file' }>

/**
 * The "Info" popover's body (🔒 YAZ-1835 D6/D7): the board as the tree already knows it — no fetch of
 * its own. It is rendered from the LIVE tree node, so a save in any window moves the dates while the
 * popover stands. A board with no block yet says so instead of inventing dates (🔒 YAZ-1834 D7).
 */
export function BoardInfo({ node, root, now }: { node: FileNode; root: string; now: number }) {
  const rel = node.path.startsWith(`${root}/`) ? node.path.slice(root.length + 1) : node.path
  const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '/'
  const when = (ms: number) => (
    <>
      {formatDateTime(ms)} <span className="board-info__ago">· {relativeTime(ms, now)}</span>
    </>
  )
  const unstamped = <span className="board-info__ago">Not stamped yet · written on the next save</span>
  return (
    <dl className="board-info" aria-label={`Info for ${node.name}`}>
      <dt>Name</dt>
      <dd className="board-info__name">{node.name}</dd>
      <dt>Folder</dt>
      <dd>{folder}</dd>
      <dt>Size</dt>
      <dd>{formatBytes(node.size)}</dd>
      <dt>Created</dt>
      <dd>{node.meta ? when(node.meta.createdAt) : unstamped}</dd>
      <dt>Updated</dt>
      <dd>{node.meta ? when(node.meta.updatedAt) : unstamped}</dd>
      <dt>On disk</dt>
      <dd>{when(node.mtime)}</dd>
    </dl>
  )
}
