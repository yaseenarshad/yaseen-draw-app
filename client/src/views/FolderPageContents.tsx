/**
 * The folder page's contents block (YAZ-819; decisions D1-D3 of YAZ-818, LOCKED). A page flagged
 * `folder_page: true` renders its members BELOW its own body — today's fully interactive views
 * view, fed the pages that belong to it, configured by the folder page's own card.
 *
 *  - PLACEMENT (🔒 D1): the THIRD block inside the note's scroller — `.editor-mount`, then this,
 *    then "Linked mentions" — so it scrolls WITH the note, exactly like backlinks (Editor rule
 *    25). Same content column, its own CSS file. No chip and no title row of its own: the page's
 *    NAME is block zero (⚡ YAZ-888), and a folder page adds nothing to that.
 *  - ROWS (🔒 D2): `folderPagesLookup(records, resolve).pagesIn(thisPath)` — the members, and
 *    nothing else. NEVER a `folder_pages.contains(link(…))` filter, which compares link targets
 *    as raw text and would silently disagree with what clicking the same link does ("Links":
 *    Folder pages, D1). The engine runs over the members but resolves through the WHOLE-vault
 *    resolver (`RunOptions.resolve`), so a link cell pointing outside them still resolves.
 *  - THE ADAPTER (🔒 D3): ViewsPane stays ONE component. This host builds a def in memory from
 *    `folderPageSettings(record).views`, hands it over as a `ParsedViews`, and turns every def
 *    change back into ONE `folder_page_settings` write through the one door
 *    (`writeFolderPageSettings` → `writeProperty` → the note's open editor absorbs it). Cell
 *    edits are untouched: `EditableCell` writes the MEMBER's own card, as it always has.
 *
 * Which view is active is SESSION state (ViewsPane's own `active`), never written to the card —
 * but the tabs themselves are EDITABLE since YAZ-1471 re-ruled 🔒 rule 4: reorder, rename,
 * duplicate, delete and "+" each land as ONE `folder_page_settings` write through D3's one door.
 * Feed: the window's ONE `WikilinkResolveSource` (App-owned, fed by `WikilinkIndexBridge`) — the
 * same snapshot backlinks read, so this block can never disagree with the links above it, and it
 * costs no fetch, no watcher and no IPC of its own.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDecl } from './folderPageSettings'
import { stringify } from 'yaml'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import type { WikilinkNav } from '../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { folderPagesLookup, isFolderPage } from '../links/folderPages'
import { type ParsedViews, type ViewDef, type ViewSet, parseViews } from './viewSchema'
import { ViewsPane, type FolderPageMode } from './ViewsPane'
import { splitFrontmatter, parseFrontmatter } from '@shared/frontmatter'
import { DEFAULT_VIEWS, folderPageSettings, folderPageSettingsOf, writeFolderPageSettings, writeFolderColumn, type FolderPageSettings } from './folderPageSettings'
import { backfillFolderPageColumns } from './folderPageColumns'
import { deleteColumn as deleteColumnEverywhere } from './deleteColumn'
import { createNewNote, freeName, type NewNoteSeed } from './newNote'
import { memberFolder, newPageFromFolderPage } from './scaffold'
import './views.css'
import './folderPageContents.css'

export interface FolderPageContentsProps {
  /** The open note. Renders NOTHING unless this record carries the strict `folder_page: true` flag. */
  path: string
  /** Vault root: the parking folder and the template read hang off it. */
  root: string
  /** The window's link feed — the full-vault resolver AND the snapshot it was built from. */
  source: WikilinkResolveSource
  /**
   * The vault-wide property declarations (`useProperties`, App-owned like `wikilinks` and fed
   * through `Editor`): the editor ladder's RUNG 2, wired in YAZ-846. null until the fetch
   * resolves, and a corrupt `properties.json` arrives as a `properties.error` the view reports
   * passively — an undeclared column simply keeps falling through to the value inference.
   */
  properties?: PropertiesResponse | null
  /** A row link opens the member; the create opens the new page. */
  onOpenFile: (path: string) => void
  /** Table/Board page actions open the exact member in the window's right panel. */
  onOpenFileRight?: (path: string) => void
  /** ⌘-click on an outline row (YAZ-820) — the window's background-tab open; absent → opens in place. */
  onOpenFileBackground?: (path: string) => void
  /**
   * The rest of the outline editor's wikilink wiring (YAZ-903), threaded from the SAME `Editor`
   * mount that hands it to the note's own Crepe instance — `source` above is the first piece:
   * the `[[` picker feed (Links B), then the two halves of the click-navigation contract this
   * host cannot derive (where a bare unresolved link creates its page, C2- — resolved against
   * THIS folder page's own path, YAZ-1643 — and where a create failure is reported).
   */
  wikilinkCandidates?: WikilinkCandidateSource
  newNoteFolderFor?: (sourcePath: string) => string
  onNotice?: (message: string) => void
  /**
   * The open file's OWN bytes, from the same read the editor mounted with (YAZ-919). The views
   * SEED prefers these over the index snapshot: the body migration rewrites the file before the
   * first paint, and the index echo only lands after it — a seed from the stale snapshot showed
   * the old outline, and the first commit wrote it back, erasing the migrated text. Every LATER
   * update still follows the index (the stamp reconcile), which catches up to these very bytes.
   */
  fileContent?: string
}

