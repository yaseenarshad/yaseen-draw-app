/**
 * THE PAGE TITLE (⚡ YAZ-888) — block ZERO of the note's own scroller, above `.editor-mount`.
 *
 * 🔒 The title IS the file name (`stripExt(basename(path))`), never a frontmatter `title`: the
 * whole link system resolves pages by NAME, and aliases already cover alternate display names.
 * So this is React-side chrome and never a ProseMirror node — the note's markdown round-trips
 * byte-identically past it, and an in-document `# Heading` is a block of the note like any other
 * (syncing the two is deliberately out of scope).
 *
 * Editing copies `RenameInline`'s patterns, because a title edit IS a rename: click swaps the
 * heading for an input prefilled with the current name, and LEAVING the field commits
 * (YAZ-1553) — click-away, Enter, ArrowDown and Cmd-Tab all go through the one `onBlur` door;
 * Escape is the only discard. ArrowDown then hands focus to the editor below. The commit builds
 * the new path with the sidebar's own `renamedPath` and hands it to App's ONE rename door, which
 * asks first (the name changed) and routes every failure to the passive notice — so nothing
 * here duplicates that.
 *
 * 🔒 THE HOME GUARD: the page that answers `[[Home]]` renders a PLAIN, non-editable title.
 * `[[Home]]` is the vault's hard-coded front door (`ensureHome.ts`) — renaming the page it
 * resolves to would just spawn a fresh empty Home beside it — so the click explains itself
 * through the app's standing passive notice, never a dialog. Repointing Home is future work.
 */
import { useRef, useState } from 'react'
import { pageName } from '../sidebar/ConfirmRename'
import { renamedPath, validateEntryName } from '../sidebar/createEntry'

/** What a click on Home's title says (⚡ YAZ-888) — passive notice copy, never a dialog. */
export const HOME_TITLE_NOTICE = 'Home anchors this vault — it keeps its name.'

interface PageTitleProps {
  /** The open note; its file name minus the extension IS the title. */
  path: string
  /** Does this page answer `[[Home]]`? Resolved by the caller through the window's own resolver. */
  isHome: boolean
  /** Commit: the renamed absolute path, straight to App's rename door (which confirms). */
  onRename: (newPath: string) => void
  /** The app's passive notice — the Home guard's explanation and any name the sidebar's rules reject. */
  onNotice?: (message: string) => void
  /** ArrowDown out of the title: focus the editor below it. */
  onArrowDown?: () => void
}

export function PageTitle({ path, isHome, onRename, onNotice, onArrowDown }: PageTitleProps) {
  const name = pageName(path)
  const [editing, setEditing] = useState(false)
  // ONE door (YAZ-1553): leaving the field is the commit, so `onBlur` is `leave`'s only caller.
  // `settled` flips the moment the edit is over — Chromium fires one last blur when a focused
  // field is removed, and that blur must do nothing. Same three verbs as `RenameInline`.
  const settled = useRef(false)
  const open = (): void => {
    settled.current = false
    setEditing(true)
  }
  const discard = (): void => {
    settled.current = true
    setEditing(false)
  }

  /** The one door: the name the user left behind, whichever way they left. */
  const leave = (value: string): void => {
    if (settled.current) return
    settled.current = true
    setEditing(false)
    const next = value.trim()
    // An empty/whitespace name never commits, and the same name is not a rename at all.
    if (next === '' || next === name) return
    const invalid = validateEntryName(next)
    if (invalid !== null) {
      onNotice?.(invalid)
      return
    }
    onRename(renamedPath(path, next, 'file'))
  }

  if (editing) {
    return (
      <div className="page-title">
        {/* A textarea, not an input (YAZ-918): a long name WRAPS at the title's own size while
            edited — `field-sizing: content` grows it to the text; a file name has no newlines,
            so Enter stays commit. */}
        <textarea
          autoFocus
          rows={1}
          className="page-title__input"
          defaultValue={name}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            // Enter and ArrowDown only take focus away; onBlur is the one commit door.
            // preventDefault on Enter stays load-bearing: the sheet focuses CANCEL on mount,
            // and Enter's own default activation would land on it and cancel the rename.
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              discard()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              e.currentTarget.blur()
              onArrowDown?.()
            }
          }}
          onBlur={(e) => leave(e.currentTarget.value)}
        />
      </div>
    )
  }

  return (
    <div className="page-title">
      {/* Keyboard path too (⚡ YAZ-891 polish): the heading is focusable and Enter opens the
          input, so a rename never REQUIRES the mouse. Home stays out of the tab order — an
          inert stop would only be a speed bump on the way into the note. */}
      <h1
        className={`page-title__text${isHome ? ' page-title__text--home' : ''}`}
        tabIndex={isHome ? undefined : 0}
        onClick={() => (isHome ? onNotice?.(HOME_TITLE_NOTICE) : open())}
        onKeyDown={(e) => {
          if (isHome || e.key !== 'Enter') return
          e.preventDefault()
          open()
        }}
      >
        {name}
      </h1>
    </div>
  )
}
