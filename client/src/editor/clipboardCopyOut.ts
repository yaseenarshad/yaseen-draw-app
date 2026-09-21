import { editorViewOptionsCtx, prosePluginsCtx, schemaCtx } from '@milkdown/kit/core'
import { DOMSerializer, type Slice } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { APP_CLIPBOARD } from './clipboardNumbers'
import { clipboardPlainText } from './clipboardPlainText'
import { EditorView as CodeMirrorView } from '@codemirror/view'

export const CLIPBOARD_EMPTY_PARAGRAPH = 'data-mdapp-empty-paragraph'

/** Copy-only formats: readable text, rich HTML and explicitly requested Markdown; saves stay unchanged. */
export const clipboardCopyOut = $prose((ctx) => {
  let copyMarkdown: ((slice: Slice, view: EditorView) => string) | undefined
  ctx.update(editorViewOptionsCtx, (prev) => {
    const stock = ctx.get(prosePluginsCtx).find((plugin) => plugin.props.clipboardTextSerializer)
    const serialize = prev.clipboardTextSerializer ?? stock?.props.clipboardTextSerializer?.bind(stock)
    if (!serialize) return prev
    copyMarkdown = serialize
    const html = prev.clipboardSerializer ?? DOMSerializer.fromSchema(ctx.get(schemaCtx))
    const clipboardSerializer = new DOMSerializer({
      ...html.nodes,
      paragraph: (node) => {
        const paragraph = html.serializeNode(node) as HTMLElement
        paragraph.style.marginTop = '0'
        paragraph.style.marginBottom = '0'
        if (node.content.size === 0) {
          const separator = document.createElement('br')
          for (const { name, value } of paragraph.attributes) separator.setAttribute(name, value)
          separator.setAttribute(CLIPBOARD_EMPTY_PARAGRAPH, 'true')
          return separator
        }
        return paragraph
      },
    }, html.marks)
    const serializeFragment = clipboardSerializer.serializeFragment.bind(clipboardSerializer)
    clipboardSerializer.serializeFragment = (fragment, options, target) => {
      const dom = serializeFragment(fragment, options, target)
      dom.firstElementChild?.setAttribute(APP_CLIPBOARD, 'true')
      return dom
    }
    return {
      ...prev,
      clipboardSerializer,
      clipboardTextSerializer: clipboardPlainText,
    }
  })
  return new Plugin({
    key: new PluginKey('mdapp-clipboard-copy-out'),
    view: view => {
      const unsubscribe = window.yaseenDocs?.menu?.onCopyAs?.(mode => {
        const active = document.activeElement
        if (active instanceof HTMLElement && view.dom.contains(active)) {
          const code = CodeMirrorView.findFromDOM(active)
          if (code?.hasFocus) return code.state.selection.ranges.filter(range => !range.empty)
            .map(range => code.state.sliceDoc(range.from, range.to)).join(code.state.lineBreak)
        }
        if (!view.hasFocus()) return undefined
        if (view.state.selection.empty) return ''
        const slice = view.state.selection.content()
        return mode === 'plain' ? clipboardPlainText(slice) : copyMarkdown?.(slice, view) ?? ''
      })
      return { destroy: () => unsubscribe?.() }
    },
  })
})
