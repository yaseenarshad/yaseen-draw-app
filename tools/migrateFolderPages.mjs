#!/usr/bin/env node
/**
 * THE migration (YAZ-853, under the LOCKED rulings D1-D6 of YAZ-822): one idempotent script that
 * turns a `page_type` vault into the folder-page model.
 *
 *   node tools/migrateFolderPages.mjs --vault <path>            # dry run — the DEFAULT
 *   node tools/migrateFolderPages.mjs --vault <path> --apply    # execute
 *
 * IT REFUSES TO RUN unless the vault is a git repository with a CLEAN working tree (🔒 D1): the
 * undo button for everything below is `git checkout .`, so there must be something to check out
 * back to. Our own `migration-report.md` is the one path the cleanliness test forgives — a dry run
 * writes it by ruling (🔒 D6), and it must not then block the `--apply` that follows.
 *
 * WHAT IT DOES, in the order the report lists it:
 *  · CARDS (🔒 D3) — `page_type: x` becomes a `folder_pages` entry `[[<Plural>]]` and the key is
 *    deleted; `channels:` / `functions:` link arrays MERGE into `folder_pages` (order preserved,
 *    de-duplicated like a click) and those keys are deleted; the `function:` TEXT field is deleted
 *    only where a `functions:` links field also existed. Every other relation is untouched.
 *  · FOLDER PAGES (🔒 D4) — one per distinct `page_type`, named from `.yaseendraw/types.json`
 *    (`pluralName` → `displayName` → an irregulars map → a regular pluralizer), carrying the flag,
 *    `folder_pages: ["[[Home]]"]` and the type's registry properties as `folder_page_settings`
 *    columns. Home is created with an outline `order` over them. Templates follow the new names,
 *    and `types.json` is deleted once everything is out of it.
 *  · DISK (🔒 D5) — the deep `functions/<sub>/` trees flatten (function pages up into `functions/`,
 *    everybody else out into `problems/`), the `channels/<sub>/` bins dissolve into their pages'
 *    typed folders, emptied directories go, and the retired `.base` files go with them.
 *  · REPORT (🔒 D6) — printed AND written to `<vault>/migration-report.md`, with per-transform
 *    counts and FULL lists. `--apply` appends the post-checks it then runs.
 *
 * WRITES ARE PER-KEY. Every card edit goes through `shared/frontmatter.ts`'s
 * `setFrontmatterProperty` — the app's own one-key writer — so untouched keys, comments, key order,
 * quoting and the whole body survive byte for byte. A note whose frontmatter will not parse is
 * never written to; it is reported and left exactly as it is.
 *
 * NOTHING IS EVER OVERWRITTEN. A move onto an occupied name stops that one file and reports it; a
 * folder page whose name already answers in the vault is ADOPTED (flag + Home entry added) rather
 * than replaced; Home is never created while anything already answers `[[Home]]`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// The vault plumbing every tools/ script shares (YAZ-1549): the `shared/` TS loader, the git
// preflight and the file walk — so this migration and the seed cannot drift in either.
import { gitDirtReason as vaultDirtReason, isMarkdown, isSkipped, posix, shared, walkVault } from './lib/vault.mjs'

const { buildFrontmatter, setFrontmatterProperty, splitFrontmatter, parseFrontmatter, FrontmatterWriteError } =
  await shared('frontmatter.ts')
const { PROPERTY_KINDS, PROPERTY_NAME, FOLDER_NAME } = await shared('types.ts')

// ---------------------------------------------------------------------------
// Vocabulary (the ONE spelling of every key this migration touches)
// ---------------------------------------------------------------------------

const PAGE_TYPE_KEY = 'page_type'
const FOLDER_PAGE_KEY = 'folder_page'
const FOLDER_PAGES_KEY = 'folder_pages'
const SETTINGS_KEY = 'folder_page_settings'
const CHANNELS_KEY = 'channels'
const FUNCTIONS_KEY = 'functions'
const FUNCTION_TEXT_KEY = 'function'
const ALIASES_KEY = 'aliases'

const REPORT_FILE = 'migration-report.md'
const CONFIG_DIR = '.yaseendraw'
const TYPES_FILE = 'types.json'
const PROPERTIES_FILE = 'properties.json'
const TEMPLATES_DIR = 'templates'
const SCRIPTS_DIR = '_scripts'

const HOME_NAME = 'Home'
const CHANNEL_TYPE = 'channel'
const FUNCTION_TYPE = 'function'

/** 🔒 D5: these subtrees are the migration's blind spot — nothing under them is ever moved. */
const KEEP_PREFIXES = ['taxonomy/', 'metrics/calculated/', 'metrics/counts/', 'metrics/sums/']

/**
 * The irregulars a regular pluralizer gets wrong, for types the registry never declared (🔒 D4:
 * "unregistered types like book/author/kpi get sensible plurals"). Deliberately SMALL and reported
 * in full by every run — a registry `pluralName` or `displayName` always wins over it.
 */
const IRREGULAR_PLURALS = {
  analysis: 'Analyses',
  faq: 'FAQs',
  icp: 'ICPs',
  kpi: 'KPIs',
  okr: 'OKRs',
  person: 'People',
  sku: 'SKUs',
  taxonomy: 'Taxonomies',
}

const KINDS = new Set(PROPERTY_KINDS)

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `[[x]]` → `x`, otherwise unchanged — `views/expr/values.ts`'s rule. */
const WIKI_LINK = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/
const stripBrackets = (s) => WIKI_LINK.exec(s)?.[1] ?? s

/** Exactly a wikilink and nothing around it — the indexer's frontmatter-link rule (`scan.ts`). */
const EXACT_WIKILINK_RE = /^\[\[[^[\]]*\]\]$/