const NONE: IndexRecord[] = []

/** The resolver and the records it was built from, always read together (BacklinksSection's idiom). */
interface Feed {
  records: readonly IndexRecord[]
  resolve: ResolveLink | null
}

/**
 * The def ViewsPane edits, built IN MEMORY from the settings' views (🔒 D3) — nothing on disk
 * stands behind it but the note's own card. The round trip through the ONE parser is deliberate: `ParsedViews`
 * carries the yaml Document every config edit is written into (`updateViews`), so it has to be a
 * real parse. No `filters` are ever put in: a folder page's set IS the lookup (🔒 Q3, YAZ-815).
 *
 * The settings' `formulas` come in beside them (YAZ-745): `formula.<name>` is a column, a sort and
 * a GROUPING LEVEL, all read off `def.formulas` — so a folder page whose formulas stopped at the
 * settings could declare a level the engine could only answer `unknown formula` to. The column
 * LABELS ride in the same way (YAZ-1513): `def.properties` is what every header reads, and the
 * Properties menu's pencil and the table header's rename both edit it through `onUpdate`.
 */
function folderPageViewSet({ views, formulas, properties, defaultView }: FolderPageSettings): ParsedViews {
  try {
    return parseViews(stringify({ formulas, properties, views, defaultView })) // `stringify` skips undefined keys
  } catch {
    // Report-don't-block: a hand-edited view YAML cannot take the note's editor down with it —
    // the page still renders, on the defaults it would have had with no settings at all.
    return parseViews(stringify({ views: DEFAULT_VIEWS.map((view) => ({ ...view })) }))
  }
}

/** Order-insensitive identity for a columns map: the index re-reads what we wrote, key order and all, but never trust that. */
const columnsStamp = (columns: Readonly<Record<string, ColumnDecl>>): string =>
  JSON.stringify(Object.keys(columns).sort().map((key) => [key, Object.entries(columns[key]).sort(([a], [b]) => (a < b ? -1 : 1))]))

