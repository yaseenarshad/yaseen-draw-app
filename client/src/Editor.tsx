import type { CanvasPanelState, CanvasPrefs, GithubSyncStatus } from '@shared/types'
import { fileKind } from '@shared/fileKind'
import { DrawingEditor } from './drawings/DrawingEditor'
import { DrawioEditor } from './diagrams/DrawioEditor'
import type { WatchSource } from './hooks/useWatch'
import type { NoticeKind } from './lib/notice'

/**
 * The document pane: one dispatcher on the active file's KIND and nothing else. Every kind's
 * surface mounts from here: `'drawing'` → `DrawingEditor` (🔒 YAZ-1810), `'diagram'` →
 * `DrawioEditor` (🔒 YAZ-1802 D2). `fileKind` is the app's one classifier, and a file of no kind
 * has to land somewhere honest rather than in a blank pane.
 *
 * Everything below is App's, handed through: the vault root (a drawing is read relative to it),
 * the window's single watcher subscription, the vault's sync status — one per window, so the chip
 * on every mounted tab tells the same story — and the user-level canvas preferences plus the
 * canvas panel's memory (🔒 YAZ-1775 D9 / 🔒 YAZ-1775 D10), which live in `SettingsState` and reach every mounted
 * canvas from the one place that owns them.
 */
export interface EditorProps {
  path: string | null
  root: string | null
  watch: WatchSource
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
  /** 🔒 YAZ-1775 D9: `SettingsState.canvas`, and the way back when the engine or the rail moves one. */
  canvasPrefs?: CanvasPrefs
  onCanvasPrefsChange?: (next: CanvasPrefs) => void
  /** 🔒 YAZ-1775 D10: `SettingsState.canvasPanel` — the panel's last-used tab and its dock preference. */
  canvasPanel?: CanvasPanelState
  onCanvasPanelChange?: (next: CanvasPanelState) => void
  /** The window's ONE passive notice: how an export says where it landed, or why it did not. */
  onNotice?: (text: string, icon?: NoticeKind) => void
  /** App's ⌘B, for a diagram: the key never leaves draw.io's iframe, so the diagram passes it up. */
  onToggleSidebar?: () => void
}

export function Editor({ path, root, watch, sync, onSyncNow, canvasPrefs, onCanvasPrefsChange, canvasPanel, onCanvasPanelChange, onNotice, onToggleSidebar }: EditorProps) {
  if (path === null || root === null) {
    return (
      <section className="editor">
        <p className="editor-msg">Select a file from the sidebar.</p>
      </section>
    )
  }
  const kind = fileKind(path)
  if (kind === 'diagram') return <DrawioEditor root={root} path={path} watch={watch} sync={sync} onSyncNow={onSyncNow} onToggleSidebar={onToggleSidebar} />
  if (kind !== 'drawing') {
    return (
      <section className="editor">
        <p className="editor-msg editor-msg--error">Unsupported file type.</p>
      </section>
    )
  }
  return (
    <DrawingEditor
      root={root}
      path={path}
      watch={watch}
      sync={sync}
      onSyncNow={onSyncNow}
      canvasPrefs={canvasPrefs}
      onCanvasPrefsChange={onCanvasPrefsChange}
      canvasPanel={canvasPanel}
      onCanvasPanelChange={onCanvasPanelChange}
      onNotice={onNotice}
    />
  )
}
