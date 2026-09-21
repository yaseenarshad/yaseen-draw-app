import { boardOptionGroups } from './boardOptionGroups'
import { columnTyping } from './editorType'
import { useEffect, useMemo, useState } from 'react'
import { MAX_COLLAPSED_GROUP_KEYS, type IndexRecord, type PropertiesResponse } from '@shared/types'
import type { WikilinkNav } from '../editor/wikilink/wikilinkClick'
import type { WikilinkCandidateSource } from '../editor/wikilink/wikilinkPicker'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { storage } from '../lib/storage'
import { type ViewSet, type ViewDef, type ParsedViews, parseViews, serializeViews, updateViews } from './viewSchema'
import { type Group, type Row, propertyKeys, resolverFor, runView } from './engine'
import { equals, fromYaml, render } from './expr'
import type { ColumnDecl, FolderPageSettings } from './folderPageSettings'
import { type NewNoteSeed, deriveSeed, freeName } from './newNote'
import { writeProperties, writeProperty } from './writeProperty'
import { BoardView } from './view/BoardView'
import { CardsView } from './view/CardsView'
import { canonicalKey } from './view/keys'
import { type GroupDrop, type GroupSpot, type GroupSwap, type PendingMove, applyMoves, groupByKey } from './view/groupDrag'
import { groupKeyOf, nestedGroupKeyOf } from './view/GroupHeader'
import { ListView } from './view/ListView'
import { OutlineView } from './view/OutlineView'
import { TableView } from './view/TableView'
import { Toolbar } from './view/Toolbar'
import { type ViewTabsProps, viewTypeLabel } from './view/ViewTabs'

/**
 * Folder-page contents mode (🔒 D3, YAZ-819). ViewsPane stays ONE component: the folder-page host
 * (`FolderPageContents`) hands it an in-memory def and this bundle, and everything below is
 * today's code. REQUIRED since YAZ-846 — the contents block is the only mount there is.
 */
export interface FolderPageMode {
  /** The folder page's own declaration: the typing ladder's TOP rung (🔒 Q8, YAZ-815). */
  settings: FolderPageSettings
  /** The WHOLE index snapshot — `records` here carries only the members (🔒 D2), and link resolution plus the link pickers must still see the vault. */
  vaultRecords: readonly IndexRecord[]
  /**
   * Birth from a folder page (🔒 Q5, YAZ-815): create a page from `seed` and resolve its path.
   * The `Untitled` scheme is the DEFAULT name; the board's inline add (YAZ-943) already knows what
   * the card is called, and that typed name rides the optional argument.
   */
  create: (seed: NewNoteSeed, name?: string) => Promise<string>
  /** Save one definition against the captured base; reject concurrent changes to that property. */
  setColumn: (key: string, next: ColumnDecl, base: ColumnDecl | undefined) => Promise<unknown>
  /**
   * The declarations, back through the one door (YAZ-895) — ONE `folder_page_settings` write
   * (🔒 D3), failures in the host's own banner. `views` rides along so a caller can move the
   * columns AND `view.order` in that same single write. Passing none does NOT mean "leave the
   * views alone": the host writes the LIVE def's `views` and `defaultView` either way, never the
   * index snapshot it also holds, so a column write cannot clobber an edit the index has not
   * echoed back yet (YAZ-1471 D4; YAZ-1234's two-gestures data loss). `labels`, when given, is
   * the caller's word on the column labels (`properties`) — `undefined` inside it means NONE —
   * and when absent the live def's labels ride along (YAZ-1513). Fire-and-forget: the host's banner
   * is the report, and its ahead copy is reverted on a refusal. (A caller that must know whether
   * the write landed — a column delete — is the host's own, and awaits the door directly.)
   *
   * `settings.columns` is the host's AHEAD copy (YAZ-1549): every declaration write shows here
   * before the index echoes it, and this is the ONE map a caller spreads or hands back as `base`.
   */
  setColumns: (columns: Record<string, ColumnDecl>, views?: ViewDef[], labels?: { properties: ViewSet['properties'] }) => void
  /**
   * "Delete column…" (YAZ-1513): the declaration, every view reference, the label AND the key on
   * every direct member — `views/deleteColumn.ts`, ONE function behind both menus. Never rejects:
   * the host reports failures in its own banner.
   */
  deleteColumn: (key: string) => Promise<void>
  /** ⌘-click on a table row opens the page in a BACKGROUND tab (YAZ-820); absent → opens in place. */
  openBackground?: (path: string) => void
  /** Shared Table/Board action that opens the exact page in the window's right panel. */
  openRight?: (path: string) => void
  /** Passive notice surface for row actions that fail because a page moved or disappeared. */
  onNotice?: (message: string) => void
  /**
   * The outline editor's own wikilink surfaces (YAZ-903) — the window's ONE resolve source, its
   * `[[` picker feed and the click-navigation contract, assembled by the host exactly as
   * `Editor` assembles them for the note. `nav`'s identity must be STABLE: a new object remounts
   * the editor, and a remount costs the caret.
   */
  wikilinks?: WikilinkResolveSource
  wikilinkCandidates?: WikilinkCandidateSource
  nav?: WikilinkNav
}

