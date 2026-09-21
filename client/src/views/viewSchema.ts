import { type Document, isMap, parseDocument } from 'yaml'

/**
 * The Obsidian Bases view-schema model — the shape a folder page's `views` block round-trips
 * through (`FolderPageContents`). The types mirror Obsidian's schema and
 * are ours too (extended later); unknown keys are typed as `unknown` and must
 * survive a parse → update → serialise cycle untouched, comments included.
 */

export type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] }

export interface SortSpec {
  property: string
  direction: 'ASC' | 'DESC'
}

export interface GroupBySpec {
  property: string
  direction?: 'ASC' | 'DESC'
}

export interface ViewDef {
  /** 'table' | 'cards' | 'list' | 'map' | 'board' (ours) | anything else (unknown, preserved) */
  type: string
  name: string
  filters?: FilterNode
  order?: string[]
  /** 🔒 D2 (YAZ-867): an outline view's whole document — ONE markdown bullet list (`views/outlineDoc.ts`). */
  outline?: string
  sort?: SortSpec[]
  /** Ordered levels, outer first; only the first two are honoured in v1 (YAZ-745). The single-object form stays valid. */
  groupBy?: GroupBySpec | GroupBySpec[]
  showEmptyColumns?: boolean
  limit?: number
  summaries?: Record<string, string>
  columnSize?: Record<string, number>
  frozenColumns?: number
  /** The `#` gutter (YAZ-1513). Absent = shown. */
  rowNumbers?: boolean
  rowHeight?: string
  image?: string
  cardSize?: string | number
  imageFit?: string
  imageAspectRatio?: string | number
  indentProperties?: boolean
  markerStyle?: string
  propertySeparator?: string
  /** Board card styling (YAZ-1206, reshaped by YAZ-1217): per canonical property key — bold/underline the value's row, hide its label, or `join` it onto the row being built instead of starting a new one. */
  cardStyle?: Record<string, { bold?: boolean; underline?: boolean; hideLabel?: boolean; join?: boolean }>
  /** Preview mode (YAZ-1244): hovering a table row / board card pops a read-only preview of the page. Absent is off. */
  preview?: boolean
  [extra: string]: unknown
}

/** A view's grouping levels, outer first, whichever form `groupBy` is written in. */
export const groupByLevels = (view: ViewDef): GroupBySpec[] =>
  Array.isArray(view.groupBy) ? view.groupBy : view.groupBy ? [view.groupBy] : []

export interface ViewSet {
  filters?: FilterNode
  formulas?: Record<string, string>
  properties?: Record<string, { displayName?: string; [extra: string]: unknown }>
  summaries?: Record<string, string>
  views: ViewDef[]
  /** The saved START (YAZ-1104), a view NAME — in the def since YAZ-1471 so rename/delete keep it honest in the same write. */
  defaultView?: string
  [extra: string]: unknown
}

/**
 * The ONE config-write door every menu is handed: `ViewsPane`'s `update`, which re-parses and
 * calls `onChange` (the folder-page host turns it into exactly one `folder_page_settings`
 * write). It lived in `view/FilterMenu.tsx` until YAZ-846 deleted that menu.
 */
export type Mutate = (mutate: (def: ViewSet) => void) => void

export class ViewParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly col?: number,
  ) {
    super(message)
    this.name = 'ViewParseError'
  }
}

export interface ParsedViews {
  def: ViewSet
  /** The yaml Document: keeps comments, blank lines, flow/block style and unknown keys. */
  doc: Document
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseViews(text: string): ParsedViews {
  const doc = parseDocument(text, { keepSourceTokens: true })
  const err = doc.errors[0]
  if (err) {
    const pos = err.linePos?.[0]
    throw new ViewParseError(err.message, pos?.line, pos?.col)
  }
  if (doc.contents === null) throw new ViewParseError('View schema is empty: missing views')
  if (!isMap(doc.contents)) throw new ViewParseError('View schema root must be a map with a views list')
  const js: unknown = doc.toJS()
  if (!isRecord(js)) throw new ViewParseError('View schema root must be a map with a views list')
  if (!Array.isArray(js.views)) throw new ViewParseError('views must be a list of views')
  js.views.forEach((v: unknown, i) => {
    if (!isRecord(v) || typeof v.type !== 'string' || typeof v.name !== 'string') {
      throw new ViewParseError(`views[${i}] must be a map with string type and name`)
    }
  })
  return { def: js as ViewSet, doc }
}

/**
 * `lineWidth: 0` disables folding so long scalars come back exactly as written;
 * `flowCollectionPadding: false` keeps `[1, 2]` as written instead of `[ 1, 2 ]`.
 */
export function serializeViews(parsed: ParsedViews): string {
  return parsed.doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

/**
 * Apply `mutate` to a clone of `def`, then write only the changed paths back
 * into `doc` so comments and untouched keys keep their original text.
 */
export function updateViews(parsed: ParsedViews, mutate: (def: ViewSet) => void): ParsedViews {
  const next = structuredClone(parsed.def)
  mutate(next)
  writeChanges(parsed.doc, [], parsed.def, next)
  return { def: next, doc: parsed.doc }
}

function writeChanges(doc: Document, path: (string | number)[], prev: unknown, next: unknown): void {
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) {
      doc.setIn(path, next)
      return
    }
    next.forEach((v, i) => writeChanges(doc, [...path, i], prev[i], v))
    return
  }
  if (isRecord(prev) && isRecord(next)) {
    for (const k of Object.keys(prev)) if (!(k in next)) doc.deleteIn([...path, k])
    for (const k of Object.keys(next)) writeChanges(doc, [...path, k], prev[k], next[k])
    return
  }
  if (prev !== next) doc.setIn(path, next)
}
