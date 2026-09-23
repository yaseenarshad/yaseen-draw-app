import type { GithubSyncMerge } from '@shared/types'
import { basename, stripExt } from '../lib/paths'

/**
 * What a window says after a sync pass merged (🔒 YAZ-1897 D4): one line, never a dialog. Boards
 * merged shape by shape are named with who made the other side; "N shapes edited on both — kept
 * the newest" is said only when it happened; a file that kept both copies says where ours went.
 * The notice's "See changes" opens Version history on `firstBoard`.
 */
export interface MergeNotice {
  text: string
  /** The first board merged shape by shape — what "See changes" opens. Null when nothing was. */
  firstBoard: string | null
}

const quoted = (rel: string) => `“${stripExt(basename(rel))}”`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function mergeNotice(merged: readonly GithubSyncMerge[]): MergeNotice {
  const boards = merged.filter((m) => m.copy === undefined)
  const copies = merged.filter((m) => m.copy !== undefined)
  const parts: string[] = []
  if (boards.length > 0) {
    const authors = [...new Set(boards.map((m) => m.author))]
    const who = authors.length === 1 ? `${authors[0]}'s` : "the other computer's"
    const clashes = boards.reduce((n, m) => n + m.clashes, 0)
    parts.push(`Merged ${who} changes into ${boards.length === 1 ? quoted(boards[0].path) : plural(boards.length, 'board')}${clashes > 0 ? ` · ${plural(clashes, 'shape')} edited on both — kept the newest` : ''}.`)
  }
  for (const m of copies) parts.push(`${quoted(m.path)} changed on both computers — your copy is saved as ${quoted(m.copy ?? '')}.`)
  return { text: parts.join(' '), firstBoard: boards[0]?.path ?? null }
}