export interface ViewsPaneProps {
  parsed: ParsedViews
  /** Every config change arrives here as `updateViews(parsed, …)`; the host turns it into a write. */
  onChange: (next: ParsedViews) => void
  /**
   * Vault root. It keys the view state persisted OUTSIDE the file (collapsed groups, GRO-2137)
   * AND roots the resolver (YAZ-846, closing the Engine entry's KNOWN GAP), so a link target
   * written as an absolute `<root>/…` path resolves here exactly as it does for the wikilink
   * surfaces. null = session-only collapse, name-and-relative-path resolution only.
   */
  root: string | null
  /** Absolute path of the page the views belong to, for `this.file` in filters/formulas; null when unknown. */
  thisFile: string | null
  /** The MEMBERS the views query (🔒 D2) — the folder page's own rows, never the whole vault. */
  records: IndexRecord[]
  /**
   * The vault-wide property declarations (5E, GRO-2217; `useProperties`) — typing rung 2, fed
   * App → `Editor` → `FolderPageContents` since YAZ-846. null/absent until the fetch resolves; a
   * `properties.error` renders its own passive line and never blocks a row.
   */
  properties?: PropertiesResponse | null
  onOpenFile: (path: string) => void
  /**
   * The FOLDER PAGE's contents (🔒 D3, YAZ-819) — REQUIRED since YAZ-846: its rows are the
   * members, its def is in memory, and its views are EDITABLE since YAZ-1471 re-ruled 🔒 rule 4
   * — reorder / rename / duplicate / delete / "+", every gesture ONE `update` through this
   * adapter's one door. A folder page's set IS the lookup itself (🔒 Q3, YAZ-815).
   */
  folderPage: FolderPageMode
}

/**
 * One group's own raw value into a new note's seed (5D, GRO-2144), for `key` = that group's LEVEL.
 * Fanned out (D4): seed THIS group's own element as a one-item list — the first row's raw value is
 * the neighbour's WHOLE list there, which would hand the new page someone else's values; `render()`
 * gives a link back its `[[…]]` form, the same one the picker writes.
 */
function seedGroupValue(properties: Record<string, unknown>, group: Group, key: string | null): void {
  if (key === null || group.key === null) return
  const raw = group.fannedOut ? [render(group.key)] : group.rows[0]?.record.properties[key] ?? group.optionValue
  if (raw !== undefined) properties[key] = raw
}

