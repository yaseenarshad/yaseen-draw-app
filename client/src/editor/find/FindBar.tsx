/**
 * THE FIND BAR (YAZ-969): the React surface of the CMD+F engine (`findInPage.ts`), talking to it
 * through the ONE `FindChannel` the host also hands `createCrepe`. The bar keeps no search state of
 * its own — it renders the channel's snapshot (`useSyncExternalStore`) and calls the channel's
 * commands; while the channel is closed there is no bar at all.
 *
 * 🔒 THE CLAIM RULE (locked in YAZ-967, visibility amendment in YAZ-970) is why CMD+F is a WINDOW
 * CAPTURE listener, one per bar and with no coordinator between them: an `outline` bar claims the
 * key while focus stands inside its own host, the `note` bar claims it whenever focus is NOT inside
 * any `.view-outline-editor` — and a HIDDEN editor never claims. A folder page (YAZ-919) hides the
 * note mount entirely, its outline being the document, so there CMD+F belongs to the outline even
 * from the sidebar or the title. Exactly one bar answers; the other declines.
 *
 * Focus: the input does not exist yet on the CMD+F that OPENS the bar, so that focus lands in a
 * layout effect on the open; a CMD+F on an already-open bar has an input to focus and refocuses it
 * from the handler itself — one call site, told apart by the ref being null or not.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type MouseEvent, type RefObject } from 'react'
import type { FindChannel } from './findChannel'
import './find.css'

export interface FindBarProps {
  /** The host's one channel per editor mount — the very instance `createCrepe` was given. */
  channel: FindChannel
  /** Which half of the claim rule this bar answers CMD+F by (🔒 YAZ-967). */
  scope: 'note' | 'outline'
  /** The outline bar's own view element: its claim IS focus standing inside it. Unread for `note`. */
  hostRef: RefObject<HTMLElement | null>
}

/** One glyph for both directions; the previous button rotates it (find.css). */
const Chevron = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m4 6 4 4 4-4" />
  </svg>
)

export function FindBar({ channel, scope, hostRef }: FindBarProps) {
  const state = useSyncExternalStore(channel.subscribe, channel.getState)
  const inputRef = useRef<HTMLInputElement>(null)

  const focusInput = (): void => {
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }

  useLayoutEffect(() => {
    if (state.open) focusInput()
  }, [state.open])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.shiftKey || event.altKey || event.key !== 'f') return
      const active = document.activeElement
      // checkVisibility is absent under jsdom, where nothing is ever hidden — hence the ?? true.
      const shown = (el: Element | null): boolean => el instanceof HTMLElement && (el.checkVisibility?.() ?? true)
      const claims =
        scope === 'outline'
          ? shown(hostRef.current) &&
            ((active !== null && hostRef.current !== null && hostRef.current.contains(active)) ||
              !shown(document.querySelector('.editor-mount .ProseMirror')))
          : shown(hostRef.current) && (!(active instanceof Element) || active.closest('.view-outline-editor') === null)
      if (!claims) return
      event.preventDefault()
      event.stopPropagation()
      channel.open()
      // Non-null only when the bar was ALREADY open — the opening CMD+F focuses from the effect.
      focusInput()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [channel, scope, hostRef])

  /** The buttons act on the search; the caret stays where the reader left it, in the query. */
  const hold = (event: MouseEvent): void => event.preventDefault()

  // Keep the zero-height dock mounted while closed: OutlineEditor appends its editor in an effect,
  // so this existing first child is what gives the outline's sticky bar its top anchor.
  return (
    <div className={`find-bar-dock find-bar-dock--${scope}`}>
      {state.open && (
        <div className="find-bar">
          <input
            ref={inputRef}
            className="find-bar__input"
            type="text"
            aria-label="Find in page"
            placeholder="Find"
            spellCheck={false}
            value={state.query}
            onInput={(event) => channel.setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (event.shiftKey) channel.prev()
                else channel.next()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                channel.close()
              }
            }}
          />
          {/* Nothing has been asked yet on an empty query, so there is no count to answer with. */}
          {state.query !== '' && <span className="find-bar__count">{state.total === 0 ? '0 of 0' : `${state.activeIndex + 1} of ${state.total}`}</span>}
          <button type="button" className="find-bar__btn find-bar__btn--prev" aria-label="Previous match" onMouseDown={hold} onClick={() => channel.prev()}>
            <Chevron />
          </button>
          <button type="button" className="find-bar__btn" aria-label="Next match" onMouseDown={hold} onClick={() => channel.next()}>
            <Chevron />
          </button>
          <button type="button" className="find-bar__btn find-bar__btn--close" aria-label="Close find" onMouseDown={hold} onClick={() => channel.close()}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}
