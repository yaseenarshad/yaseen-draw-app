/**
 * Standard Markdown link interaction (YAZ-1309).
 *
 * A primary mousedown owns navigation before ProseMirror can move the caret. Right-click owns a
 * small editor-local menu whose edit/remove actions delegate to Crepe's existing link-tooltip
 * API; no parallel link model or serializer is introduced. Fragment-only hrefs deliberately fall
 * through because they are document-local, while all other href validation stays at the main
 * process boundary.
 */
import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Mark } from '@milkdown/kit/prose/model'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export interface MarkdownLinkNav {
  open: (href: string) => Promise<void> | void
  /** Injectable for tests; the app uses the platform clipboard by default. */
  copy?: (href: string) => Promise<void> | void
  onNotice: (message: string) => void
}

interface LinkHit {
  href: string
  mark: Mark
  from: number
  to: number
}

const markdownLinkKey = new PluginKey('mdapp-markdown-link')

const failureMessage = (prefix: string, error: unknown): string =>
  `${prefix}: ${error instanceof Error ? error.message : String(error)}`

/** Normalize synchronous throws and promise rejections onto the same passive-notice path. */
const attempt = (run: () => Promise<void> | void, prefix: string, onNotice: MarkdownLinkNav['onNotice']): void => {
  try {
    void Promise.resolve(run()).catch((error: unknown) => onNotice(failureMessage(prefix, error)))
  } catch (error) {
    onNotice(failureMessage(prefix, error))
  }
}

/**
 * Maps a rendered anchor back to its one ProseMirror link mark and complete inline range.
 * ProseMirror can render `[**bold** plain](href)` as adjacent anchors around differently marked
 * inline nodes, so the DOM anchor's range is not the logical link's range. Expand across every
 * contiguous sibling carrying the same link mark instead.
 */
function linkHit(view: EditorView, ctx: Ctx, target: EventTarget | null): LinkHit | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a')
  if (anchor === null || !view.dom.contains(anchor)) return null
  const probe = view.posAtDOM(anchor, 0)
  const $probe = view.state.doc.resolve(probe)
  if (!$probe.parent.isTextblock) return null
  const type = linkSchema.type(ctx)
  const start = $probe.start()
  const spans: Array<{ from: number; to: number; mark: Mark | null }> = []
  $probe.parent.forEach((node, offset) => {
    spans.push({ from: start + offset, to: start + offset + node.nodeSize, mark: type.isInSet(node.marks) ?? null })
  })
  const index = spans.findIndex((span) => span.mark !== null && probe >= span.from && probe < span.to)
  if (index < 0) return null
  const mark = spans[index]!.mark!
  let first = index
  let last = index
  while (first > 0 && spans[first - 1]!.mark?.eq(mark) === true) first -= 1
  while (last + 1 < spans.length && spans[last + 1]!.mark?.eq(mark) === true) last += 1
  if (typeof mark.attrs.href !== 'string') return null
  return { href: mark.attrs.href, mark, from: spans[first]!.from, to: spans[last]!.to }
}

function renderMenu(view: EditorView, hit: LinkHit, ctx: Ctx, nav: MarkdownLinkNav, close: () => void): HTMLElement {
  const popup = document.createElement('div')
  popup.className = 'ctx-menu ctx-menu--editor'
  popup.setAttribute('role', 'menu')

  const rows: Array<{ label: string; danger?: boolean; run: () => void }> = [
    {
      label: 'Edit link',
      run: () => ctx.get(linkTooltipAPI.key).editLink(hit.mark, hit.from, hit.to),
    },
    {
      label: 'Copy link',
      run: () => {
        const copy = nav.copy ?? ((href: string) => navigator.clipboard.writeText(href))
        attempt(() => copy(hit.href), 'Could not copy link', nav.onNotice)
      },
    },
    {
      label: 'Remove link',
      danger: true,
      run: () => ctx.get(linkTooltipAPI.key).removeLink(hit.from, hit.to),
    },
  ]

  for (const row of rows) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = `ctx-menu__item${row.danger === true ? ' ctx-menu__item--danger' : ''}`
    item.setAttribute('role', 'menuitem')
    item.textContent = row.label
    item.addEventListener('mousedown', (event) => event.preventDefault())
    item.addEventListener('click', () => {
      row.run()
      close()
    })
    popup.appendChild(item)
  }
  view.dom.parentElement?.appendChild(popup)
  return popup
}

export const createMarkdownLink = (nav: MarkdownLinkNav) =>
  $prose((ctx) => {
    let popup: HTMLElement | null = null
    const close = () => {
      popup?.remove()
      popup = null
    }

    return new Plugin({
      key: markdownLinkKey,
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            if (event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false
            const hit = linkHit(view, ctx, event.target)
            if (hit === null || hit.href.startsWith('#')) return false
            event.preventDefault()
            attempt(() => nav.open(hit.href), 'Could not open link', nav.onNotice)
            return true
          },
          contextmenu: (view, event) => {
            const hit = linkHit(view, ctx, event.target)
            if (hit === null) return false
            event.preventDefault()
            close()
            popup = renderMenu(view, hit, ctx, nav, close)
            const rect = popup.getBoundingClientRect()
            popup.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - rect.width))}px`
            popup.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - rect.height))}px`
            return true
          },
        },
      },
      view: () => {
        const onMouseDown = (event: MouseEvent) => {
          if (popup === null || !(event.target instanceof Node && popup.contains(event.target))) close()
        }
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') close()
        }
        document.addEventListener('mousedown', onMouseDown, true)
        document.addEventListener('scroll', close, true)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('blur', close)
        return {
          update: (view, previousState) => {
            if (view.state.doc !== previousState.doc) close()
          },
          destroy: () => {
            document.removeEventListener('mousedown', onMouseDown, true)
            document.removeEventListener('scroll', close, true)
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('blur', close)
            close()
          },
        }
      },
    })
  })