/** The key a resolver would look this target up under: brackets, `|alias` and `#heading` gone. */
const linkKey = (target) =>
  stripBrackets(String(target))
    .replace(/[#|].*$/, '')
    .trim()
    .toLowerCase()

/** A name as the click rule reads it back. Nothing is ever wrapped that was not already a link. */
const linkOf = (name) => `[[${name}]]`

/**
 * One note's `folder_pages`-shaped value as a REWRITABLE list — `links/folderPages.ts`'s own
 * tolerance: a scalar is ONE entry (the indexer counts it as one), a mapping declares nothing.
 */
function entryList(raw) {
  if (Array.isArray(raw)) return [...raw]
  if (raw === undefined || raw === null || typeof raw === 'object') return []
  return [raw]
}

const unique = (xs) => [...new Set(xs)]

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

// ---------------------------------------------------------------------------
// Naming: a page_type becomes a folder page name (🔒 D4)
// ---------------------------------------------------------------------------

/** `funnel-stage` → `Funnel Stage`; `_` and `-` are word breaks, existing capitals are kept. */
function titleCase(name) {
  return String(name)
    .split(/[-_\s]+/)
    .filter((w) => w !== '')
    .map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

/** English's regular rules, applied to the LAST word only: `Funnel Stage` → `Funnel Stages`. */
function pluralize(phrase) {
  const words = phrase.split(' ')
  const last = words[words.length - 1]
  let plural
  if (/[^aeiouAEIOU]y$/.test(last)) plural = `${last.slice(0, -1)}ies`
  else if (/(s|x|z|ch|sh)$/i.test(last)) plural = `${last}es`
  else plural = `${last}s`
  words[words.length - 1] = plural
  return words.join(' ')
}

/**
 * 🔒 D4's ladder, top rung first: the registry's own `pluralName`, then its `displayName`
 * pluralized, then the irregulars map (which exists for the types the registry never declared),
 * then the type name pluralized. Returns `{ name, source }` so the report can show its work.
 */
export function pluralNameFor(type, def) {
  if (def && typeof def.pluralName === 'string' && def.pluralName.trim() !== '') {
    return { name: def.pluralName.trim(), source: 'types.json pluralName' }
  }
  if (def && typeof def.displayName === 'string' && def.displayName.trim() !== '') {
    return { name: pluralize(titleCase(def.displayName.trim())), source: 'types.json displayName' }
  }
  const irregular = IRREGULAR_PLURALS[String(type).toLowerCase()]
  if (irregular) return { name: irregular, source: 'irregulars map' }
  return { name: pluralize(titleCase(type)), source: 'pluralized type name' }
}

// ---------------------------------------------------------------------------
// Resolution — the SAME rule the app clicks with (`views/engine.ts` makeResolver)
// ---------------------------------------------------------------------------

const normalise = (s) =>
  s
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.(md|markdown)$/i, '')
    .toLowerCase()

/**
 * Absolute path → root-relative path → bare basename (duplicates go to the SHALLOWEST folder,
 * equal depth to the first in path order) → frontmatter ALIAS, last. Case-insensitive throughout.
 * A faithful port of `makeResolver`, because a `folder_pages` entry only counts if it resolves the
 * way a CLICK would, and the post-checks have to ask exactly that question.
 */
export function makeResolver(pages, root) {
  const byPath = new Map()
  const byRel = new Map()
  const byBase = new Map()
  const byAlias = new Map()
  const shallowest = (map, key, page, depth) => {
    const prev = map.get(key)
    if (prev === undefined || depth < prev.depth) map.set(key, { page, depth })
  }
  for (const page of pages) {
    byPath.set(page.abs.toLowerCase(), page)
    const rel = normalise(page.folder ? `${page.folder}/${page.basename}` : page.basename)
    if (!byRel.has(rel)) byRel.set(rel, page)
    const depth = page.folder === '' ? 0 : page.folder.split('/').length
    shallowest(byBase, page.basename.toLowerCase(), page, depth)
    for (const alias of page.aliases) shallowest(byAlias, alias.toLowerCase(), page, depth)
  }
  const rootKey = `${root.replace(/\/+$/, '').toLowerCase()}/`
  return (target) => {
    const key = linkKey(target)
    if (key === '') return null
    let found = byPath.get(key) ?? null
    if (!found) {
      const rel = normalise(key.startsWith(rootKey) ? key.slice(rootKey.length) : key)
      found = byRel.get(rel) ?? (rel.includes('/') ? null : (byBase.get(rel)?.page ?? null))
    }
    if (!found) found = byAlias.get(key)?.page ?? null
    return found
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const CODE_SPAN_RE = /(`+)[\s\S]*?\1/g
const WIKILINK_RE = /(!?)\[\[([^[\]]*)\]\]/g

/** `scan.ts`'s pre-pass: nothing inside a fenced block or an inline span is a link. */
function stripCode(body) {
  const lines = body.split('\n')
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i])
    if (fence === null) {
      if (m) fence = m[1]
    } else if (m && m[1][0] === fence[0] && m[1].length >= fence.length && lines[i].trim() === m[1]) {
      fence = null
    }
    if (fence !== null || m) lines[i] = ''
  }
  return lines.join('\n').replace(CODE_SPAN_RE, ' ')
}

/** The body's `[[links]]` (embeds excluded), `|alias` / `#heading` stripped, de-duplicated. */
function bodyLinksOf(body) {
  const out = []
  for (const m of stripCode(body).matchAll(WIKILINK_RE)) {
    if (m[1] === '!') continue
    const target = m[2].split('|')[0].split('#')[0].trim()
    if (target !== '') out.push(target)
  }
  return unique(out)
}

/** `scan.ts`'s alias rule: a list → each string item, a scalar string → one alias; trimmed. */
function aliasesOf(properties) {
  const raw = properties[ALIASES_KEY]
  const out = []
  for (const item of Array.isArray(raw) ? raw : [raw]) {
    if (typeof item !== 'string') continue
    const alias = item.trim()
    if (alias !== '') out.push(alias)
  }
  return unique(out)
}

function readPage(abs, root) {
  const content = fs.readFileSync(abs, 'utf8')
  const { frontmatter, body } = splitFrontmatter(content)
  const { properties, error } = parseFrontmatter(frontmatter)
  const rel = posix(path.relative(root, abs))
  const name = path.basename(abs)
  return {
    abs,
    rel,
    name,
    basename: name.replace(/\.(md|markdown)$/i, ''),
    folder: posix(path.dirname(rel)) === '.' ? '' : posix(path.dirname(rel)),
    content,
    body,
    properties,
    frontmatterError: error,
    aliases: aliasesOf(properties),
    bodyLinks: bodyLinksOf(body),
  }
}

/**
 * Everything the plan needs, in one walk: the markdown pages (our own report excluded — it is an
 * artifact of this script and never a page of the vault), the retired `.base` files, the registry,
 * its templates and the `_scripts/` python the report has to give a verdict on.
 */
function scanVault(root) {
  const pages = []
  const baseFiles = []
  const scripts = []
  walkVault(root, (abs, name) => {
    if (isMarkdown(name)) {
      if (path.relative(root, abs) === REPORT_FILE) return
      pages.push(readPage(abs, root))
    } else if (name.toLowerCase().endsWith('.base')) baseFiles.push(abs)
  })
  pages.sort((a, b) => (a.abs < b.abs ? -1 : 1))

  const scriptsRoot = path.join(root, SCRIPTS_DIR)
  if (fs.existsSync(scriptsRoot)) {
    const walkScripts = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (isSkipped(entry.name)) continue
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) walkScripts(abs)
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.py')) scripts.push(abs)
      }
    }
    walkScripts(scriptsRoot)
  }

  const templatesDir = path.join(root, CONFIG_DIR, TEMPLATES_DIR)
  const templates = fs.existsSync(templatesDir)
    ? fs
        .readdirSync(templatesDir, { withFileTypes: true })
        .filter((e) => e.isFile() && isMarkdown(e.name))
        .map((e) => path.join(templatesDir, e.name))
        .sort()
    : []

  return { root, pages, baseFiles, scripts, templates, registry: readRegistry(root) }
}

/** `.yaseendraw/types.json`, read best-effort: a file we cannot parse blocks the run rather than losing it. */
function readRegistry(root) {
  const file = path.join(root, CONFIG_DIR, TYPES_FILE)
  if (!fs.existsSync(file)) return { file, present: false, types: {}, properties: {}, error: undefined }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return { file, present: true, types: {}, properties: {}, error: `types.json is not valid JSON: ${err.message}` }
  }
  if (!isRecord(raw)) return { file, present: true, types: {}, properties: {}, error: 'types.json is not an object' }
  return {
    file,
    present: true,
    version: typeof raw.version === 'number' ? raw.version : undefined,
    types: isRecord(raw.types) ? raw.types : {},
    properties: isRecord(raw.properties) ? raw.properties : {},
    error: undefined,
  }
}

// ---------------------------------------------------------------------------
// Git preflight (🔒 D1)
// ---------------------------------------------------------------------------

/**
 * `null` when the vault is a git repo whose tree is clean, else the sentence explaining why not.
 * Our own `migration-report.md` never counts as dirt (🔒 D6 has the dry run write it, and the
 * `--apply` that follows must not then be refused because of it) — forgiven by its final path
 * segment, since the vault may be a subdirectory of the repo (the e2e fixture is).
 */
export function gitDirtReason(root) {
  return vaultDirtReason(root, { forgive: (p) => p === REPORT_FILE || p.endsWith(`/${REPORT_FILE}`) })
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * One page's pending frontmatter edits, accumulated in ONE place so a page that is both a card
 * (`page_type` → membership) and an adopted folder page (flag + Home entry) is written once.
 */
function addEdit(plan, page, key, value) {
  let held = plan.editsByPath.get(page.abs)
  if (held === undefined) plan.editsByPath.set(page.abs, (held = { page, ops: [] }))
  held.ops.push({ key, value })
}

/**
 * `folder_pages` is written ONCE per page, however many rules wanted to add to it — the type's
 * folder page, a merged `channels:` / `functions:` list and an adopted folder page's own
 * `[[Home]]` entry all queue here and leave as a single key write, so no rule can overwrite
 * another's entries.
 */
function addMembership(plan, page, entries) {
  const held = plan.membershipQueue.get(page.abs)
  if (held === undefined) plan.membershipQueue.set(page.abs, { page, add: [...entries] })
  else held.add.push(...entries)
}

/**
 * Why this page can never be written to, or null. Asked ONCE, by every rule that would touch it:
 * broken YAML is never rewritten, and a `folder_pages` MAPPING is data a merge would destroy.
 */
function unwritableReason(page) {
  if (page.frontmatterError) return `frontmatter will not parse (${page.frontmatterError}) — nothing written`
  const raw = page.properties[FOLDER_PAGES_KEY]
  if (raw !== undefined && raw !== null && isRecord(raw)) {
    return `\`${FOLDER_PAGES_KEY}\` is a mapping — merging into it would lose data, card left untouched`
  }
  return null
}

/** Order-preserving, click-shaped de-duplication: two spellings of one page are ONE entry. */
function mergeEntries(base, extra) {
  const out = []
  const seen = new Set()
  for (const entry of [...base, ...extra]) {
    const key = typeof entry === 'string' && EXACT_WIKILINK_RE.test(entry.trim()) ? linkKey(entry) : JSON.stringify(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/**
 * The registry's property declarations become a folder page's `columns` (🔒 D4). A link column's
 * `target` names a TYPE today; it becomes the wikilink to that type's folder page, which is what
 * the belongs-to picker reads (`belongsToBasenames`).
 */
function columnsFrom(props, folderPageOf, registry, problems, where) {
  const columns = {}
  for (const [name, decl] of Object.entries(props ?? {})) {
    if (!isRecord(decl)) {
      problems.push(`${where}: property \`${name}\` is not an object — dropped`)
      continue
    }
    if (typeof decl.kind !== 'string' || !KINDS.has(decl.kind)) {
      problems.push(`${where}: property \`${name}\` has an unknown kind \`${String(decl.kind)}\` — dropped`)
      continue
    }
    const column = { kind: decl.kind }
    if (typeof decl.target === 'string' && decl.target.trim() !== '') {
      const target = decl.target.trim()
      if (EXACT_WIKILINK_RE.test(target)) column.target = target
      else if (folderPageOf.has(target)) column.target = linkOf(folderPageOf.get(target).name)
      else if (registry.types[target] !== undefined) {
        // A registered type no page actually carries: no folder page was created for it, so the
        // target is written to the name one WOULD have, and the picker falls back to every page
        // meanwhile (report-don't-block, the belongs-to picker's own rule).
        column.target = linkOf(pluralNameFor(target, registry.types[target]).name)
        problems.push(`${where}: property \`${name}\` targets \`${target}\`, a type no page carries — pointed at ${column.target}, which does not exist yet`)
      } else {
        column.target = target
        problems.push(`${where}: property \`${name}\` targets \`${target}\`, which is no known type — left verbatim`)
      }
    }
    if (typeof decl.required === 'boolean') column.required = decl.required
    columns[name] = column
  }
  return columns
}

function buildPlan(scan) {
  const { root, pages, registry } = scan
  const plan = {
    root,
    blockers: [],
    problems: [],
    editsByPath: new Map(),
    membershipQueue: new Map(),
    creates: [], // { abs, rel, content, what }
    adopted: [], // { name, abs, rel, why }
    folderPages: [], // { type, name, abs, rel, source, columns, folder, count, created }
    renames: [], // { from, to }
    moves: [], // { from, to, why }
    deletes: [], // { abs, why }
    collisions: [], // { abs, wanted, why }
    skipped: [], // { rel, why }
    membershipsWritten: [], // { rel, entries }
    transforms: { pageType: [], channels: [], functions: [], functionText: [], flag: [] },
    textOnlyFunction: [],
    noPageType: [],
    scriptVerdicts: [],
    typeCounts: new Map(),
    home: null,
    propertiesWrite: null,
    pluralMapping: [],
    preExistingMembers: new Map(),
  }

  if (registry.error) plan.blockers.push(registry.error)
  if (registry.present && registry.version !== undefined && registry.version > 1) {
    plan.blockers.push(`types.json declares version ${registry.version}; this migration only understands version 1`)
  }

  const resolve = makeResolver(pages, root)
  const claimed = new Set(pages.map((p) => p.abs.toLowerCase()))

  // ---- 1. What types exist, and what each one's folder page is called -------------------------
  for (const page of pages) {
    const type = page.properties[PAGE_TYPE_KEY]
    if (type === undefined) continue
    if (typeof type !== 'string' || type.trim() === '') {
      plan.skipped.push({ rel: page.rel, why: `\`${PAGE_TYPE_KEY}\` is not a name (${JSON.stringify(type)}) — card left untouched` })
      continue
    }
    const key = type.trim()
    plan.typeCounts.set(key, (plan.typeCounts.get(key) ?? 0) + 1)
  }

  const folderPageOf = new Map()
  const byName = new Map()
  for (const type of [...plan.typeCounts.keys()].sort()) {
    const def = registry.types[type]
    const { name, source } = pluralNameFor(type, def)
    if (byName.has(name)) {
      plan.blockers.push(
        `types \`${byName.get(name)}\` and \`${type}\` both want the folder page "${name}" — give one of them a distinct pluralName in types.json first`,
      )
      continue
    }
    byName.set(name, type)
    folderPageOf.set(type, { name, source, registered: def !== undefined })
    plan.pluralMapping.push({ type, name, source, registered: def !== undefined, count: plan.typeCounts.get(type) })
  }

  // ---- 2. The folder page files themselves (🔒 D4) --------------------------------------------
  for (const [type, fp] of folderPageOf) {
    const def = registry.types[type]
    const problems = []
    const columns = columnsFrom(def?.properties, folderPageOf, registry, problems, `types.json → ${type}`)
    plan.problems.push(...problems)

    let folder
    if (typeof def?.folder === 'string' && def.folder.trim() !== '') {
      if (FOLDER_NAME.test(def.folder.trim())) folder = def.folder.trim()
      else plan.problems.push(`types.json → ${type}: folder \`${def.folder}\` is not a root-relative folder name — omitted`)
    }

    const settings = {}
    if (Object.keys(columns).length > 0) settings.columns = columns
    if (folder !== undefined) settings.folder = folder

    const existing = resolve(linkOf(fp.name))
    const record = {
      type,
      name: fp.name,
      source: fp.source,
      columns,
      folder,
      count: plan.typeCounts.get(type),
      created: existing === null,
      abs: existing ? existing.abs : path.join(root, `${fp.name}.md`),
      rel: existing ? existing.rel : `${fp.name}.md`,
    }
    plan.folderPages.push(record)

    if (existing === null) {
      const properties = { [FOLDER_PAGE_KEY]: true, [FOLDER_PAGES_KEY]: [linkOf(HOME_NAME)] }
      if (Object.keys(settings).length > 0) properties[SETTINGS_KEY] = settings
      plan.creates.push({ abs: record.abs, rel: record.rel, content: buildFrontmatter(properties), what: `folder page for \`${type}\`` })
      claimed.add(record.abs.toLowerCase())
    } else {
      // ADOPTION, never a rival: the name already answers in this vault, so the existing page
      // becomes the folder page. Its own settings are never overwritten — only what is missing
      // is added.
      plan.adopted.push({ name: fp.name, abs: existing.abs, rel: existing.rel, why: `\`[[${fp.name}]]\` already resolves here` })
      const unwritable = unwritableReason(existing)
      if (unwritable !== null) {
        plan.skipped.push({ rel: existing.rel, why: unwritable })
        continue
      }
      if (existing.properties[FOLDER_PAGE_KEY] !== true) {
        addEdit(plan, existing, FOLDER_PAGE_KEY, true)
        plan.transforms.flag.push({ rel: existing.rel, why: `adopted as the folder page for \`${type}\`` })
      }
      if (existing.properties[SETTINGS_KEY] === undefined && Object.keys(settings).length > 0) {
        addEdit(plan, existing, SETTINGS_KEY, settings)
      }
      if (existing.basename.toLowerCase() !== HOME_NAME.toLowerCase()) addMembership(plan, existing, [linkOf(HOME_NAME)])
    }
  }

  // ---- 3. Every card (🔒 D3) -------------------------------------------------------------------
  const folderPageAbs = new Set(plan.folderPages.map((f) => f.abs))
  const unreadable = new Set()
  for (const page of pages) {
    const props = page.properties
    // Broken YAML parses as `{}` (the indexer's own tolerance), so a page like this is INVISIBLE
    // to every rule below — which is the safe outcome, but never a silent one.
    if (page.frontmatterError) {
      unreadable.add(page.abs)
      plan.skipped.push({ rel: page.rel, why: `frontmatter will not parse (${page.frontmatterError}) — nothing written, nothing read` })
      continue
    }
    const hasAny =
      props[PAGE_TYPE_KEY] !== undefined || props[CHANNELS_KEY] !== undefined || props[FUNCTIONS_KEY] !== undefined

    // A pre-existing membership is recorded whatever else happens: the post-check's expected
    // member counts have to know which pages already pointed at a folder page by hand.
    for (const entry of entryList(props[FOLDER_PAGES_KEY])) {
      if (typeof entry !== 'string' || !EXACT_WIKILINK_RE.test(entry.trim())) continue
      const key = linkKey(entry)
      const held = plan.preExistingMembers.get(key)
      if (held === undefined) plan.preExistingMembers.set(key, new Set([page.abs]))
      else held.add(page.abs)
    }

    if (!hasAny) continue
    const unwritable = unwritableReason(page)
    if (unwritable !== null) {
      plan.skipped.push({ rel: page.rel, why: unwritable })
      continue
    }

    const type = typeof props[PAGE_TYPE_KEY] === 'string' ? props[PAGE_TYPE_KEY].trim() : undefined
    if (props[PAGE_TYPE_KEY] !== undefined && (type === undefined || type === '')) continue // already reported in step 1

    const added = []
    if (type !== undefined && folderPageOf.has(type)) added.push(linkOf(folderPageOf.get(type).name))
    if (props[CHANNELS_KEY] !== undefined) added.push(...entryList(props[CHANNELS_KEY]))
    if (props[FUNCTIONS_KEY] !== undefined) added.push(...entryList(props[FUNCTIONS_KEY]))
    addMembership(plan, page, added)

    // A channel / function page is itself a folder page: everybody who listed it in `channels:` /
    // `functions:` now names it in `folder_pages`, and an entry only counts when its target
    // carries the flag (🔒 D4).
    if ((type === CHANNEL_TYPE || type === FUNCTION_TYPE) && props[FOLDER_PAGE_KEY] !== true && !folderPageAbs.has(page.abs)) {
      addEdit(plan, page, FOLDER_PAGE_KEY, true)
      plan.transforms.flag.push({ rel: page.rel, why: `\`${type}\` pages are folder pages of their own` })
    }

    if (type !== undefined) {
      addEdit(plan, page, PAGE_TYPE_KEY, undefined)
      plan.transforms.pageType.push({ rel: page.rel, type, into: folderPageOf.get(type)?.name ?? '(no folder page)' })
    }
    if (props[CHANNELS_KEY] !== undefined) {
      addEdit(plan, page, CHANNELS_KEY, undefined)
      plan.transforms.channels.push({ rel: page.rel, entries: entryList(props[CHANNELS_KEY]) })
    }
    if (props[FUNCTIONS_KEY] !== undefined) {
      addEdit(plan, page, FUNCTIONS_KEY, undefined)
      plan.transforms.functions.push({ rel: page.rel, entries: entryList(props[FUNCTIONS_KEY]) })
      // 🔒 D3: the TEXT field goes only where the links field carried the same data.
      if (props[FUNCTION_TEXT_KEY] !== undefined) {
        addEdit(plan, page, FUNCTION_TEXT_KEY, undefined)
        plan.transforms.functionText.push({ rel: page.rel, value: props[FUNCTION_TEXT_KEY] })
      }
    }
  }

  // ---- 3b. `folder_pages` leaves as ONE write per page -----------------------------------------
  const finalEntries = new Map()
  for (const { page, add } of [...plan.membershipQueue.values()].sort((a, b) => (a.page.abs < b.page.abs ? -1 : 1))) {
    const existing = entryList(page.properties[FOLDER_PAGES_KEY])
    const merged = mergeEntries(existing, add)
    finalEntries.set(page.abs, merged)
    const unchanged =
      merged.length === existing.length && merged.every((e, i) => JSON.stringify(e) === JSON.stringify(existing[i]))
    if (unchanged) continue
    addEdit(plan, page, FOLDER_PAGES_KEY, merged)
    plan.membershipsWritten.push({ rel: page.rel, entries: merged })
  }

  // The text-only pages are the ones nobody merged: they KEEP `function:` and are listed so a
  // human can decide what to do with them (🔒 D3).
  for (const page of pages) {
    if (page.properties[FUNCTION_TEXT_KEY] !== undefined && page.properties[FUNCTIONS_KEY] === undefined) {
      plan.textOnlyFunction.push({ rel: page.rel, value: page.properties[FUNCTION_TEXT_KEY] })
    }
  }

  // ---- 4. Home (🔒 D4) --------------------------------------------------------------------------
  const homePage = resolve(linkOf(HOME_NAME))
  const order = orderedFolderPages(plan.folderPages, registry)
  if (homePage === null) {
    // `DEFAULT_VIEWS`' two skins (🔒 Q7 of YAZ-815), the outline carrying the curated `order`. An
    // empty order is simply left out — the [D5] rule reads an absent one as all-alphabetical.
    const outline = { type: 'outline', name: 'Outline' }
    if (order.length > 0) outline.order = order.map((f) => linkOf(f.name))
    const properties = {
      [FOLDER_PAGE_KEY]: true,
      [SETTINGS_KEY]: { views: [outline, { type: 'table', name: 'Table' }] },
    }
    const abs = path.join(root, `${HOME_NAME}.md`)
    plan.creates.push({ abs, rel: `${HOME_NAME}.md`, content: buildFrontmatter(properties), what: 'Home' })
    plan.home = { created: true, rel: `${HOME_NAME}.md`, order: order.map((f) => f.name) }
  } else {
    plan.home = { created: false, rel: homePage.rel, order: order.map((f) => f.name) }
    if (homePage.properties[FOLDER_PAGE_KEY] !== true && unwritableReason(homePage) === null) {
      addEdit(plan, homePage, FOLDER_PAGE_KEY, true)
      plan.transforms.flag.push({ rel: homePage.rel, why: 'Home is the root of the Topics tree' })
    }
  }

  // The pages the model leaves unparented: no `page_type` to give them one, and no `folder_pages`
  // entry of their own either. Every one of them lands in Uncategorized (🔒 D5 of YAZ-814).
  for (const page of pages) {
    if (page.properties[PAGE_TYPE_KEY] !== undefined) continue
    if (folderPageAbs.has(page.abs) || page.abs === homePage?.abs || unreadable.has(page.abs)) continue
    const entries = finalEntries.get(page.abs) ?? entryList(page.properties[FOLDER_PAGES_KEY])
    plan.noPageType.push({
      rel: page.rel,
      entries: entries.filter((e) => typeof e === 'string' && EXACT_WIKILINK_RE.test(e.trim())),
    })
  }

  // ---- 5. Templates follow the new names (🔒 D4) ------------------------------------------------
  for (const template of scan.templates) {
    const type = path.basename(template).replace(/\.(md|markdown)$/i, '')
    const fp = folderPageOf.get(type)
    if (fp === undefined) continue
    const to = path.join(path.dirname(template), `${fp.name}${path.extname(template)}`)
    if (path.resolve(to) === path.resolve(template)) continue
    if (fs.existsSync(to)) {
      plan.collisions.push({ abs: template, wanted: to, why: 'a template already carries the folder page name' })
      continue
    }
    plan.renames.push({ from: template, to })
  }

  // ---- 6. types.json: extract, then delete (🔒 D4) -----------------------------------------------
  if (registry.present && plan.blockers.length === 0) {
    const declarations = vaultProperties(registry, folderPageOf, plan)
    if (declarations !== null) plan.propertiesWrite = declarations
    plan.deletes.push({ abs: registry.file, why: 'the registry has been extracted into folder pages' })
  }

  // ---- 7. Disk moves (🔒 D5) --------------------------------------------------------------------
  const registryFolders = new Map()
  for (const [type, def] of Object.entries(registry.types)) {
    if (typeof def?.folder === 'string' && FOLDER_NAME.test(def.folder.trim())) registryFolders.set(type, def.folder.trim())
  }
  const wanted = new Map()
  for (const page of pages) {
    if (folderPageAbs.has(page.abs)) continue
    if (KEEP_PREFIXES.some((prefix) => page.rel.startsWith(prefix))) continue
    const segs = page.rel.split('/')
    const type = typeof page.properties[PAGE_TYPE_KEY] === 'string' ? page.properties[PAGE_TYPE_KEY].trim() : undefined
    let destFolder = null
    let why = ''
    if (segs[0] === 'functions' && segs.length > 2) {
      destFolder = type === FUNCTION_TYPE ? 'functions' : 'problems'
      why = type === FUNCTION_TYPE ? 'function pages sit flat in functions/' : 'not a function page — out of the function tree'
    } else if (segs[0] === 'channels' && segs.length > 2) {
      destFolder = (type !== undefined && registryFolders.get(type)) || 'channels'
      why = `the channels/ sub-bins dissolve — ${type ?? 'untyped'} pages belong in ${destFolder}/`
    }
    if (destFolder === null) {
      if (segs[0] === 'functions' && segs.length === 2 && type !== undefined && type !== FUNCTION_TYPE) {
        plan.problems.push(`\`${page.rel}\` is a \`${type}\` page sitting directly in functions/ — 🔒 D5 only dissolves sub-folders, so it was left alone`)
      }
      continue
    }
    const to = path.join(root, destFolder, page.name)
    if (path.resolve(to) === path.resolve(page.abs)) continue
    const key = to.toLowerCase()
    if (claimed.has(key) || wanted.has(key)) {
      plan.collisions.push({
        abs: page.abs,
        wanted: to,
        why: wanted.has(key) ? `another page also wants ${posix(path.relative(root, to))}` : 'the destination name is taken',
      })
      continue
    }
    wanted.set(key, page.abs)
    claimed.delete(page.abs.toLowerCase())
    plan.moves.push({ from: page.abs, to, why })
  }

  // ---- 8. The retired format, and the python nobody runs (🔒 D5) ---------------------------------
  for (const base of scan.baseFiles) plan.deletes.push({ abs: base, why: 'the .base format was retired (YAZ-844)' })
  for (const script of scan.scripts) plan.scriptVerdicts.push(scriptVerdict(script, root))

  return plan
}

/** 🔒 D4's curated Home order: the registered types first, sorted by their registry folder, then the rest. */
function orderedFolderPages(folderPages, registry) {
  const registered = []
  const unregistered = []
  for (const fp of folderPages) (registry.types[fp.type] !== undefined ? registered : unregistered).push(fp)
  const byFolder = (a, b) => {
    const x = a.folder ?? a.name
    const y = b.folder ?? b.name
    return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : 1
  }
  registered.sort(byFolder)
  unregistered.sort((a, b) => (a.name < b.name ? -1 : 1))
  return [...registered, ...unregistered]
}

/**
 * The registry's VAULT-WIDE declarations become `.yaseendraw/properties.json` (the Properties
 * contract). Zero of them is the common case and writes nothing at all; a properties.json that
 * already exists is only ever ADDED to, never replaced.
 */
function vaultProperties(registry, folderPageOf, plan) {
  const problems = []
  const declared = columnsFrom(registry.properties, folderPageOf, registry, problems, 'types.json → vault properties')
  plan.problems.push(...problems)
  const usable = {}
  for (const [name, decl] of Object.entries(declared)) {
    if (!PROPERTY_NAME.test(name)) {
      plan.problems.push(`types.json → vault properties: \`${name}\` is not a snake_case property name — dropped`)
      continue
    }
    usable[name] = decl
  }
  if (Object.keys(usable).length === 0) return null

  const file = path.join(plan.root, CONFIG_DIR, PROPERTIES_FILE)
  let existing = null
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (isRecord(raw)) existing = raw
    } catch (err) {
      plan.blockers.push(`${CONFIG_DIR}/${PROPERTIES_FILE} exists but is not valid JSON (${err.message}) — fix or remove it first`)
      return null
    }
  }
  const merged = { version: 1, ...(existing ?? {}), properties: { ...(isRecord(existing?.properties) ? existing.properties : {}) } }
  const added = []
  for (const [name, decl] of Object.entries(usable)) {
    if (merged.properties[name] !== undefined) {
      plan.problems.push(`${PROPERTIES_FILE} already declares \`${name}\` — the types.json declaration was not applied`)
      continue
    }
    merged.properties[name] = decl
    added.push(name)
  }
  if (added.length === 0) return null
  return { file, content: `${JSON.stringify(merged, null, 2)}\n`, added, existed: existing !== null }
}

const PY_WRITE_RE = /\.write\s*\(|\bopen\s*\([^)]*['"][wax]|yaml\.(safe_)?dump|json\.dump|write_text\s*\(|\.to_csv\s*\(/

/** 🔒 D5: `_scripts/` is neither run nor edited — the report just says whether each one writes `page_type`. */
function scriptVerdict(abs, root) {
  let source = ''
  try {
    source = fs.readFileSync(abs, 'utf8')
  } catch (err) {
    return { rel: posix(path.relative(root, abs)), writes: 'unknown', lines: [], note: `unreadable: ${err.message}` }
  }
  const lines = []
  source.split('\n').forEach((line, i) => {
    if (line.includes(PAGE_TYPE_KEY)) lines.push(i + 1)
  })
  const writes = lines.length > 0 && PY_WRITE_RE.test(source)
  return { rel: posix(path.relative(root, abs)), writes: writes ? 'yes' : 'no', lines, note: '' }
}

/** Everything the plan would change, for the "zero pending changes" claim a second dry run makes. */
function pendingCount(plan) {
  return (
    plan.editsByPath.size +
    plan.creates.length +
    plan.renames.length +
    plan.moves.length +
    plan.deletes.length +
    (plan.propertiesWrite === null ? 0 : 1)
  )
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

function applyPlan(plan) {
  const failures = []

  // Cards first, while every path is still where the scan found it.
  for (const { page, ops } of [...plan.editsByPath.values()].sort((a, b) => (a.page.abs < b.page.abs ? -1 : 1))) {
    let content = page.content
    try {
      for (const op of ops) content = setFrontmatterProperty(content, op.key, op.value)
    } catch (err) {
      failures.push({ rel: page.rel, why: err instanceof FrontmatterWriteError ? err.message : String(err) })
      continue
    }
    if (content !== page.content) fs.writeFileSync(page.abs, content, 'utf8')
  }

  for (const create of plan.creates) {
    if (fs.existsSync(create.abs)) {
      failures.push({ rel: create.rel, why: 'appeared on disk between the plan and the write — left alone' })
      continue
    }
    ensureDir(path.dirname(create.abs))
    fs.writeFileSync(create.abs, create.content, { encoding: 'utf8', flag: 'wx' })
  }

  for (const rename of plan.renames) {
    if (fs.existsSync(rename.to)) {
      failures.push({ rel: posix(path.relative(plan.root, rename.from)), why: 'the rename target appeared on disk — left alone' })
      continue
    }
    fs.renameSync(rename.from, rename.to)
    // A renamed template's CONTENT migrates too (found in the 7D polish pass): its frontmatter
    // still carries the dead keys — `page_type` and the flattened relation seeds — and every page
    // born from it would inherit them. Same dead-line rule the vault scrub used; body untouched.
    const DEAD_TEMPLATE_LINE = /^(page_type:.*|channels: \[\]|functions: \[\]|function: ""|channel: "")$/
    const before = fs.readFileSync(rename.to, 'utf8')
    const after = before
      .split('\n')
      .filter((line) => !DEAD_TEMPLATE_LINE.test(line))
      .join('\n')
    if (after !== before) fs.writeFileSync(rename.to, after)
  }

  for (const move of plan.moves) {
    if (fs.existsSync(move.to)) {
      failures.push({ rel: posix(path.relative(plan.root, move.from)), why: 'the move target appeared on disk — left alone' })
      continue
    }
    ensureDir(path.dirname(move.to))
    fs.renameSync(move.from, move.to)
  }

  if (plan.propertiesWrite !== null) {
    ensureDir(path.dirname(plan.propertiesWrite.file))
    fs.writeFileSync(plan.propertiesWrite.file, plan.propertiesWrite.content, 'utf8')
  }

  for (const del of plan.deletes) if (fs.existsSync(del.abs)) fs.rmSync(del.abs)

  // Emptied bins go last, bottom-up, and only under the two trees D5 dissolves.
  plan.removedDirs = []
  for (const top of ['functions', 'channels']) {
    const dir = path.join(plan.root, top)
    if (fs.existsSync(dir)) pruneEmpty(dir, plan.root, plan.removedDirs, false)
  }
  plan.applyFailures = failures
  return failures
}

/** Removes directories left holding nothing (the `X Cross-Functional` case, generalised). */
function pruneEmpty(dir, root, removed, removeSelf) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmpty(path.join(dir, entry.name), root, removed, true)
  }
  if (!removeSelf) return
  if (fs.readdirSync(dir).length > 0) return
  fs.rmdirSync(dir)
  removed.push(posix(path.relative(root, dir)))
}

// ---------------------------------------------------------------------------
// Post-checks (🔒 D6) — run over an INDEPENDENT re-scan of the applied vault
// ---------------------------------------------------------------------------

function runPostChecks(before, plan) {
  const after = scanVault(plan.root)
  const resolve = makeResolver(after.pages, plan.root)
  const flagged = new Set(after.pages.filter((p) => p.properties[FOLDER_PAGE_KEY] === true).map((p) => p.abs))
  const checks = []

  // (1) zero page_type keys remain
  const leftovers = after.pages.filter((p) => p.properties[PAGE_TYPE_KEY] !== undefined).map((p) => p.rel)
  checks.push({
    name: `no \`${PAGE_TYPE_KEY}\` key remains anywhere`,
    pass: leftovers.length === 0,
    detail: leftovers.map((rel) => `still carries it: ${rel}`),
  })

  // (2) every folder_pages entry WE wrote resolves to a flagged folder page
  const unresolved = []
  for (const { rel, entries } of plan.membershipsWritten) {
    for (const entry of entries) {
      if (typeof entry !== 'string' || !EXACT_WIKILINK_RE.test(entry.trim())) {
        unresolved.push(`${rel}: ${JSON.stringify(entry)} is not a wikilink, so it can never count`)
        continue
      }
      const target = resolve(entry)
      if (target === null) unresolved.push(`${rel}: ${entry} resolves to nothing`)
      else if (!flagged.has(target.abs)) unresolved.push(`${rel}: ${entry} lands on ${target.rel}, which is not a folder page`)
    }
  }
  checks.push({
    name: 'every written `folder_pages` entry resolves to a flagged folder page',
    pass: unresolved.length === 0,
    detail: unresolved,
  })

  // (3) per-folder-page member counts equal the old per-type counts (plus whoever already pointed there)
  const members = new Map()
  for (const page of after.pages) {
    for (const entry of entryList(page.properties[FOLDER_PAGES_KEY])) {
      if (typeof entry !== 'string' || !EXACT_WIKILINK_RE.test(entry.trim())) continue
      const target = resolve(entry)
      if (target === null || !flagged.has(target.abs)) continue
      const held = members.get(target.abs)
      if (held === undefined) members.set(target.abs, new Set([page.abs]))
      else held.add(page.abs)
    }
  }
  const countRows = []
  const countProblems = []
  for (const fp of plan.folderPages) {
    const typed = plan.typeCounts.get(fp.type) ?? 0
    const preExisting = [...(plan.preExistingMembers.get(fp.name.toLowerCase()) ?? new Set())].filter((abs) => {
      const page = before.pages.find((p) => p.abs === abs)
      return page !== undefined && page.properties[PAGE_TYPE_KEY] !== fp.type
    }).length
    const expected = typed + preExisting
    const actual = (members.get(fp.abs) ?? new Set()).size
    countRows.push({ name: fp.name, type: fp.type, typed, preExisting, expected, actual, ok: expected === actual })
    if (expected !== actual) countProblems.push(`${fp.name}: expected ${expected} (${typed} of type \`${fp.type}\` + ${preExisting} pre-existing), found ${actual}`)
  }
  checks.push({
    name: 'per-folder-page member counts equal the old per-type counts',
    pass: countProblems.length === 0,
    detail: countProblems,
    rows: countRows,
  })

  // (4) link integrity — every pre-existing body wikilink still lands on the same basename set
  const movedTo = new Map(plan.moves.map((m) => [m.from, m.to]))
  const afterByPath = new Map(after.pages.map((p) => [p.abs, p]))
  const beforeResolve = makeResolver(before.pages, plan.root)
  const broken = []
  for (const page of before.pages) {
    if (page.bodyLinks.length === 0) continue
    const nowAbs = movedTo.get(page.abs) ?? page.abs
    if (!afterByPath.has(nowAbs)) continue
    const wasSet = page.bodyLinks.map((t) => beforeResolve(t)?.basename ?? null)
    const nowSet = page.bodyLinks.map((t) => resolve(t)?.basename ?? null)
    page.bodyLinks.forEach((target, i) => {
      if (wasSet[i] === nowSet[i]) return
      broken.push(
        `${page.rel}: [[${target}]] used to reach ${wasSet[i] ?? '(nothing)'}, now reaches ${nowSet[i] ?? '(nothing)'}`,
      )
    })
  }
  checks.push({
    name: 'every pre-existing body `[[wikilink]]` still resolves to the same page',
    pass: broken.length === 0,
    detail: broken,
  })

  return checks
}

// ---------------------------------------------------------------------------
// The report (🔒 D6)
// ---------------------------------------------------------------------------

const bullet = (xs) => (xs.length === 0 ? ['- _(none)_'] : xs.map((x) => `- ${x}`))

function renderReport(plan, scan, { apply, checks }) {
  const out = []
  const push = (...lines) => out.push(...lines)

  push('# Folder-page migration report', '')
  push(`- **Vault**: \`${plan.root}\``)
  push(`- **Mode**: ${apply ? '`--apply` — the changes below were written' : 'dry run (the DEFAULT) — nothing was written'}`)
  push(`- **Generated**: ${new Date().toISOString()}`)
  push(`- **Script**: \`tools/migrateFolderPages.mjs\``)
  push('')

  push('## Summary', '')
  push('| What | Count |', '| --- | ---: |')
  push(`| Markdown pages scanned | ${scan.pages.length} |`)
  push(`| Distinct \`page_type\` values | ${plan.typeCounts.size} |`)
  push(`| Pages with no \`page_type\` (→ Uncategorized) | ${plan.noPageType.length} |`)
  push(`| Cards edited | ${plan.editsByPath.size} |`)
  push(`| \`${PAGE_TYPE_KEY}\` → \`${FOLDER_PAGES_KEY}\` | ${plan.transforms.pageType.length} |`)
  push(`| \`${CHANNELS_KEY}\` merged and deleted | ${plan.transforms.channels.length} |`)
  push(`| \`${FUNCTIONS_KEY}\` merged and deleted | ${plan.transforms.functions.length} |`)
  push(`| \`${FUNCTION_TEXT_KEY}\` (text) deleted | ${plan.transforms.functionText.length} |`)
  push(`| \`${FUNCTION_TEXT_KEY}\` (text) KEPT — no links field | ${plan.textOnlyFunction.length} |`)
  push(`| Memberships written | ${plan.membershipsWritten.length} |`)
  push(`| Pages newly flagged \`${FOLDER_PAGE_KEY}: true\` | ${plan.transforms.flag.length} |`)
  push(`| Folder pages created | ${plan.folderPages.filter((f) => f.created).length} |`)
  push(`| Folder pages adopted (already existed) | ${plan.adopted.length} |`)
  push(`| Templates renamed | ${plan.renames.length} |`)
  push(`| Files moved | ${plan.moves.length} |`)
  push(`| Files deleted | ${plan.deletes.length} |`)
  push(`| Name collisions — STOPPED | ${plan.collisions.length} |`)
  push(`| Pages skipped | ${plan.skipped.length} |`)
  push(`| \`_scripts/\` python inspected | ${plan.scriptVerdicts.length} |`)
  push(`| **Pending changes** | **${pendingCount(plan)}** |`)
  push('')

  if (plan.blockers.length > 0) {
    push('## Blockers', '', 'Nothing can be applied until these are resolved.', '')
    push(...bullet(plan.blockers))
    push('')
  }

  push('## Plural names', '', `How each \`${PAGE_TYPE_KEY}\` value became a folder page name.`, '')
  push('| `page_type` | Folder page | Named from | Registered | Pages |', '| --- | --- | --- | --- | ---: |')
  for (const m of plan.pluralMapping) {
    push(`| \`${m.type}\` | ${m.name} | ${m.source} | ${m.registered ? 'yes' : 'no'} | ${m.count} |`)
  }
  push('')
  push(
    `The irregulars map (used only where the registry declared neither a \`pluralName\` nor a \`displayName\`): ${Object.entries(
      IRREGULAR_PLURALS,
    )
      .map(([k, v]) => `\`${k}\` → ${v}`)
      .join(', ')}.`,
    '',
  )

  push('## Folder pages', '')
  for (const fp of plan.folderPages) {
    push(`### ${fp.name} — \`${fp.rel}\` ${fp.created ? '(created)' : '(adopted, already existed)'}`, '')
    push(`- from \`${PAGE_TYPE_KEY}: ${fp.type}\` · ${fp.count} page${fp.count === 1 ? '' : 's'}`)
    push(`- \`${FOLDER_PAGE_KEY}: true\`${fp.created ? `, \`${FOLDER_PAGES_KEY}: ["[[${HOME_NAME}]]"]\`` : ''}`)
    if (fp.folder !== undefined) push(`- \`${SETTINGS_KEY}.folder\`: \`${fp.folder}\``)
    const columns = Object.entries(fp.columns)
    if (columns.length === 0) push(`- \`${SETTINGS_KEY}.columns\`: _(none — the type declared no properties)_`)
    else {
      push(`- \`${SETTINGS_KEY}.columns\`:`)
      for (const [name, decl] of columns) {
        const extras = [decl.target ? `target \`${decl.target}\`` : null, decl.required ? 'required' : null].filter(Boolean)
        push(`  - \`${name}\`: ${decl.kind}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`)
      }
    }
    push('')
  }
  if (plan.folderPages.length === 0) push('_(none — no `page_type` values were found)_', '')

  push('## Home', '')
  if (plan.home === null) push('_(not computed)_', '')
  else {
    push(
      plan.home.created
        ? `Created \`${plan.home.rel}\` — \`${FOLDER_PAGE_KEY}: true\` with an outline whose \`order\` lists the folder pages below.`
        : `\`[[${HOME_NAME}]]\` already resolves to \`${plan.home.rel}\` — nothing was created (Home is IDENTITY, not a path).`,
      '',
    )
    push(...bullet(plan.home.order.map((name) => `\`[[${name}]]\``)))
    push('')
  }

  push(`## Pages touched — \`${PAGE_TYPE_KEY}\` → \`${FOLDER_PAGES_KEY}\` (${plan.transforms.pageType.length})`, '')
  push(...bullet(plan.transforms.pageType.map((t) => `\`${t.rel}\` — \`${t.type}\` → \`[[${t.into}]]\``)))
  push('')

  push(`## Pages touched — \`${CHANNELS_KEY}\` merged (${plan.transforms.channels.length})`, '')
  push(...bullet(plan.transforms.channels.map((t) => `\`${t.rel}\` — ${t.entries.map((e) => JSON.stringify(e)).join(', ') || '_(empty)_'}`)))
  push('')

  push(`## Pages touched — \`${FUNCTIONS_KEY}\` merged (${plan.transforms.functions.length})`, '')
  push(...bullet(plan.transforms.functions.map((t) => `\`${t.rel}\` — ${t.entries.map((e) => JSON.stringify(e)).join(', ') || '_(empty)_'}`)))
  push('')

  push(`## Pages touched — \`${FUNCTION_TEXT_KEY}\` (text) deleted (${plan.transforms.functionText.length})`, '')
  push(...bullet(plan.transforms.functionText.map((t) => `\`${t.rel}\` — was ${JSON.stringify(t.value)}`)))
  push('')

  push(`## Text-only \`${FUNCTION_TEXT_KEY}:\` pages KEPT (${plan.textOnlyFunction.length})`, '')
  push(`These have no \`${FUNCTIONS_KEY}:\` links field, so nothing carried their data — the text stays put (🔒 D3).`, '')
  push(...bullet(plan.textOnlyFunction.map((t) => `\`${t.rel}\` — ${JSON.stringify(t.value)}`)))
  push('')

  push(`## Newly flagged \`${FOLDER_PAGE_KEY}: true\` (${plan.transforms.flag.length})`, '')
  push(...bullet(plan.transforms.flag.map((t) => `\`${t.rel}\` — ${t.why}`)))
  push('')

  push(`## Memberships written (${plan.membershipsWritten.length})`, '')
  push(...bullet(plan.membershipsWritten.map((m) => `\`${m.rel}\` → ${m.entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join(', ')}`)))
  push('')

  push(`## Templates renamed (${plan.renames.length})`, '')
  push(
    ...bullet(
      plan.renames.map((r) => `\`${posix(path.relative(plan.root, r.from))}\` → \`${posix(path.relative(plan.root, r.to))}\``),
    ),
  )
  push('')

  push(`## Files moved (${plan.moves.length})`, '')
  push(
    ...bullet(
      plan.moves.map(
        (m) => `\`${posix(path.relative(plan.root, m.from))}\` → \`${posix(path.relative(plan.root, m.to))}\` — ${m.why}`,
      ),
    ),
  )
  push('')

  push(`## Files deleted (${plan.deletes.length})`, '')
  push(...bullet(plan.deletes.map((d) => `\`${posix(path.relative(plan.root, d.abs))}\` — ${d.why}`)))
  push('')

  if (apply) {
    push(`## Directories removed (${plan.removedDirs?.length ?? 0})`, '')
    push(...bullet((plan.removedDirs ?? []).map((d) => `\`${d}\``)))
    push('')
  }

  push(`## \`${CONFIG_DIR}/${PROPERTIES_FILE}\``, '')
  if (plan.propertiesWrite === null) {
    push(`_(nothing to write — types.json declared no usable vault-wide properties)_`, '')
  } else {
    push(
      `${plan.propertiesWrite.existed ? 'Merged into the existing file' : 'Written'}: ${plan.propertiesWrite.added
        .map((n) => `\`${n}\``)
        .join(', ')}`,
      '',
    )
  }

  push(`## Name collisions — STOPPED (${plan.collisions.length})`, '')
  push('Nothing is ever overwritten: each of these files stayed exactly where it was.', '')
  push(
    ...bullet(
      plan.collisions.map(
        (c) => `\`${posix(path.relative(plan.root, c.abs))}\` ↛ \`${posix(path.relative(plan.root, c.wanted))}\` — ${c.why}`,
      ),
    ),
  )
  push('')

  push(`## Pages skipped (${plan.skipped.length})`, '')
  push(...bullet(plan.skipped.map((s) => `\`${s.rel}\` — ${s.why}`)))
  push('')

  push(`## Pages with no \`${PAGE_TYPE_KEY}\` → Uncategorized (${plan.noPageType.length})`, '')
  push('These belong nowhere until somebody gives them a `folder_pages` entry.', '')
  push(
    ...bullet(
      plan.noPageType.map(
        (p) => `\`${p.rel}\`${p.entries.length > 0 ? ` — but already names ${p.entries.join(', ')}` : ''}`,
      ),
    ),
  )
  push('')

  push(`## \`${SCRIPTS_DIR}/\` verdicts (${plan.scriptVerdicts.length})`, '')
  push('Never run and never modified by this script — updating or retiring them is a separate, human step.', '')
  push('| Script | Writes `page_type`? | Mentions at lines |', '| --- | --- | --- |')
  for (const v of plan.scriptVerdicts) {
    push(`| \`${v.rel}\` | ${v.writes}${v.note ? ` (${v.note})` : ''} | ${v.lines.length > 0 ? v.lines.join(', ') : '—'} |`)
  }
  if (plan.scriptVerdicts.length === 0) push('| _(none)_ | — | — |')
  push('')

  if (plan.problems.length > 0) {
    push('## Notes', '')
    push(...bullet(plan.problems))
    push('')
  }

  if (apply) {
    push('## Post-checks', '')
    if (plan.applyFailures?.length > 0) {
      push(`**${plan.applyFailures.length} write(s) failed and were skipped:**`, '')
      push(...bullet(plan.applyFailures.map((f) => `\`${f.rel}\` — ${f.why}`)))
      push('')
    }
    for (const check of checks ?? []) {
      push(`### ${check.pass ? 'PASS' : 'FAIL'} — ${check.name}`, '')
      if (check.rows) {
        push('| Folder page | `page_type` | Typed pages | Pre-existing | Expected | Found | |', '| --- | --- | ---: | ---: | ---: | ---: | --- |')
        for (const r of check.rows) {
          push(`| ${r.name} | \`${r.type}\` | ${r.typed} | ${r.preExisting} | ${r.expected} | ${r.actual} | ${r.ok ? 'ok' : '**MISMATCH**'} |`)
        }
        push('')
      }
      if (check.detail.length > 0) {
        push(...bullet(check.detail))
        push('')
      } else if (!check.rows) push('_(nothing to report)_', '')
    }
  } else {
    push('## Next', '')
    push(
      pendingCount(plan) === 0
        ? 'Nothing is pending — this vault is already migrated. A re-run changes nothing.'
        : 'Re-run with `--apply` to write the changes above. The post-checks run straight afterwards and are appended here.',
      '',
    )
  }

  return out.join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `Usage: node tools/migrateFolderPages.mjs --vault <path> [--apply]

  --vault <path>   the vault to migrate (must be a git repo with a clean tree)
  --apply          write the changes; without it this is a DRY RUN (the default)
  --dry-run        explicit no-op form of the default
  -h, --help       this message

The report is printed and written to <vault>/${REPORT_FILE}.`

export function parseArgs(argv) {
  const options = { vault: null, apply: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') options.apply = true
    else if (arg === '--dry-run') options.apply = false
    else if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--vault') options.vault = argv[++i] ?? null
    else if (arg.startsWith('--vault=')) options.vault = arg.slice('--vault='.length)
    else return { error: `unknown argument: ${arg}` , ...options }
  }
  return options
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  if (options.error) {
    console.error(`${options.error}\n\n${USAGE}`)
    return 1
  }
  if (!options.vault) {
    console.error(`--vault is required.\n\n${USAGE}`)
    return 1
  }
  const root = path.resolve(options.vault)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`Not a directory: ${root}`)
    return 1
  }

  const dirt = gitDirtReason(root)
  if (dirt !== null) {
    console.error(`REFUSING TO RUN — ${dirt}\n\nCommit or stash first: this migration's undo button is \`git checkout .\`.`)
    return 1
  }

  const scan = scanVault(root)
  const plan = buildPlan(scan)

  if (plan.blockers.length > 0 && options.apply) {
    console.error(`REFUSING TO APPLY — the plan has ${plan.blockers.length} blocker(s):`)
    for (const blocker of plan.blockers) console.error(`  · ${blocker}`)
    return 1
  }

  let checks = null
  if (options.apply) {
    // Re-verify immediately before the first write: the scan above took time, and the tree must
    // still be the one the user committed.
    const stillClean = gitDirtReason(root)
    if (stillClean !== null) {
      console.error(`REFUSING TO APPLY — ${stillClean}`)
      return 1
    }
    applyPlan(plan)
    checks = runPostChecks(scan, plan)
  }

  const report = renderReport(plan, scan, { apply: options.apply, checks })
  fs.writeFileSync(path.join(root, REPORT_FILE), `${report}\n`, 'utf8')
  console.log(report)
  console.log(`\nReport written to ${path.join(root, REPORT_FILE)}`)

  if (options.apply) {
    const failed = (checks ?? []).filter((c) => !c.pass)
    if (failed.length > 0 || (plan.applyFailures?.length ?? 0) > 0) {
      console.error(`\n${failed.length} post-check(s) FAILED — see the report.`)
      return 1
    }
  } else if (plan.blockers.length > 0) {
    return 1
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main()
}