/**
 * One set of views (GRO-2135): the toolbar (view switcher, sort / properties menus, search,
 * count) over the body — the real table for `type: table` (GRO-2136), the board for
 * `type: board` (4D, GRO-2138), the card grid for `type: cards` (4E, GRO-2139), the list for
 * `type: list` (4F, GRO-2140), the outline for `type: outline` (YAZ-820), a placeholder row list
 * for unknown view types. Only the active tab and the search text are component state —
 * everything else is the file.
 *
 * TOMBSTONE (YAZ-846, the amputation): `readOnly` (the read-only embed chrome), `initialView`
 * (which picked the starting tab for `![[X.base#View]]` — its JOB alone returned in YAZ-1104 as
 * the `defaultView` seed below, deliberately), `types` (the ladder's rung 3, whose
 * whole `.obsidian/types.json` chain ⚡ YAZ-815 then deleted), `indexStatus` / `indexError` and the plain 5D
 * `createFromSeed` path all died here. Every one of them lost its production caller when YAZ-844
 * retired `.base`: the contents block is the ONLY mount, it hands over a snapshot already in hand
 * and it births through the declaration. `readOnly` outlived itself by one wave as a HARDCODED
 * `true` on `ViewTabs` — the editable half kept whole but unreachable — until 🔒 D0 (YAZ-1471)
 * re-ruled 🔒 rule 4 and deleted the prop instead: the tab gestures below are live.
 */
