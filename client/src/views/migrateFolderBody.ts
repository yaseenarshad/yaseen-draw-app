/**
 * THE FOLDER-PAGE BODY ROUND TRIP (YAZ-919 / YAZ-1022). A folder page is title → outline now
 * and its body editor is hidden by CSS, so body text a page ALREADY carries would be invisible:
 * silent disappearance, which is the one thing this app never does. So it MOVES — once, at the
 * top of the page's outline document — and the body is emptied. The body is where it came from,
 * so once it is empty the migration can never run again: emptiness IS the marker, never a flag.
 *
 * PURE, deliberately: file content in, file content out, no I/O, no clock, no randomness.
 * `useFile` applies the forward migration; the sidebar applies the reverse through
 * `transformFile`, which owns the optimistic disk write.
 *
 * THE BODY'S GRAMMAR is not re-spelled here. A line that is already a bullet stays one, at the
 * depth `outlineDoc`'s parse gives it (relative indentation, tabs = 4 spaces, `-`/`*`/`+` alike);
 * every other non-empty line becomes a depth-0 TEXT bullet; blank lines drop. `parseOutline` is
 * asked BOTH questions — is this one line a bullet, and what depth does this document give it —
 * so the outline module stays the only reader of that grammar (🔒 D2, YAZ-900).
 */
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { stringify } from 'yaml'
import { FOLDER_PAGE_KEY } from '../links/folderPages'
import { DEFAULT_VIEWS, SETTINGS_KEY } from './folderPageSettings'
import { parseOutline, serializeOutline, type OutlineLine } from './outlineDoc'
import { parseViews, updateViews, type ViewDef } from './viewSchema'

