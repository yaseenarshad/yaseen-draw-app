import { fileKind } from '@shared/fileKind'

/**
 * The document pane: one dispatcher on the active file's kind and nothing else. Every kind's
 * surface mounts from here — today none do, because 2B removed the old document layer and 2D
 * brings the drawing canvas in its place.
 */
export function Editor({ path }: { path: string | null }) {
  if (path === null) {
    return (
      <section className="editor">
        <p className="editor-msg">Select a file from the sidebar.</p>
      </section>
    )
  }
  if (fileKind(path) === null) {
    return (
      <section className="editor">
        <p className="editor-msg editor-msg--error">Unsupported file type.</p>
      </section>
    )
  }
  return <section className="editor" />
}
