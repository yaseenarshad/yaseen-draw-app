/**
 * Pure rules for a draw.io diagram file (YAZ-1802), shared by main's doors, the tree's head read and
 * the renderer. No DOM and no XML parser — main has neither — so only the outline and the root tag.
 *
 * 🔒 D3: saved as plain XML (`<mxfile>` → `<diagram>` → `<mxGraphModel>`); a compressed page opens
 * and is rewritten plain on the next save. 🔒 D7: the two dates are `yaseendraw-*` attributes written
 * FIRST on the root `<mxfile>`, so the tree reads them off the head; draw.io drops attributes it does
 * not know, so main re-stamps them on every save.
 */
import type { BoardMetaBlock } from './drawingAssets'
import type { BoardMeta } from './types'

export const DIAGRAM_CREATED_ATTR = 'yaseendraw-created'
export const DIAGRAM_UPDATED_ATTR = 'yaseendraw-updated'

/** The two roots a draw.io document may have: the usual file wrapper, or a bare graph model. */
type DiagramRoot = 'mxfile' | 'mxGraphModel'

/**
 * A brand-new diagram (🔒 YAZ-1802 D13): one page, nothing on it, grid, alignment guides and page
 * view OFF (D12a).
 * Born through `fs:create-file` under `wx`, never as a zero-byte file — that is the corrupt case.
 */
export const EMPTY_DIAGRAM_XML = [
  '<mxfile>',
  '  <diagram id="page-1" name="Page-1">',
  '    <mxGraphModel grid="0" gridSize="10" guides="0" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
  '      <root>',
  '        <mxCell id="0" />',
  '        <mxCell id="1" parent="0" />',
  '      </root>',
  '    </mxGraphModel>',
  '  </diagram>',
  '</mxfile>',
  '',
].join('\n')

/** Where the root element's `<` sits: past a BOM, whitespace, the XML declaration, comments and a doctype. */
function rootStart(xml: string): number {
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0
  for (;;) {
    while (i < xml.length && /\s/.test(xml[i])) i++
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2)
      if (end === -1) return -1
      i = end + 2
    } else if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4)
      if (end === -1) return -1
      i = end + 3
    } else if (xml.startsWith('<!', i)) {
      const end = xml.indexOf('>', i + 2)
      if (end === -1) return -1
      i = end + 1
    } else return xml[i] === '<' ? i : -1
  }
}

/** `xml` without the comments, processing instructions and whitespace that may follow its root. */
function trimTrailingMisc(xml: string): string {
  let tail = xml.trimEnd()
  for (;;) {
    const open = tail.endsWith('-->') ? tail.lastIndexOf('<!--') : tail.endsWith('?>') ? tail.lastIndexOf('<?') : -1
    if (open === -1) return tail
    tail = tail.slice(0, open).trimEnd()
  }
}

/** The root element's name when it is one draw.io writes, else null (not XML, or some other XML). */
export function diagramRoot(xml: string): DiagramRoot | null {
  const at = rootStart(xml)
  if (at === -1) return null
  const match = /^<([A-Za-z_][\w.-]*)(?=[\s/>])/.exec(xml.slice(at, at + 64))
  const name = match?.[1]
  return name === 'mxfile' || name === 'mxGraphModel' ? name : null
}

/**
 * Why `xml` is not a diagram the editor may open, or null when it is (🔒 YAZ-1802 D6). The OUTLINE
 * only, like `sceneElements` for a drawing: a draw.io root, closed at the end — which is what a
 * truncated or half-written file fails. draw.io's own parser decides whether the cells make sense.
 */
export function diagramDocumentError(xml: string): string | null {
  if (xml.trim() === '') return 'the file is empty'
  const root = diagramRoot(xml)
  if (root === null) return 'the file is not a draw.io diagram (no <mxfile> or <mxGraphModel> root)'
  const tail = trimTrailingMisc(xml)
  const at = rootStart(xml)
  const selfClosing = new RegExp(`^<${root}\\b[^>]*/>$`).test(tail.slice(at))
  if (!selfClosing && !tail.endsWith(`</${root}>`)) return `the file is cut short (no closing </${root}>)`
  return null
}

/** The root `<mxfile …>` opening tag, or as much of it as `head` holds; null for any other root. */
function mxfileOpenTag(head: string): { start: number; end: number } | null {
  const at = rootStart(head)
  if (at === -1 || !/^<mxfile(?=[\s/>])/.test(head.slice(at, at + 8))) return null
  const close = head.indexOf('>', at)
  return { start: at, end: close === -1 ? head.length : close }
}

/** One of our date attributes in either quote style — group 2 is the value. Parse and strip share it, so a single-quoted one is never stamped twice. */
const attr = (name: string, flags = '') => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, flags)

/**
 * The dates off the HEAD of a diagram file (🔒 YAZ-1802 D7) — the first `BOARD_META_HEAD_BYTES`,
 * decoded as text, which may end mid-document. Both attributes must sit on the root `<mxfile>`
 * and parse to finite numbers; anything else (a bare `<mxGraphModel>`, a file draw.io wrote
 * elsewhere, a malformed value) is `null` — "no metadata", never an error (🔒 YAZ-1834 D7).
 */
export function parseDiagramMetaAttrs(head: string): BoardMetaBlock | null {
  const tag = mxfileOpenTag(head)
  if (tag === null) return null
  const text = head.slice(tag.start, tag.end)
  const created = Number(attr(DIAGRAM_CREATED_ATTR).exec(text)?.[2] ?? NaN)
  const updated = Number(attr(DIAGRAM_UPDATED_ATTR).exec(text)?.[2] ?? NaN)
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return null
  return { createdAt: created, updatedAt: updated }
}

/**
 * Place and stamp the dates on a diagram on its way to disk (🔒 YAZ-1802 D7) — the diagram twin
 * of `stampBoardMeta`. `prior` is what the FILE holds now (the save door reads it off the head)
 * and wins over any attribute inside `xml`, because the disk is the dates' truth: a finite
 * `createdAt` is kept, `updatedAt` is always `at.updatedAt`. Our two attributes go FIRST in the
 * `<mxfile>` tag, every other attribute keeps its order, and the rest of the document is
 * untouched byte for byte.
 *
 * A document whose root is not `<mxfile>` (a bare `<mxGraphModel>`) is returned as it is: it has
 * nowhere to carry the dates, and a missing stamp is "no metadata", never a refused save.
 */
export function stampDiagramMeta(xml: string, at: { createdAt: number; updatedAt: number }, prior: BoardMeta | null = null): string {
  const tag = mxfileOpenTag(xml)
  if (tag === null || tag.end === xml.length) return xml
  const own = parseDiagramMetaAttrs(xml)
  const kept = prior ?? own
  const createdAt = kept !== null && Number.isFinite(kept.createdAt) ? kept.createdAt : at.createdAt
  let rest = xml.slice(tag.start + '<mxfile'.length, tag.end)
  for (const name of [DIAGRAM_CREATED_ATTR, DIAGRAM_UPDATED_ATTR]) rest = rest.replace(attr(name, 'g'), '')
  const stamped = `<mxfile ${DIAGRAM_CREATED_ATTR}="${createdAt}" ${DIAGRAM_UPDATED_ATTR}="${at.updatedAt}"${rest}`
  return `${xml.slice(0, tag.start)}${stamped}${xml.slice(tag.end)}`
}
