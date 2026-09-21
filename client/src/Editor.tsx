import type { GithubSyncStatus } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import { DrawingEditor } from './drawings/DrawingEditor'
import type { WatchSource } from './hooks/useWatch'

/**
 * The document pane: one dispatcher on the active file's KIND and nothing else. Every kind's
 * surface mounts from here, and today there is exactly one — `'drawing'` (🔒 YAZ-1810). The
 * dispatcher stays even so: `fileKind` is the app's one classifier, and a file of no kind has to
 * land somewhere honest rather than in a blank pane.
 *
 * Everything below is App's, handed through: the vault root (a drawing is read relative to it),
 * the window's single watcher subscription, and the vault's sync status — one per window, so the
 * chip on every mounted tab tells the same story.
 */
export interface EditorProps {
  path: string | null
  root: string | null
  watch: WatchSource
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
}

export function Editor({ path, root, watch, sync, onSyncNow }: EditorProps) {
  if (path === null || root === null) {
    return (
      <section className="editor">
        <p className="editor-msg">Select a file from the sidebar.</p>
      </section>
    )
  }
  if (fileKind(path) !== 'drawing') {
    return (
      <section className="editor">
        <p className="editor-msg editor-msg--error">Unsupported file type.</p>
      </section>
    )
  }
  return <DrawingEditor root={root} path={path} watch={watch} sync={sync} onSyncNow={onSyncNow} />
}