export interface FolderBodyMigration {
  /** The file's new content — the input verbatim when nothing moved. */
  content: string
  /** True only when the caller must write `content` back. */
  changed: boolean
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The body as outline lines. Each line is offered to `parseOutline` ALONE first — a one-line
 * document answers "is this a bullet?" and nothing else — then the whole run is parsed as one
 * document, which is what gives the surviving bullets their relative depths.
 */
/** A heading marker at a line's start: `#`s then whitespace then text (`#tag` is not one). */
const HEADING_MARKER = /^#{1,6}\s+/

function bodyLines(body: string): OutlineLine[] {
  const bullets = body
    .split('\n')
    .filter((line) => line.trim() !== '')
    // Prose is depth 0 whatever its own indentation says: it was never nesting, it was a paragraph.
    .map((line) => (parseOutline(line).length === 1 ? line : `- ${line.trim()}`))
  // The outline is bullets-only (🔒 F3): a heading inside a list item is REJECTED by the schema —
  // it renders as nothing and the next commit erases it. The words survive; the marker is body
  // formatting the outline cannot hold, so it is dropped, at any level, in prose and bullet alike.
  return parseOutline(bullets.join('\n')).map((line) => ({ ...line, text: line.text.replace(HEADING_MARKER, '') }))
}

/**
 * Migrate ONE markdown file's content, or hand it straight back. Every leg is conservative and
 * silent: a page that is not flagged, has nothing to move, or whose config this module cannot
 * read is simply left alone — a migration that cannot be sure is a migration that does nothing.
 */
export function migrateFolderBody(content: string): FolderBodyMigration {
  const unchanged: FolderBodyMigration = { content, changed: false }
  const { frontmatter, body } = splitFrontmatter(content)
  const { properties } = parseFrontmatter(frontmatter)
  // THE FLAG RULE (locked, `links/folderPages.ts`): the boolean `true` and nothing else.
  if (properties[FOLDER_PAGE_KEY] !== true) return unchanged
  if (body.trim() === '') return unchanged

  const raw = properties[SETTINGS_KEY]
  // A settings key written as something other than a map is the user's own text; rewriting it
  // would be an edit nobody asked for, and we have no views to prepend to either way.
  if (raw !== undefined && raw !== null && !isRecord(raw)) return unchanged
  const settings = isRecord(raw) ? raw : {}
  // No `views` list of its own means the page shows the defaults (🔒 Q7 — outline FIRST), so the
  // defaults are what the body migrates into; writing them down is what the first outline edit
  // would have written anyway.
  const views: unknown = Array.isArray(settings.views) ? settings.views : DEFAULT_VIEWS.map((view) => ({ ...view }))

  let parsed
  try {
    parsed = parseViews(stringify({ views }))
  } catch {
    // Report-don't-block, the folder-page rule everywhere: a views list this module cannot read
    // keeps its bytes and its body, rather than being half-migrated into a shape it never had.
    return unchanged
  }
  const index = parsed.def.views.findIndex((view: ViewDef) => view.type === 'outline')
  // CONSERVATIVE (YAZ-919): a page whose views declare no outline has nowhere to put the text,
  // and an outline view invented here would be a skin the user never asked for. Leave the body.
  if (index === -1) return unchanged

  const existing = parsed.def.views[index].outline
  const lines = [...bodyLines(body), ...parseOutline(typeof existing === 'string' ? existing : '')]
  if (lines.length === 0) return unchanged
  // Through the ONE config-write door, and serialised by `outlineDoc` so the whole document —
  // the migrated text and whatever stood there already — comes out in the one canonical spelling.
  const next = updateViews(parsed, (def) => {
    def.views[index].outline = serializeOutline(lines)
  })
  // Spread-then-reassign (`mapFolderPageSettingsLinks`'s idiom): `columns`, `folder` and any
  // unknown key keep their value AND their position. The body is dropped by rewriting the
  // frontmatter block ALONE — everything after it is what the page just lost.
  const value = { ...settings, views: next.def.views }
  return { content: setFrontmatterProperty(frontmatter, SETTINGS_KEY, value), changed: true }
}

/** Keep existing body bytes first, then make the former outline a separate Markdown block. */
function bodyWithOutline(body: string, outline: string, eol: string): string {
  if (outline === '') return body
  const normalized = eol === '\n' ? outline : outline.replace(/\n/g, eol)
  const restored = normalized.endsWith(eol) ? normalized : `${normalized}${eol}`
  if (body === '') return restored
  if (body.endsWith(`${eol}${eol}`)) return `${body}${restored}`
  return body.endsWith(eol) ? `${body}${eol}${restored}` : `${body}${eol}${eol}${restored}`
}

/**
 * The reverse of `migrateFolderBody` (YAZ-1022): the visible first outline becomes the normal
 * body, then its active value and the folder-page flag leave in the same pure transformation.
 * The view and every other setting stay, so enabling the page again can migrate the body once
 * without duplicating it.
 */
export function restoreFolderBody(content: string): FolderBodyMigration {
  const unchanged: FolderBodyMigration = { content, changed: false }
  const { frontmatter, body } = splitFrontmatter(content)
  const parsedFrontmatter = parseFrontmatter(frontmatter)
  if (parsedFrontmatter.error !== undefined) throw new Error(`Cannot turn this page back: ${parsedFrontmatter.error}`)
  if (parsedFrontmatter.properties[FOLDER_PAGE_KEY] !== true) return unchanged

  const withoutFlag = (): FolderBodyMigration => ({
    content: setFrontmatterProperty(content, FOLDER_PAGE_KEY, undefined),
    changed: true,
  })
  const raw = parsedFrontmatter.properties[SETTINGS_KEY]
  if (raw === undefined || raw === null) return withoutFlag()
  if (!isRecord(raw)) throw new Error('Cannot turn this page back: folder_page_settings is not a map')
  if (raw.views === undefined) return withoutFlag()
  if (!Array.isArray(raw.views)) throw new Error('Cannot turn this page back: folder_page_settings.views is not a list')

  let parsed
  try {
    parsed = parseViews(stringify({ views: raw.views }))
  } catch (err) {
    throw new Error(`Cannot turn this page back: ${err instanceof Error ? err.message : String(err)}`)
  }
  const index = parsed.def.views.findIndex((view: ViewDef) => view.type === 'outline')
  if (index === -1) return withoutFlag()
  const view = parsed.def.views[index]
  if (!Object.prototype.hasOwnProperty.call(view, 'outline')) return withoutFlag()
  if (typeof view.outline !== 'string') throw new Error('Cannot turn this page back: the first outline document is not text')

  const outline = view.outline
  const next = updateViews(parsed, (def) => {
    delete def.views[index].outline
  })
  let staged = setFrontmatterProperty(content, SETTINGS_KEY, { ...raw, views: next.def.views })
  staged = setFrontmatterProperty(staged, FOLDER_PAGE_KEY, undefined)
  const nextFrontmatter = splitFrontmatter(staged).frontmatter
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  return { content: nextFrontmatter + bodyWithOutline(body, outline, eol), changed: true }
}