export function FolderPageContents({
  path,
  root,
  source,
  properties = null,
  onOpenFile,
  onOpenFileRight,
  onOpenFileBackground,
  wikilinkCandidates,
  newNoteFolderFor,
  onNotice,
  fileContent,
}: FolderPageContentsProps) {
  // Subscribe once, re-read the whole feed on each poke; an unchanged snapshot keeps the previous
  // object, so index churn elsewhere in the vault costs no render (BacklinksSection's idiom).
  const [feed, setFeed] = useState<Feed>(() => ({ records: source.records, resolve: source.resolve }))
  useEffect(() => {
    const read = () =>
      setFeed((prev) =>
        prev.records === source.records && prev.resolve === source.resolve ? prev : { records: source.records, resolve: source.resolve },
      )
    read()
    return source.subscribe(read)
  }, [source])

  const record = useMemo(() => feed.records.find((r) => r.path === path) ?? null, [feed.records, path])
  /** null = not a folder page (or no snapshot yet): this block renders nothing at all. */
  const settings = useMemo(() => (record !== null && isFolderPage(record) ? folderPageSettings(record) : null), [record])
  const members = useMemo(
    () => (settings === null || feed.resolve === null ? NONE : folderPagesLookup(feed.records, feed.resolve).pagesIn(path)),
    [settings, feed, path],
  )

  /**
   * The outline editor's click navigation (YAZ-903), assembled EXACTLY as `Editor` assembles the
   * note's own — same contract, same defaults, wired only when the window threads the
   * background opener. Memoised because the editor remounts on a new identity (YAZ-901), and
   * every input here is App-stable.
   */
  const nav = useMemo<WikilinkNav | undefined>(
    () =>
      onOpenFileBackground === undefined
        ? undefined
        : {
            root,
            createFolder: () => newNoteFolderFor?.(path) ?? '',
            openCurrent: onOpenFile,
            openBackground: onOpenFileBackground,
            onNotice: onNotice ?? (() => undefined),
          },
    [root, path, newNoteFolderFor, onOpenFile, onOpenFileBackground, onNotice],
  )

  // The SEED prefers the open file's own bytes (YAZ-919, `fileContent` above): the migration
  // rewrote them before this mount, and the snapshot's echo lands after the first paint. The
  // stamp reconcile below still follows the index — which catches up to exactly these bytes.
  const fileSettings = useMemo(() => {
    if (fileContent === undefined) return null
    return folderPageSettingsOf(parseFrontmatter(splitFrontmatter(fileContent).frontmatter).properties)
  }, [fileContent])
  const [parsed, setParsed] = useState<ParsedViews | null>(() => {
    const seed = fileSettings ?? settings
    return seed === null ? null : folderPageViewSet(seed)
  })
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [columnError, setColumnError] = useState<string | null>(null)

  /**
   * The declarations AHEAD of the index (YAZ-1549) — `parsed`'s discipline for `views`, applied to
   * `columns`: every `setColumn` / `setColumns` write lands here first, a rejection puts back what
   * stood before it (and the banner says why), and the index echo that carries the same columns
   * clears it. Null = the index leads. `liveSettings` below is what every consumer reads — the menus'
   * spreads, the `base` a declaration write is checked against, the presence invariant's walk — so a
   * column added a moment ago can neither be dropped by the next write nor re-added by a member echo
   * that arrives before the folder page's own.
   */
  const [ahead, setAheadState] = useState<Record<string, ColumnDecl> | null>(null)
  const aheadRef = useRef<Record<string, ColumnDecl> | null>(null)
  const setAhead = (next: Record<string, ColumnDecl> | null): void => {
    aheadRef.current = next
    setAheadState(next)
  }
  const indexColumns = settings === null ? '' : columnsStamp(settings.columns)
  useEffect(() => {
    if (aheadRef.current !== null && indexColumns === columnsStamp(aheadRef.current)) setAhead(null)
  }, [indexColumns])
  const liveSettings = useMemo(
    () => (settings === null ? null : ahead === null ? settings : { ...settings, columns: ahead }),
    [settings, ahead],
  )

  /**
   * The open-folder half of YAZ-999's hybrid invariant. Settings/membership stay the source of
   * truth; once either snapshot moves, reconcile its current DIRECT members. The service rechecks
   * latest file bytes, so a stale index can only cost a no-op read — never an overwrite.
   */
  useEffect(() => {
    if (liveSettings === null) return
    let current = true
    const clearOnSuccess = columnError !== null
    backfillFolderPageColumns(members, liveSettings.columns).then(
      () => {
        if (current && clearOnSuccess) setColumnError(null)
      },
      (err: unknown) => {
        if (current) setColumnError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => {
      current = false
    }
  }, [members, liveSettings])

  /** The comparable tuple every stamp below is spelled as — everything `folderPageViewSet` builds: views, formulas, labels (YAZ-1513) and the saved START. */
  const stampOf = (s: Pick<FolderPageSettings, 'views' | 'formulas' | 'properties' | 'defaultView'>): string =>
    JSON.stringify([s.views, s.formulas ?? null, s.properties ?? null, s.defaultView ?? null])
  // Rebuilt when the CARD's own views move — an external edit, or our own write coming back
  // through the index (identical then, since `onChange` already applied it). JSON identity is the
  // honest comparison: every read hands back a fresh copy of the views.
  //
  // A FILE-SEEDED mount (YAZ-919) treats the index as THE PAST while it still says what it said
  // AT MOUNT — that stale snapshot is the one that clobbered migrated text. Its FIRST movement
  // is, by construction, the open file's own echo or something newer (a settings write made
  // straight after opening jumps the index PAST the seed's bytes — waiting for an exact match
  // gated the card shut forever: the add-a-column-then-never-see-it bug). So the first movement
  // ends the past and is itself adopted.
  // Both halves of what `folderPageViewSet` builds, so an edited FORMULA rebuilds the def exactly
  // as an edited view does — and the two stamps stay comparable, which the catch-up below needs.
  const stamp = settings === null ? '' : stampOf(settings)
  const fileStamp = fileSettings === null ? null : stampOf(fileSettings)
  const caughtUp = useRef(fileStamp === null) // no file seed → the index led from the start
  /** The one stale snapshot this mount opened over — recorded on first sight, never trusted. */
  const pastStamp = useRef<string | null>(null)
  const seen = useRef(fileStamp ?? stamp) // what the state above was built from: no rebuild on mount
  /**
   * Stamps of `onChange` writes whose index echoes are still in flight (YAZ-1241). Echoes come
   * back in write order, so an arriving snapshot found in this queue is OUR OWN stale write —
   * `parsed` already holds a state at least as new, and rebuilding from it would hand a menu
   * mid-edit an older def to edit (the two-gestures-in-a-second data loss YAZ-1234 caught).
   * Consuming one drains everything before it, so a coalesced index emit still matches.
   */
  const pending = useRef<string[]>([])
  useEffect(() => {
    if (!caughtUp.current) {
      if (stamp === '') return // nothing fed yet — nothing to judge
      if (stamp !== fileStamp) {
        // Between the migration's write and its echo the disk had exactly ONE earlier state, so
        // the first snapshot that is not the seed IS the past; a second DIFFERENT one can only
        // be the echo of a later write — our own settings write jumping the index PAST the
        // seed's bytes (waiting for an exact seed match here gated the card shut forever: the
        // add-a-column-then-never-see-it bug).
        if (pastStamp.current === null || stamp === pastStamp.current) {
          pastStamp.current = stamp
          return
        }
      }
      caughtUp.current = true // the seed's own echo, or something newer: the index leads now
    }
    if (seen.current === stamp) return
    const echo = pending.current.indexOf(stamp)
    if (echo !== -1) {
      pending.current.splice(0, echo + 1)
      seen.current = stamp // a replayed emit of this state must no-op above, not read as external
      return
    }
    pending.current = [] // a real external edit outranks every unechoed local write: disk wins
    seen.current = stamp
    setParsed(settings === null ? null : folderPageViewSet(settings))
  }, [stamp, settings, fileStamp])

  if (record === null || settings === null || liveSettings === null || parsed === null) return null

  /**
   * The declarations' ONE write (YAZ-895/1549): ahead first, then disk; a refusal puts the ahead copy
   * back, shows the banner and REJECTS — so a caller that must not go on (a column delete's member
   * strips) does not.
   */
  const commitSettings = (columns: Record<string, ColumnDecl>, views: ViewDef[], properties: ViewSet['properties']): Promise<void> => {
    setSettingsError(null)
    const before = aheadRef.current
    setAhead(columns)
    return writeFolderPageSettings(path, { ...settings, columns, views, properties, defaultView: parsed.def.defaultView }).then(
      () => undefined,
      (err: unknown) => {
        setAhead(before)
        setSettingsError(err instanceof Error ? err.message : String(err))
        throw err
      },
    )
  }

  /** Every config change (sort, columns, widths, summaries…) is ONE settings write (🔒 D3). */
  const onChange = (next: ParsedViews): void => {
    setParsed(next)
    setSettingsError(null)
    // What this write will stamp as when the index returns it (YAZ-1241) — formulas ride unchanged;
    // the labels are the DEF's (YAZ-1513), since a rename is one of the edits that lands here.
    pending.current.push(stampOf({ views: next.def.views, formulas: settings.formulas, properties: next.def.properties, defaultView: next.def.defaultView }))
    writeFolderPageSettings(path, { ...settings, views: next.def.views, properties: next.def.properties, defaultView: next.def.defaultView }).catch((err: unknown) =>
      setSettingsError(err instanceof Error ? err.message : String(err)),
    )
  }

  const mode: FolderPageMode = {
    settings: liveSettings,
    vaultRecords: feed.records,
    create: (seed, name) => createMember(root, record.basename, path, settings, feed.records, seed, name),
    // ONE declaration, ahead first (YAZ-1549): the panel sees it at once; a refusal puts back what
    // stood before and rejects to the caller, whose inline text is the report.
    setColumn: (key, next, base) => {
      const before = aheadRef.current
      setAhead({ ...liveSettings.columns, [key]: next })
      return writeFolderColumn(path, key, next, base).catch((err: unknown) => {
        setAhead(before)
        throw err
      })
    },
    // `settings` is the index SNAPSHOT, so it can be behind: `parsed` is rebuilt from it and is
    // otherwise ahead by unechoed local writes. Reading the def instead keeps an in-flight
    // default-view choice — or sort/filter edit, when the caller moves no `views` — from being
    // clobbered by the next column write (YAZ-1471 D4; YAZ-1234's two-gestures data loss). No
    // `pending` stamp: this echo must still read as "disk wins" and refresh `parsed` with the
    // `views` the caller moved.
    // The labels follow the same rule as the views: the caller's when it speaks, else the LIVE def's
    // (YAZ-1513). Fire-and-forget — the banner is the report; the delete below awaits the door itself.
    setColumns: (columns, views, labels) => {
      void commitSettings(columns, views ?? parsed.def.views, labels === undefined ? parsed.def.properties : labels.properties).catch(() => undefined)
    },
    // Delete column (YAZ-1513): the settings half is `commitSettings` — the same one door, the same
    // echo behaviour — AWAITED, so a refused write aborts before any member is touched; the member
    // strips report into the column banner, no rollback, exactly as the presence invariant's own
    // failures do.
    deleteColumn: (key) =>
      deleteColumnEverywhere(key, {
        columns: liveSettings.columns,
        def: parsed.def,
        members,
        writeSettings: commitSettings,
      }).catch((err: unknown) => setColumnError(err instanceof Error ? err.message : String(err))),
    openRight: onOpenFileRight,
    openBackground: onOpenFileBackground,
    onNotice,
    wikilinks: source,
    wikilinkCandidates,
    nav,
  }
  const visibleError = settingsError ?? columnError

  return (
    <section className="folder-page-contents">
      {visibleError !== null && (
        <p className="views-pane__error" role="alert">
          Could not update the folder page: {visibleError}
        </p>
      )}
      <ViewsPane
        parsed={parsed}
        onChange={onChange}
        root={root}
        thisFile={path}
        records={members}
        properties={properties}
        onOpenFile={onOpenFile}
        folderPage={mode}
      />
    </section>
  )
}

/**
 * Birth from a folder page (🔒 Q5/Q6, YAZ-815): the declaration is the schema, `folder_pages`
 * lands LAST, and the page is an ORDINARY one — the flag is never born here. Parking is the
 * settings' `folder` (created level by level), and without one the page lands beside the folder
 * page itself. The create is the existing atomic content-at-create path.
 *
 * The name is the `Untitled` scheme by default — EXCEPT when the caller already knows what the
 * page is called (YAZ-943's inline board add types one). A typed name is tamed first: a '/' would
 * park the page somewhere else entirely, so it becomes a space, and a name that is nothing but
 * whitespace is no name at all and falls back to `Untitled`. Either way the same de-duplication
 * runs over the folder's basenames, so a typed collision steps to " 2" like everything else.
 */
async function createMember(
  root: string,
  folderPageName: string,
  folderPagePath: string,
  settings: FolderPageSettings,
  records: readonly IndexRecord[],
  seed: NewNoteSeed,
  name?: string,
): Promise<string> {
  const parts = await newPageFromFolderPage(root, folderPageName, settings, seed.properties)
  const dir = await memberFolder(root, folderPagePath, settings)
  const taken = new Set(records.filter((r) => r.path.slice(0, r.path.lastIndexOf('/')) === dir).map((r) => r.basename))
  const tamed = (name ?? '').replaceAll('/', ' ').trim()
  const target = `${dir}/${freeName(tamed === '' ? 'Untitled' : tamed, taken)}.md`
  await createNewNote(target, parts.properties, parts.body)
  return target
}