export function ViewsPane({ parsed, onChange, root, thisFile, records, properties = null, onOpenFile, folderPage }: ViewsPaneProps) {
  // The START may persist (YAZ-1104); which view is ACTIVE stays session state — switching still
  // writes nothing, and YAZ-1471 re-ruling 🔒 rule 4 (the tabs edit again) did not move that line:
  // only the def is written. A stale (or absent) saved name is -1 here, so it clamps to the first.
  const [active, setActive] = useState(() =>
    Math.max(0, parsed.def.views.findIndex((v) => v.name === parsed.def.defaultView)),
  )
  const [search, setSearch] = useState<string | null>(null)
  /** Collapsed group keys per view, seeded from the store; a toggle replaces the entry here AND writes through storage. */
  const [collapsedByKey, setCollapsedByKey] = useState<Record<string, string[]>>({})
  /** Optimistic group moves (5C, GRO-2143) keyed by path, patched into the records the engine sees. */
  const [moves, setMoves] = useState<Record<string, PendingMove>>({})
  const [moveError, setMoveError] = useState<{ path: string; message: string } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const { def } = parsed
  const views = def.views
  const index = Math.max(0, Math.min(active, views.length - 1))
  /**
   * NEVER undefined, and the assertion says so rather than a branch pretending otherwise
   * (YAZ-861): `views` cannot be empty. `folderPageSettings.readViews` returns `DEFAULT_VIEWS`
   * for every unusable shape it meets (`views.length > 0 ? views : defaultViews()`), and the one
   * mount — `FolderPageContents.folderPageViewSet` — falls back to `DEFAULT_VIEWS` again when the
   * card's YAML will not parse. `index` is clamped into that non-empty list. The "This folder
   * page has no views. [Add view]" branch this replaces was unreachable UI with a live code path
   * behind it, which is the FilterMenu's lesson (YAZ-846): delete it rather than keep it hidden.
   */
  const view = views[index]!
  // Re-parse after every edit: `doc.setIn` stores plain JS values, so a second edit inside a
  // collection a previous edit created would throw ("Expected YAML collection"). The round trip
  // through text keeps comments and rebuilds proper nodes.
  const update = (mutate: (def: ViewSet) => void) => onChange(parseViews(serializeViews(updateViews(parsed, mutate))))

  // 5B's clearing discipline: a pending move holds until the index refetch moves that key off the
  // raw it had at commit time (our write landing, or a concurrent writer winning) — never before.
  useEffect(() => {
    setMoves((m) => {
      const kept = Object.entries(m).filter(([path, mv]) => {
        const props = records.find((r) => r.path === path)?.properties
        // A two-write move is ONE unit (🔒 YAZ-745): it holds until the index has moved off BOTH raws.
        return mv.some((w) => JSON.stringify(props?.[w.key] ?? null) === JSON.stringify(w.prevRaw ?? null))
      })
      return kept.length === Object.keys(m).length ? m : Object.fromEntries(kept)
    })
  }, [records])

  const shown = useMemo(() => (Object.keys(moves).length === 0 ? records : applyMoves(records, moves)), [records, moves])
  // 🔒 D2 (YAZ-819): a folder page's rows are its MEMBERS, so the engine's own rows-are-the-vault
  // resolver would miss every link pointing outside them — inject the whole-vault one. It is built
  // WITH the root (YAZ-846): keyed per records identity then per root, the memo hands the wikilink
  // feed and this one the SAME resolver, and an absolute-path link target resolves in both.
  const vaultRecords = folderPage.vaultRecords
  const resolve = useMemo(() => resolverFor(vaultRecords, root ?? undefined), [vaultRecords, root])
  /**
   * The folder page's OUTLINE (YAZ-820) — and the ONE place the engine has to be told about it:
   * an outline view's `order` is the [D5] MEMBER sequence (wikilinks), not a column list, so it
   * is dropped before the run. Left in, `propertyKeys` would hand those wikilinks to the value
   * pass, every row's `values` would come back empty, and the toolbar's search — which matches
   * over exactly those values — would hide the whole outline. The strip outlives the [D5] list
   * itself (YAZ-903 retires `order` on the first edit): an un-migrated card still carries one.
   * The DOCUMENT needs no strip of its own — `propertyKeys` reads `view.order` and nothing else,
   * so `view.outline`, a string, can not reach the value pass however long it grows.
   * Everything else the view says (sort, limit, groupBy) still runs.
   */
  const isOutline = view.type === 'outline'
  const result = useMemo(
    () => runView(def, isOutline && view.order !== undefined ? { ...view, order: undefined } : view, shown, { thisFile, resolve, declared: Object.keys(folderPage.settings.columns) }),
    [def, view, shown, thisFile, resolve, isOutline],
  )

  const configuredGroups = boardOptionGroups(result.groups, view, key => columnTyping(key, shown, properties, folderPage.settings))
  const keepEmpty = view.type === 'board' && view.showEmptyColumns === true
  const needle = (search ?? '').trim().toLowerCase()
  const matches = (r: Row) => Object.values(r.values).some((v) => render(v).toLowerCase().includes(needle))
  const rows = needle ? result.rows.filter(matches) : result.rows
  // Search filters WITHIN each group; a group with no matching rows disappears (4C, GRO-2137). A
  // two-level group (YAZ-745) narrows each branch the same way — emptied children go, and `rows`
  // stays the union of what is left beneath, so an outer whose whole branch missed drops too.
  const narrow = (g: Group): Group => {
    if (g.children === undefined) return { ...g, rows: g.rows.filter(matches) }
    const children = g.children.map((c) => ({ ...c, rows: c.rows.filter(matches) })).filter((c) => keepEmpty || c.rows.length > 0)
    const direct = (g.direct ?? []).filter(matches)
    return { ...g, rows: [...direct, ...children.flatMap((c) => c.rows)], children, direct }
  }
  const groups = configuredGroups === null ? null : needle ? configuredGroups.map(narrow).filter((g) => keepEmpty || g.rows.length > 0) : configuredGroups

  // Collapse state lives per `<pagePath>::<viewName>` in the main-owned store — NEVER in the
  // page's own card, so toggling can not touch autosave. Session-only (keyed by view index)
  // when paths are unknown.
  const groupsKey = thisFile === null ? null : `${thisFile}::${view.name}`
  const collapseKey = groupsKey ?? `#${index}`
  const collapsed = collapsedByKey[collapseKey] ?? (root !== null && groupsKey !== null ? storage.getViewGroups(root, groupsKey) : [])
  const writeCollapsed = (next: readonly string[]) => {
    setCollapsedByKey((m) => ({ ...m, [collapseKey]: [...next] }))
    if (root !== null && groupsKey !== null) storage.setViewGroups(root, groupsKey, next)
  }
  /**
   * The store is keyed by view NAME, and since YAZ-1471 a name changes in one gesture: a rename
   * carries the entry to the new key and a delete drops it — else the renamed view springs open,
   * the old key leaks, and a later view given the same name inherits a stranger's groups (YAZ-1493).
   */
  const moveCollapsed = (from: string, to: string | null) => {
    if (thisFile === null) return // session-only keys go by INDEX and need no carrying
    const fromKey = `${thisFile}::${from}`
    const kept = collapsedByKey[fromKey] ?? (root !== null ? storage.getViewGroups(root, fromKey) : [])
    const toKey = to === null || kept.length === 0 ? null : `${thisFile}::${to}`
    setCollapsedByKey((m) => {
      const next = { ...m }
      delete next[fromKey]
      if (toKey !== null) next[toKey] = kept
      return next
    })
    if (root === null) return
    storage.setViewGroups(root, fromKey, [])
    if (toKey !== null) storage.setViewGroups(root, toKey, kept)
  }
  const onToggleGroup = (key: string) => {
    writeCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])
  }
  // Collapse / expand all (YAZ-744): every group the VIEW has, not the search-narrowed `groups` —
  // a group hidden behind an active search must collapse with the rest. Two levels (YAZ-745) go in
  // document order, each outer before its children, and it is the KEY count that meets the store's
  // cap: above it the toggle hides rather than writing a list `setViewGroups` would truncate.
  const groupKeys =
    configuredGroups === null ? [] : configuredGroups.flatMap((g) => [groupKeyOf(g.key), ...(g.children ?? []).map((c) => nestedGroupKeyOf(g.key, c.key))])
  const allGroupKeys = groupKeys.length > MAX_COLLAPSED_GROUP_KEYS ? [] : groupKeys

  // A drop on a board column / table section (5C, GRO-2143): optimistic move now, then 5B writes
  // every changed key in one guarded transformation; a failure drops the move (the card snaps back)
  // and flags the card instead. `drop` names
  // the LEVEL the row landed on (YAZ-1101) and may carry the outer's write — inner first, then the
  // outer, both optimistic as ONE unit so either failing snaps the whole move back (🔒 YAZ-745).
  const onMoveToGroup = (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => {
    const key = groupByKey(view, drop?.level ?? 0)
    if (key === null) return
    const props = records.find((r) => r.path === path)?.properties
    const prevRaw = props?.[key]
    if (swap !== undefined) {
      // Fan-out (D3): edit the list rather than replace it. Elements are matched with the engine's
      // own `equals` over `fromYaml` and NO resolver — the exact comparison that decided the
      // grouping — so we can only ever remove the element that put this row in that group.
      const list = Array.isArray(prevRaw) ? prevRaw : prevRaw == null ? [] : [prevRaw]
      const next = swap.remove === null ? [...list] : list.filter((v) => !equals(fromYaml(v), swap.remove))
      if (swap.add !== null) next.push(render(swap.add))
      value = next
    }
    const writes: PendingMove = [{ key, value, prevRaw }]
    if (drop?.outer !== undefined) writes.push({ ...drop.outer, prevRaw: props?.[drop.outer.key] })
    setMoveError(null)
    setMoves((m) => ({ ...m, [path]: writes }))
    const commit = writes.length === 1 ? writeProperty(path, writes[0].key, writes[0].value) : writeProperties(path, writes)
    commit.catch((err: unknown) => {
      setMoves((m) => Object.fromEntries(Object.entries(m).filter(([p]) => p !== path)))
      setMoveError({ path, message: err instanceof Error ? err.message : String(err) })
    })
  }

  // The toolbar's "New" / a group header's "+" (5D, GRO-2144): a note pre-filled to satisfy this
  // view — filter-derived seed, plus the group's raw value when created inside a group. A folder
  // page births its members from its OWN declaration and parks them per its settings (🔒 Q5,
  // YAZ-815), which since YAZ-846 is the ONLY create path here: the seed still rides along, so a
  // group "+" seeds its group. The note opens once the create lands; a failure shows the alert.
  // A `name` means the board's inline add (YAZ-943) — it already named the card and the caller is
  // mid-typing in the column, so that create STAYS on the board and opens nothing.
  const onNewNote = (group: Group | null, name?: string, at?: GroupSpot) => {
    const seed = deriveSeed(def, view)
    if (group !== null) {
      seedGroupValue(seed.properties, group, groupByKey(view, at?.level ?? 0))
      // 🔒 YAZ-745: an INNER "+" seeds the outer too, so the note lands in the very section clicked.
      if (at !== undefined && at.level > 0) seedGroupValue(seed.properties, at.outer, groupByKey(view))
    }
    setCreateError(null)
    folderPage
      .create(seed, name)
      .then((path) => {
        if (name === undefined) onOpenFile(path)
      })
      .catch((err: unknown) => setCreateError(err instanceof Error ? err.message : String(err)))
  }

  const keys = propertyKeys(def, view, records, Object.keys(folderPage.settings.columns))
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const rest = keys.filter((k) => k !== nameKey)

  /**
   * The report-don't-block channel, finally reporting somewhere (YAZ-861). Both halves are
   * produced on every render and, until now, read by nobody: `settings.problems` — the one-liners
   * `folderPageSettings` collects while it ignores an unusable `folder_page_settings` key — and
   * `result.errors`, the `EngineError`s a hand-written `filters:` or a broken formula compiles
   * into. A folder page whose card says something the app silently declined to honour should say
   * so; it should not be a dialog about it. So: ONE muted line at the foot of the pane, `role`
   * `note` (never `alert` — nothing here is urgent and nothing here failed), rendered only when
   * there is something to say, and blocking exactly nothing above it.
   */
  const notes = [...folderPage.settings.problems, ...result.errors.map((e) => `${e.where}: ${e.message}`)]

  /** The `filters` half of that channel ALSO surfaces inside the Filter menu, where it is edited (YAZ-1229). */
  const filterErrors = result.errors.filter((e) => e.where.includes('filters'))

  /**
   * The folder page's OUTLINE (YAZ-820). `thisFile` IS the folder page's path here
   * (`FolderPageContents` passes it) and it roots the ancestor guard, so a null one falls through
   * to the placeholder rows rather than guessing.
   */
  const outline = isOutline && thisFile !== null
  /**
   * The outline view's `order` is the [D5] MEMBER sequence, not a column list — so the Properties
   * menu, whose every gesture rewrites `view.order`, is not offered while it is showing. An
   * outline has no columns to configure; leaving the menu up would let a click silently overwrite
   * the locked ordering with property keys.
   */
  const outlineIndex = views.findIndex((v) => v.type === 'outline')
  /** "Sync from folder" (YAZ-953): the toolbar's button and the outline's sheet are siblings, so
      the one flag between them lives here. Never persisted — the folder is asked every time (🔒 3). */
  const [syncing, setSyncing] = useState(false)

  // View CRUD lives here since YAZ-1471 (re-ruling 🔒 rule 4, YAZ-819): every gesture is ONE
  // `update` — the same door as sort and columns — and which view is ACTIVE stays session state.
  const taken = () => new Set(views.map((v) => v.name))
  const tabs: ViewTabsProps = {
    views,
    active: index,
    onSelect: setActive,
    onMove: (from, to) => {
      update((d) => d.views.splice(to, 0, ...d.views.splice(from, 1)))
      // The active view FOLLOWS its tab: replay the same move over the indices.
      const order = views.map((_, i) => i)
      order.splice(to, 0, ...order.splice(from, 1))
      setActive(order.indexOf(index))
    },
    onAdd: (type) => {
      update((d) => d.views.push({ type, name: freeName(viewTypeLabel(type), taken()) }))
      setActive(views.length)
    },
    onRename: (i, name) => {
      moveCollapsed(views[i].name, name)
      update((d) => {
        if (d.defaultView === d.views[i].name) d.defaultView = name // the saved START follows (D4)
        d.views[i].name = name
      })
    },
    onDuplicate: (i) => {
      update((d) => d.views.splice(i + 1, 0, { ...structuredClone(d.views[i]), name: freeName(`${d.views[i].name} copy`, taken()) }))
      setActive(i + 1)
    },
    onDelete: (i) => {
      if (views.length <= 1) return
      moveCollapsed(views[i].name, null)
      update((d) => {
        const [gone] = d.views.splice(i, 1)
        if (d.defaultView === gone.name) delete d.defaultView // a deleted START clears itself (D4)
      })
      // The active view stays put unless it WAS the deleted one — then its right neighbour takes over
      // (the left one when it was the last tab); a view before it in the list shifts one index down.
      setActive(index === i ? Math.min(i, views.length - 2) : index > i ? index - 1 : index)
    },
  }

  return (
    <div className="views-pane">
      <Toolbar
        def={def}
        view={view}
        viewIndex={index}
        records={records}
        filterErrors={filterErrors}
        shown={rows.length}
        total={result.total}
        search={search}
        onSearch={setSearch}
        onUpdate={update}
        onNew={() => onNewNote(null)}
        allGroupKeys={allGroupKeys}
        collapsed={collapsed}
        onSetAllGroups={writeCollapsed}
        tabs={tabs}
        root={root}
        properties={properties}
        documentView={outline}
        onSync={() => setSyncing(true)}
        folderPage={folderPage}
      />
      {createError !== null && (
        <p className="views-pane__error" role="alert">
          Could not create note: {createError}
        </p>
      )}
      {properties?.error !== undefined && (
        <p className="views-pane__error" role="alert">
          Could not load the vault's property declarations: {properties.error}
        </p>
      )}
      {outline ? (
        <OutlineView
          folderPagePath={thisFile}
          root={root}
          settings={folderPage.settings}
          outline={views[outlineIndex].outline}
          vaultRecords={vaultRecords}
          records={records}
          wikilinks={folderPage.wikilinks}
          wikilinkCandidates={folderPage.wikilinkCandidates}
          nav={folderPage.nav}
          syncing={syncing}
          onSyncDone={() => setSyncing(false)}
          // ONE `folder_page_settings` write, through the same door every config edit uses — the
          // door the retired drag wrote `order` through (YAZ-903). It lands on the FIRST outline
          // view because that is the one the seed was read from, and `order` RETIRES in the same
          // write: the [D5] list has said its piece the moment the document exists.
          onDocument={(markdown) =>
            update((d) => {
              d.views[outlineIndex].outline = markdown
              delete d.views[outlineIndex].order
            })
          }
        />
      ) : view.type === 'table' ? (
        <TableView
          def={def}
          view={view}
          viewIndex={index}
          records={shown}
          rows={rows}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onUpdate={update}
          onOpenFile={onOpenFile}
          onOpenFileRight={folderPage.openRight}
          onOpenFileBackground={folderPage.openBackground}
          onNotice={folderPage.onNotice}
          onMoveToGroup={onMoveToGroup}
          moveError={moveError}
          onNewInGroup={onNewNote}
          root={root}
          properties={properties}
          folderPage={folderPage.settings}
          vaultRecords={vaultRecords}
          preview={view.preview === true}
          declareColumn={folderPage.setColumns}
          deleteColumn={folderPage.deleteColumn}
        />
      ) : view.type === 'board' ? (
        <BoardView
          folderPage={folderPage.settings}
          def={def}
          view={view}
          viewIndex={index}
          records={shown}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onUpdate={update}
          onOpenFile={onOpenFile}
          onOpenFileRight={folderPage.openRight}
          onOpenFileBackground={folderPage.openBackground}
          onNotice={folderPage.onNotice}
          onMoveToGroup={onMoveToGroup}
          moveError={moveError}
          onNewInGroup={onNewNote}
          preview={view.preview === true}
        />
      ) : view.type === 'cards' ? (
        <CardsView
          def={def}
          view={view}
          root={root}
          records={records}
          rows={rows}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onOpenFile={onOpenFile}
          onNewInGroup={onNewNote}
          properties={properties}
          folderPage={folderPage.settings}
          vaultRecords={vaultRecords}
        />
      ) : view.type === 'list' ? (
        <ListView
          def={def}
          view={view}
          records={records}
          rows={rows}
          groups={groups}
          collapsed={collapsed}
          onToggleGroup={onToggleGroup}
          onOpenFile={onOpenFile}
          onNewInGroup={onNewNote}
          root={root}
          properties={properties}
          folderPage={folderPage.settings}
          vaultRecords={vaultRecords}
        />
      ) : (
        <ul className="view-rows">
          {rows.map((row) => (
            <li key={row.record.path} className="view-row">
              <button type="button" className="view-row__link" onClick={() => onOpenFile(row.record.path)}>
                {nameKey === undefined ? row.record.name : render(row.values[nameKey])}
              </button>
              {rest.length > 0 && <span className="view-row__values">{rest.map((k) => render(row.values[k])).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <p className="views-pane__notes" role="note">
          {notes.join(' · ')}
        </p>
      )}
    </div>
  )
}
