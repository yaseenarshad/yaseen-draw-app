import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { api, BridgeRequestError } from '../api'
import { FOLDER_PAGES_KEY } from '../links/folderPages'
import type { ColumnDecl, FolderPageSettings } from './folderPageSettings'

/**
 * New-page scaffolding for folder pages (YAZ-832; 🔒 Q5/Q6 of YAZ-815). A folder page scaffolds
 * its members from its own DECLARATION — never a hardcoded shape — with two rules the model turns
 * on: the birth key is `folder_pages`, one wikilink back to the folder page
 * (`links/folderPages.ts`'s click rule), forced LAST so the card reads columns-then-parent; and
 * the new page is an ORDINARY page — the `folder_page` flag that makes a page a folder page is
 * never born here, only 4B's explicit "make this a folder page" writes it.
 *
 * The type-driven half this file used to carry — the type scaffold, its templates, the
 * starter base and the type-name helpers — died with the type system in YAZ-836: nothing
 * scaffolds a type identity property any more.
 */

export interface EntityParts {
  /** Frontmatter for the new page; folder-page births end on `folder_pages`. */
  properties: Record<string, unknown>
  /** Page body (the template's body; '' without one). */
  body: string
}

/** The one entry, spelled the way the click rule reads it back: exactly a wikilink. */
const belongsTo = (folderPageName: string): Record<string, unknown> => ({
  [FOLDER_PAGES_KEY]: [`[[${folderPageName}]]`],
})

/** The ONE empty-value rule for both newborn and existing members (🔒 Q5; YAZ-999). */
export function emptyColumnValue(column: ColumnDecl): unknown {
  return column.kind === 'list' || column.kind === 'multi-link' || column.kind === 'multi-select' ? [] : null
}

/** Every declared column, empty (scalar kinds → null, list/multi-link → []), + `folder_pages` LAST (🔒 Q5). */
export function scaffoldFromFolderPage(name: string, settings: FolderPageSettings): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [column, decl] of Object.entries(settings.columns)) {
    properties[column] = emptyColumnValue(decl)
  }
  return { ...properties, ...belongsTo(name) }
}

/**
 * Where a folder page's template lives; existence = has-template. Read over the ordinary
 * `readFile` bridge — the sanctioned path for markdown at any absolute path (no jail; the
 * dotfolder is invisible to tree/index/watcher, not to direct reads).
 */
export function folderPageTemplatePath(root: string, folderPageName: string): string {
  return `${root}/.yaseendocs/templates/${folderPageName}.md`
}

/**
 * Template read + merge, scaffold ← template frontmatter ← seed, with `folder_pages` forced back
 * and re-appended LAST — neither a template nor a seed may redirect (or displace) the birth.
 * Template keys outside the declaration are kept, as ever: frontmatter is source of truth and the
 * declaration gates no content. No template → body ''.
 */
export async function newPageFromFolderPage(
  root: string,
  folderPageName: string,
  settings: FolderPageSettings,
  seed: Record<string, unknown> = {},
): Promise<EntityParts> {
  let template: string | null = null
  try {
    template = (await api.readFile(folderPageTemplatePath(root, folderPageName))).content
  } catch (err) {
    if (!(err instanceof BridgeRequestError && err.code === 'NOT_FOUND')) throw err
  }
  const { frontmatter, body } = splitFrontmatter(template ?? '')
  const merged: Record<string, unknown> = {
    ...scaffoldFromFolderPage(folderPageName, settings),
    ...parseFrontmatter(frontmatter).properties,
    ...seed,
  }
  // Deleted, not overwritten: an assignment would leave the key wherever the template or seed
  // first put it, and LAST is the locked shape.
  delete merged[FOLDER_PAGES_KEY]
  return { properties: { ...merged, ...belongsTo(folderPageName) }, body }
}

/**
 * WHERE a folder page's members are parked (🔒 Q5/Q6): the settings' `folder`, created level by
 * level, and without one the folder page's OWN directory — the file lands beside the page it
 * belongs to. THE ONE PLACE both birth surfaces ask (YAZ-869): the contents block's New / outline
 * create row, and the Topics tree's right-click. Two copies of this rule would drift the moment
 * one of them learned about a new setting.
 */
export async function memberFolder(root: string, folderPagePath: string, settings: FolderPageSettings): Promise<string> {
  if (settings.folder === undefined) return folderPagePath.slice(0, folderPagePath.lastIndexOf('/'))
  return ensureFolder(root, settings.folder)
}

/** Create `<root>/<folder>` level by level (existing levels tolerated); resolves the absolute dir. */
export async function ensureFolder(root: string, folder: string): Promise<string> {
  let dir = root
  for (const segment of folder.split('/').filter((s) => s !== '')) {
    dir = `${dir}/${segment}`
    try {
      await api.createDir(dir)
    } catch (err) {
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  return dir
}
