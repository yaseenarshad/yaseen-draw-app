/**
 * Readable text/plain for a copy: the document as a reader would type it out, not its markdown.
 * An image copies as its alt TEXT — the caption, never the `|width` display hint Obsidian's syntax
 * rides in the same attribute (`parseAlt`, imageSrc.ts) — with the src as the fallback for an
 * empty alt. That is the one stand-in for an image everywhere it needs a text identity: the fold
 * key, the zoom breadcrumb (`itemLabelText`, listNodes.ts) and this copy agree (YAZ-1709).
 */
import type { Fragment, Node, Slice } from '@milkdown/kit/prose/model'
import { parseAlt } from './image/imageSrc'

const isList = (node: Node) => node.type.name === 'bullet_list' || node.type.name === 'ordered_list'

function children(content: Fragment, separator: string, depth: number): string {
  const parts: string[] = []
  content.forEach(node => { parts.push(readable(node, depth)) })
  return parts.join(separator)
}

function readable(node: Node, depth: number): string {
  if (node.isText) return node.text ?? ''
  if (node.type.name === 'hardbreak') return '\n'
  if (node.type.name === 'image') return parseAlt(node.attrs.alt).text || node.attrs.src
  if (node.type.name === 'image-block') return node.attrs.caption || node.attrs.src || ''
  if (node.type.name === 'html') return node.attrs.value
  if (node.type.name === 'hr') return '───'
  if (isList(node)) {
    const items: string[] = []
    node.forEach((item, _offset, index) => {
      const ordered = node.type.name === 'ordered_list'
      const task = typeof item.attrs.checked === 'boolean' ? (item.attrs.checked ? '☑ ' : '☐ ') : ''
      const label = ordered ? `${(node.attrs.order ?? 1) + index}. ${task}` : task || '• '
      const indent = '  '.repeat(depth)
      const continuation = indent + ' '.repeat(label.length)
      const blocks: string[] = []
      item.forEach((block, _pos, blockIndex) => {
        if (isList(block)) {
          if (blockIndex === 0) blocks.push(indent + label.trimEnd())
          blocks.push(readable(block, depth + 1))
        } else {
          const text = readable(block, depth)
          blocks.push((blockIndex === 0 ? indent + label : continuation) + text.replace(/\n/g, '\n' + continuation))
        }
      })
      items.push(blocks.join('\n'))
    })
    return items.join('\n')
  }
  if (node.type.name === 'table_row' || node.type.name === 'table_header_row') return children(node.content, '\t', depth)
  if (node.isTextblock) return children(node.content, '', depth)
  if (node.isLeaf) return node.type.spec.leafText?.(node) ?? ''
  return children(node.content, '\n', depth)
}

/** Selected document rows, not Markdown separators: an empty row contributes one blank line. */
export function clipboardPlainText(slice: Slice): string {
  let content = slice.content
  let lastList = content
  let open = Math.min(slice.openStart, slice.openEnd)
  // A word selected inside a list has open list/item wrappers, not a selected list marker.
  while (open > 0 && content.childCount === 1 && content.firstChild!.childCount === 1 && !content.firstChild!.isTextblock) {
    if (isList(content.firstChild!)) lastList = content
    content = content.firstChild!.content
    open--
  }
  // A selected parent plus children needs its list; a sibling-only selection does not need ancestors.
  if (content.childCount === 1 && content.firstChild!.type.name === 'list_item') content = lastList
  const text = children(content, '\n', 0)
  // Selecting an actual empty paragraph still copies a line, rather than old clipboard data.
  return text || (content.size > 0 ? '\n' : '')
}
