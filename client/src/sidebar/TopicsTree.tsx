/**
 * The TOPICS lens' body (6B-, YAZ-848) — browsing the vault BY MEANING: the folder-page tree.
 * Home pinned as a LEAF, its topics standing at the root beside it, members nested per each
 * folder page's own order, live, loop-safe, with an expandable Uncategorized section at the
 * bottom. The sibling of `Tree.tsx`, which browses the same vault by its FOLDERS on disk; both
 * wear the same `.tree__row` family, the same `8 + depth * 14` indent and the same two open
 * handlers, because they are two readings of one vault and not two kinds of list.
 *
 * ROOTS (🔒 D2 of YAZ-821, as YAZ-920 amends it): whatever `[[Home]]` resolves to comes first —
 * through the WINDOW's resolver, so alias-aware and case-insensitive, every spelling a CLICK
 * would follow — and only when it is a FOLDER PAGE: a plain note called Home is not a tree root,
 * and the tree simply has no Home row (offering to make one is 6C's, deliberately not here).
 * Home is a PINNED LEAF, not an umbrella: it wears the house, counts nothing, descends into
 * nothing — and every folder page whose parents-minus-Home are empty stands at the ROOT beside
 * it, path-sorted, so the tree stops opening one indent deep on every vault whose Home lists all
 * its topics. A vault with no Home keeps the old rule: unparented folder pages are the roots.
 *
 * DESCENT (⚡ D6 amendment on YAZ-814): children come ONLY from `guardedChildren` — never raw
 * `pagesIn` — so `A → B → A` ends quietly at any depth while a page reachable down two branches
 * still renders under BOTH. Each level is ordered by ITS OWN folder page's settings
 * (`orderedMembers`, the [D5] rule's one place), because the order lives on the page that owns
 * the members, never on whoever happens to be showing them.
 *
 * EXPANSION (🔒 D4) is keyed by PAGE PATH, not by tree position: expanding Metrics under one
 * parent expands it under every parent, which is the mockup's behaviour and the honest one — the
 * user opened the PAGE. It is persisted per vault in the main-owned `folders[root].topicsExpanded`
 * bucket, `expanded`'s twin, so it survives a restart and is repaired by `store.renamePath`.
 * The SET itself is the Sidebar's since ⚡ YAZ-873 — this tree is CONTROLLED: it computes the next
 * set and hands it up, while the restore and the write-back live with the owner, which needs the
 * same set for the lens row's expand/collapse-all button. `allExpandableTopics` below is that
 * button's answer: the same walk this tree draws, asked all at once.
 *
 * THE ROW UNFOLDS (⚡ YAZ-870 on 🔒 D3, toggled by YAZ-921): clicking a folder-page row you are
 * NOT on opens the page AND expands it in place — one gesture, both meanings, and navigation
 * never folds the tree under you. On the TOPIC you are ALREADY reading, a click is not
 * navigation, so it toggles the fold — both directions. First activation of a plain page
 * PREVIEWS (focus stays on the row, the keyboard walk stays armed); the second COMMITS the
 * caret into the text. ⌘-click (background open, "not now") leaves the tree and the caret
 * alone. The chevron's own half of D3 stands untouched: expanding is still not opening —
 * and ←/→ fold/unfold the focused row from the keyboard without visiting it.
 *
 * UNCATEGORIZED (🔒 D7, the locked DEVIATION from the mockup): a muted row at the bottom that
 * EXPANDS IN PLACE — never a virtual page, never a main-pane view. As YAZ-920 amends it, the
 * section holds what the tree does NOT draw — computed from the same guarded descent the rows
 * come from, never "no parents" read off the index — so a page reachable only through the
 * pinned-leaf Home (which unfolds nothing) surfaces here instead of vanishing. YAZ-956 gives
 * those pages a pruned mini-Files hierarchy from their existing `IndexRecord.folder`: only
 * branches that contain an Uncategorized page appear, all start open, and disk-folder folds live
 * only for this mount. Folder rows organize on normal activation and use the shared Files
 * directory menu on right-click; pages keep every Topics gesture.
 *
 * FEED: the window's ONE `WikilinkResolveSource` — the same records + resolver pair backlinks,
 * the contents block and the folder-page toggle read. A refetched index pokes it and the whole
 * tree recomputes; there is no fetch, no watcher and no IPC of this lens' own. Before the first
 * index lands the feed is empty and this renders NOTHING — not even the Uncategorized row, which
 * would otherwise flash "0" over a vault it has not seen yet.
 *
 * THE OFFER (6C-, YAZ-849): the one thing this lens shows that is not the vault — a small card
 * above the tree, and ONLY when the folder has not been adopted (no `.yaseendraw/`, a fact App
 * establishes once per vault) AND nothing answers `[[Home]]`. An adopted vault never sees it: its
 * Home was created for it on open. The condition's live half is asked HERE, on this surface's own
 * feed, so the card retires the moment a Home appears — including an ordinary, unflagged page
 * called Home, which IS Home (🔒 D1) even though the roots rule above gives it no row. The card
 * REPLACES nothing: the roots and Uncategorized render underneath it exactly as they would.
 *
 * THE MENU (8G-, YAZ-865 — the ⚡ amendment on YAZ-821, ruled by Yasin): a PAGE row's right-click
 * opens the SAME `ContextMenu` a file row opens, on the page's own file. Not a menu of this
 * lens' own: the tree reports the row and the Sidebar — which owns the menu, its targets and
 * every pipeline behind them — does the rest, so copy/reveal/create/toggle/rename/delete can
 * never drift between the two readings of one vault. Since YAZ-948 BLANK SPACE, the
 * Uncategorized header and the offer card fall through to the same VAULT-ROOT menu the Files
 * lens has always given its blank space, minus "New folder". A create started there names no
 * row, so its inline input is drawn at the top of the tree (`rootCreate`). YAZ-1080 gives the
 * mini-tree's DISK folders the existing Files directory menu on their absolute path; they share
 * its utilities/create/rename/delete pipelines without inheriting filesystem drag or topic
 * membership semantics.
 *
 * THE DRAG (YAZ-991, the gesture 🔒 YAZ-959 scopes over YAZ-990's engine): a row is dragged onto a
 * FOLDER-PAGE row to change what it belongs to — the file tree's HTML5 idiom (`Tree.tsx`), the
 * same `tree__row--drop` highlight — and it owns not one rule of its own: `canDrop` says which
 * rows are targets and `performMove` does the ONE write, so this view can never drift from the
 * engine. A row's SOURCE is the parent it RENDERS UNDER — a page standing under two topics is
 * dragged out of whichever occurrence you grabbed — and null at the root and in Uncategorized,
 * where no parent stands above it: that drop gains a belonging instead of swapping one. The
 * pinned Home is neither dragged nor dropped onto wherever it renders (it descends into nothing,
 * so a drop there would be a root-drop in disguise), and neither is the Uncategorized header,
 * which has no page behind it. The drop itself writes NOTHING: it opens `ConfirmMove`, and only
 * the confirm reaches disk. Nothing re-renders optimistically either — the moved row arrives with
 * the next index snapshot, like every other change this tree draws.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MAX_TOPICS_EXPANDED_PAGES, type IndexRecord } from '@shared/types'
import { focusOpenDocument } from '../lib/focusHandoff'
import { folderPageSettings, orderedMembers } from '../views/folderPageSettings'
import { FolderPageGlyph } from '../views/view/icons'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { folderPagesLookup, guardedChildren, type FolderPagesLookup } from '../links/folderPages'
import { ConfirmMove } from './ConfirmMove'
import { CreateInline } from './CreateInline'
import type { EntryKind, MenuRow } from './createEntry'
import { HOME_LINK } from './ensureHome'
import { RenameInline } from './RenameInline'
import { canDrop, performMove } from './topicsMove'
import type { PendingRename, TreeSelection } from './Tree'
import { flashTreeRows, revealMissingMessage, type SidebarRevealRequest } from './revealRow'

/**
 * The inline "New …" input pending beneath one Topics row (8G-, YAZ-865; YAZ-1080). The anchor
 * is either a page row, a disk-folder row in Uncategorized, or null for blank space. Where the
 * file LANDS remains the Sidebar's `targetDirFor` decision; this type only tells the recursive
 * renderer where the one visible input belongs.
 */
export interface PendingTopicCreate {
  kind: EntryKind
  seed: string
  /**
   * The right-clicked page's path — the input renders under that row's FIRST occurrence — or
   * NULL for a create started from blank space (YAZ-948), which has no row to hang from and
   * means the vault ROOT: the input is drawn at the top of the tree, at the roots' own indent.
   */
  anchorPath: string | null
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/**
 * A drop waiting on its confirm sheet (YAZ-991): the dragged row, the parent that row rendered
 * under (null at the root and in Uncategorized) and the folder-page row it landed on. Nothing is
 * written while this stands — it IS the sheet's whole subject, and Cancel just drops it.
 */
interface PendingMove {
  child: IndexRecord
  fromPath: string | null
  target: IndexRecord
}

export interface TopicsTreeProps {
  /**
   * The open PAGE PATHS (🔒 D4). Owned by the Sidebar since ⚡ YAZ-873 — which restores it from
   * the per-vault bucket, writes it back, and needs the very same set for its expand-all button —
   * so this tree is CONTROLLED: it computes the next set and hands it up, nothing more.
   */
  expanded: ReadonlySet<string>
  onExpandedChange: (next: ReadonlySet<string>) => void
  /** Focus Mode (YAZ-1605): the folder pages this tree is narrowed to, or empty for the full tree. */
  focus: readonly string[]
  /** Vault root, used only to turn projected relative disk folders into filesystem menu targets. */
  root: string
  /** One request captured while Topics was the selected sidebar lens. */
  revealRequest: SidebarRevealRequest | null
  /** The window's index feed: the snapshot AND the resolver built from it, always read together. */
  source: WikilinkResolveSource
  /** The open file, highlighted wherever it appears — including under two parents at once. */
  activeFile: string | null
  onOpenFile: (path: string) => void
  /** ⌘-click (I3, GRO-2235): a background tab of THIS window — the file tree's other handler. */
  onOpenFileBackground: (path: string) => void
  /**
   * Multi-select (YAZ-1336), the file tree's own state handed to this lens too: keyed by PATH
   * (🔒 D1), so a page standing under two parents shows selected on BOTH occurrences (🔒 D3) —
   * the expansion's rule exactly (🔒 D4), for the same reason: the user selected the PAGE.
   */
  selection: TreeSelection
  /**
   * This folder has no `.yaseendraw/` (6C-, YAZ-849), so nothing was written into it and the
   * offer card is on the table. App establishes it once per vault (`useEnsureHome`) — it is a
   * fact about the FOLDER, not about Home, and stays true after the card has made one.
   */
  unadopted: boolean
  /** The card's one button: App runs the same create the auto-path runs, then opens the page. */
  onCreateHome: () => void
  /**
   * A PAGE or Uncategorized DISK-FOLDER row was right-clicked: the Sidebar opens its ONE
   * `ContextMenu` on that exact file/directory target. The header and offer card still name no
   * row; blank space is left to bubble so the body's root-menu guard can handle it unchanged.
   */
  onRowContextMenu: (row: MenuRow, e: React.MouseEvent) => void
  /** The one page currently renamed inline (menu → Rename), or null. The file tree's own type. */
  renaming: PendingRename | null
  /** The inline create input pending under one row (menu → New note / folder page / folder), or null. */
  creating: PendingTopicCreate | null
  /**
   * The sidebar's passive notice (YAZ-991), handed straight down: a confirmed move that fails to
   * reach disk says so where every other failed file op in this panel says so — never a second
   * dialog on top of the one just dismissed, and never silence.
   */
  onNotice: (message: string) => void
}

/** Stands in while the index has not landed; only ever paired with an empty snapshot. */
const NEVER: ResolveLink = () => null

const byPath = (a: IndexRecord, b: IndexRecord): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

export interface UncategorizedDiskFolder {
  name: string
  /** Vault-relative folder path, matching `IndexRecord.folder`. */
  path: string
  folders: UncategorizedDiskFolder[]
  pages: IndexRecord[]
}

export interface UncategorizedDiskTree {
  folders: UncategorizedDiskFolder[]
  pages: IndexRecord[]
}

interface MutableUncategorizedDiskFolder {
  name: string
  path: string
  folders: Map<string, MutableUncategorizedDiskFolder>
  pages: IndexRecord[]
}

const byNameCi = <T extends { name: string }>(a: T, b: T): number => a.name.toLowerCase().localeCompare(b.name.toLowerCase())

/**
 * A pruned Files-shaped projection of the pages this surface has already classified as
 * Uncategorized. A branch exists only because at least one page created it; disk folders that
 * contain no Uncategorized page can therefore never leak into this lens.
 */
export function uncategorizedDiskTree(records: readonly IndexRecord[]): UncategorizedDiskTree {
  const root: MutableUncategorizedDiskFolder = { name: '', path: '', folders: new Map(), pages: [] }

  for (const record of records) {
    let parent = root
    let folderPath = ''
    for (const name of record.folder.split('/').filter(Boolean)) {
      folderPath = folderPath === '' ? name : `${folderPath}/${name}`
      let folder = parent.folders.get(name)
      if (folder === undefined) {
        folder = { name, path: folderPath, folders: new Map(), pages: [] }
        parent.folders.set(name, folder)
      }
      parent = folder
    }
    parent.pages.push(record)
  }

  const finish = (folder: MutableUncategorizedDiskFolder): UncategorizedDiskTree => ({
    folders: [...folder.folders.values()].sort(byNameCi).map((child) => ({ ...finish(child), name: child.name, path: child.path })),
    pages: [...folder.pages].sort(byNameCi),
  })

  return finish(root)
}

/** Every vault-relative directory that must be open to draw a record in `folder`. */
const diskFolderAncestors = (folder: string): string[] => {
  const paths: string[] = []
  let path = ''
  for (const name of folder.split('/').filter(Boolean)) {
    path = path === '' ? name : `${path}/${name}`
    paths.push(path)
  }
  return paths
}

/** One normalized boundary between the vault root and the projection's relative disk paths. */
const diskRootPrefix = (root: string): string => `${root.replace(/\/+$/, '')}/`

/** The projection stays vault-relative; filesystem actions cross to an absolute path here. */
const absoluteDiskFolder = (root: string, folder: string): string => `${diskRootPrefix(root)}${folder}`

/** The resolver and the records it was built from, always read together (BacklinksSection's idiom). */
interface Feed {
  records: readonly IndexRecord[]
  resolve: ResolveLink | null
}

/**
 * THE ROOTS RULE (🔒 D2), pure and exported so it can be pinned on its own: Home when it resolves
 * AND carries the flag, then every OTHER folder page with no parents, path-sorted.
 *
 * Home is not required to be parentless — a Home that says it belongs somewhere leads the tree
 * anyway AND still appears under its parent, which is the same "a page belongs under every parent"
 * rule the descent follows. It can never appear inside ITSELF: the descent's ancestor path starts
 * at the root it came from.
 */
export function topicRoots(records: readonly IndexRecord[], lookup: FolderPagesLookup, resolve: ResolveLink | null, focus: readonly string[] = []): IndexRecord[] {
  // Focus Mode (YAZ-1605): the focused folder pages ARE the roots, in the order they were chosen —
  // no Home leaf, no siblings. The one door for rows, expand-all and Uncategorized alike, so the
  // three can never disagree. A focus that names no folder page any more falls through to the
  // full rule (the Sidebar prunes it).
  const focused = focus.flatMap((path) => records.filter((record) => record.path === path && lookup.isFolderPage(record)))
  if (focused.length > 0) return focused
  const homePath = resolve === null ? null : resolve(HOME_LINK)
  const home = homePath === null ? undefined : records.find((record) => record.path === homePath)
  // An ORDINARY page called Home is no Home for the tree: it gets no row, and the rule below
  // still stands the unparented folder pages up. (6C decides whether to OFFER one; not here.)
  const homeRoot = home !== undefined && lookup.isFolderPage(home) ? home : null
  // YAZ-920 amends 🔒 D2: Home is a PINNED LEAF now, not the umbrella everything hangs under —
  // so a topic whose only parent is Home stands at the root beside it, and the tree stops
  // opening one indent deep on every vault whose Home lists all its topics.
  const others = records
    .filter(
      (record) =>
        lookup.isFolderPage(record) &&
        record.path !== homeRoot?.path &&
        lookup.folderPagesOf(record.path).every((parent) => parent === homeRoot?.path),
    )
    .sort(byPath)
  return homeRoot === null ? others : [homeRoot, ...others]
}

/**
 * THE EXPAND-ALL ANSWER (⚡ YAZ-873), pure and exported beside the roots rule it starts from:
 * every page the tree could unfold, once each, in walk order (roots first, depth first). It is
 * the SAME descent the rows are drawn from — from every root, through `guardedChildren` only
 * (⚡ D6), never raw `pagesIn` — so a loop ends quietly and a page whose only member already
 * stands above it on every reachable trail is honestly not expandable, exactly as its missing
 * chevron says. A diamond page counts ONCE: the set is keyed by page path, like the expansion
 * itself (🔒 D4). Capped at the bucket's own ceiling, because the answer is written into it.
 */
export function allExpandableTopics(records: readonly IndexRecord[], lookup: FolderPagesLookup, resolve: ResolveLink | null, focus: readonly string[] = []): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const descend = (page: IndexRecord, trail: readonly string[]): void => {
    const kids = guardedChildren(lookup, page.path, trail)
    if (kids.length === 0) return // a chevron-less row: there is nothing here to open
    if (!seen.has(page.path)) {
      seen.add(page.path)
      found.push(page.path)
    }
    // Only a folder page holds members, so only a folder page is descended into — `childrenFor`'s
    // own test, kept in step so the walk can never reach a row the tree does not draw.
    for (const kid of kids) if (lookup.isFolderPage(kid)) descend(kid, [...trail, kid.path])
  }
  // The pinned-leaf Home (YAZ-920) never descends in the TREE, so it never counts here either —
  // an "Expand all" that opened nothing visible would be a lie told by a button.
  const homePath = resolve === null ? null : resolve(HOME_LINK)
  for (const start of topicRoots(records, lookup, resolve, focus)) if (start.path !== homePath) descend(start, [start.path])
  return found.slice(0, MAX_TOPICS_EXPANDED_PAGES)
}

export interface TopicRevealPlan {
  found: boolean
  ancestors: string[]
  uncategorized: boolean
}

/** Expansion needed to draw every occurrence of `target`, following the tree's guarded graph. */
export function topicRevealPlan(
  records: readonly IndexRecord[],
  lookup: FolderPagesLookup,
  resolve: ResolveLink | null,
  target: string,
): TopicRevealPlan {
  const ancestors: string[] = []
  const seenAncestors = new Set<string>()
  let rendered = false
  const homePath = resolve === null ? null : resolve(HOME_LINK)

  const visit = (page: IndexRecord, trail: readonly string[]): void => {
    if (page.path === target) {
      rendered = true
      for (const ancestor of trail.slice(0, -1)) {
        if (seenAncestors.has(ancestor)) continue
        seenAncestors.add(ancestor)
        ancestors.push(ancestor)
      }
    }
    if (!lookup.isFolderPage(page) || page.path === homePath) return
    for (const child of guardedChildren(lookup, page.path, trail)) visit(child, [...trail, child.path])
  }

  for (const root of topicRoots(records, lookup, resolve)) visit(root, [root.path])
  const found = records.some((record) => record.path === target)
  return { found, ancestors, uncategorized: found && !rendered }
}

export function TopicsTree({ root, expanded, onExpandedChange, focus, revealRequest, source, activeFile, onOpenFile, onOpenFileBackground, selection, unadopted, onCreateHome, onRowContextMenu, renaming, creating, onNotice }: TopicsTreeProps) {
  // Subscribe once, re-read the whole feed on each poke; an unchanged snapshot keeps the previous
  // object, so index churn that changed nothing here costs no render (BacklinksSection's idiom).
  const [feed, setFeed] = useState<Feed>(() => ({ records: source.records, resolve: source.resolve }))
  useEffect(() => {
    const read = () =>
      setFeed((prev) => (prev.records === source.records && prev.resolve === source.resolve ? prev : { records: source.records, resolve: source.resolve }))
    read()
    return source.subscribe(read)
  }, [source])

  // Uncategorized's own open/closed is SESSION state, deliberately not in the lifted bucket: that
  // bucket holds page paths (and is repaired as such on rename), and Uncategorized is not a page.
  // So it stays HERE while the expansion went up — the two are not the same kind of fact.
  const [showOrphans, setShowOrphans] = useState(false)
  const handledRevealId = useRef<number | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  // Disk-folder folds are a second, equally local fact. Store only the exceptions because every
  // populated branch starts open; hiding and reopening Uncategorized preserves them for this
  // mount, while switching away from Topics naturally resets the mini tree.
  const [collapsedUncategorizedFolders, setCollapsedUncategorizedFolders] = useState<ReadonlySet<string>>(() => new Set())

  // THE DRAG (YAZ-991) lives entirely here — the tree already holds the records, the lookup and
  // the resolver every step of it asks. The dragged row carries the parent it renders under; the
  // highlight is keyed by PAGE PATH, like the expansion (🔒 D4), because the drop means the same
  // thing at every occurrence of a page; and the pending drop is the sheet's whole subject.
  const [dragging, setDragging] = useState<{ child: IndexRecord; fromPath: string | null } | null>(null)
  const [dropPath, setDropPath] = useState<string | null>(null)
  const [moving, setMoving] = useState<PendingMove | null>(null)

  const { records, resolve } = feed
  const lookup = useMemo(() => folderPagesLookup(records, resolve ?? NEVER), [records, resolve])
  const roots = useMemo(() => topicRoots(records, lookup, resolve, focus), [records, lookup, resolve, focus])
  // YAZ-920: the pinned-leaf Home — its row opens the page and unfolds nothing.
  const homePath = resolve === null ? null : resolve(HOME_LINK)
  const revealPlan = useMemo(
    () => revealRequest?.lens === 'topics' && resolve !== null
      ? topicRevealPlan(records, lookup, resolve, revealRequest.path)
      : null,
    [lookup, records, resolve, revealRequest],
  )
  // 🔒 D7 as YAZ-920 amends it: Uncategorized is what the tree does NOT draw — the same guarded
  // descent the rows are drawn from, never "no parents" read off the index. A page reachable
  // only through the leaf Home (a Home-only note, an orphaned loop) surfaces here, not nowhere.
  const orphans = useMemo(() => {
    // Focus Mode (YAZ-1605): everything outside the focused topics is hidden, Uncategorized included —
    // but only when the focus RESOLVED. `topicRoots` falls through to the full rule when it names no
    // folder page any more, and the roots are folder pages, so "a root is in the focus" is exactly
    // "the focus resolved": the fall-through draws the full tree, this section included.
    if (roots.some((root) => focus.includes(root.path))) return []
    const drawn = new Set<string>()
    const walk = (page: IndexRecord, trail: readonly string[]): void => {
      if (drawn.has(page.path)) return
      drawn.add(page.path)
      if (page.path === homePath || !lookup.isFolderPage(page)) return
      for (const kid of guardedChildren(lookup, page.path, trail)) walk(kid, [...trail, kid.path])
    }
    for (const root of roots) walk(root, [root.path])
    return records.filter((record) => !drawn.has(record.path))
  }, [records, lookup, roots, homePath])
  const orphanDiskTree = useMemo(() => uncategorizedDiskTree(orphans), [orphans])
  const revealDiskFolders = useMemo(() => {
    if (revealPlan?.uncategorized !== true || revealRequest === null) return []
    return diskFolderAncestors(records.find((record) => record.path === revealRequest.path)?.folder ?? '')
  }, [records, revealPlan, revealRequest])

  useEffect(() => {
    if (revealRequest?.lens !== 'topics' || revealPlan === null || handledRevealId.current === revealRequest.id) return
    handledRevealId.current = revealRequest.id
    if (!revealPlan.found) {
      onNotice(revealMissingMessage(revealRequest.path, 'topics'))
      return
    }
    const next = new Set(expanded)
    for (const ancestor of revealPlan.ancestors) next.add(ancestor)
    if (next.size !== expanded.size) onExpandedChange(next)
    if (revealPlan.uncategorized) {
      setShowOrphans(true)
      setCollapsedUncategorizedFolders((current) => {
        if (!revealDiskFolders.some((folder) => current.has(folder))) return current
        const opened = new Set(current)
        for (const folder of revealDiskFolders) opened.delete(folder)
        return opened
      })
    }
  }, [expanded, onExpandedChange, onNotice, revealDiskFolders, revealPlan, revealRequest])

  // Files opens a directory before drawing its create input. The mini-tree keeps the same
  // complete gesture by retiring that one collapsed exception when a folder-anchored create
  // arrives from the shared menu; page anchors simply do not name an entry in this set.
  useEffect(() => {
    const anchorPath = creating?.anchorPath
    if (anchorPath === null || anchorPath === undefined) return
    const prefix = diskRootPrefix(root)
    if (!anchorPath.startsWith(prefix)) return
    const folder = anchorPath.slice(prefix.length)
    setCollapsedUncategorizedFolders((current) => {
      if (!current.has(folder)) return current
      const opened = new Set(current)
      opened.delete(folder)
      return opened
    })
  }, [creating?.anchorPath, root])

  const revealReady =
    revealPlan?.found === true &&
    (revealPlan.uncategorized
      ? showOrphans && revealDiskFolders.every((folder) => !collapsedUncategorizedFolders.has(folder))
      : revealPlan.ancestors.every((ancestor) => expanded.has(ancestor)))

  useEffect(() => {
    if (!revealReady || revealRequest === null || hostRef.current === null) return
    return flashTreeRows(hostRef.current, revealRequest.path) ?? undefined
  }, [revealReady, revealRequest])

  // Pure computations over the prop since ⚡ YAZ-873 — the next set goes up, the owner decides.
  const toggle = (path: string): void => {
    const next = new Set(expanded)
    if (!next.delete(path)) next.add(path)
    onExpandedChange(next)
  }

  // ⚡ YAZ-870: `toggle`'s add-only twin — the row gesture unfolds but never folds, so
  // navigating to a page you are already on cannot close the tree under you.
  const expand = (path: string): void => {
    if (expanded.has(path)) return
    onExpandedChange(new Set(expanded).add(path))
  }

  const open = (path: string, e: React.MouseEvent): void => {
    // Shift is the SELECTION gesture and nothing else (YAZ-1336, 🔒 D2) — it never opens and
    // never previews, so it is asked before every open rule below.
    if (e.shiftKey) {
      selection.toggle(path)
      return
    }
    // Every other activation makes the selection THIS page (D9, YAZ-1674), plain and ⌘ alike.
    selection.set(path)
    // First activation PREVIEWS, second COMMITS (YAZ-921): opening from the tree keeps focus on
    // the row — the walk stays armed, click or Enter alike — and activating the page you are
    // already reading is the deliberate "take me in": the caret jumps into the text.
    if (e.metaKey) {
      onOpenFileBackground(path)
      return
    }
    if (path === activeFile) {
      // Enter only (D11, YAZ-1674 — `detail === 0` is a keyboard click): a mouse click on the open
      // page just selects it, so click-then-⌘C never hands the key to the editor.
      if (e.detail === 0) focusOpenDocument() // the VISIBLE document (YAZ-961): a folder page's outline, not its hidden body
      return
    }
    onOpenFile(path)
  }

  /** The children to DESCEND into: the one door (⚡ D6), ordered by this parent's own settings.
      Home descends into NOTHING (YAZ-920): its members stand at the root beside it. */
  const childrenFor = (parent: IndexRecord, trail: readonly string[]): IndexRecord[] =>
    lookup.isFolderPage(parent) && parent.path !== homePath
      ? orderedMembers(guardedChildren(lookup, parent.path, trail), folderPageSettings(parent), resolve ?? NEVER)
      : []

  /** One page's name for the sheet's copy — the outline's own way of naming a parent by path. */
  const nameOf = (path: string): string => records.find((record) => record.path === path)?.basename ?? path

  /**
   * THE DRAG (YAZ-991) on ONE row, `fromPath` being the parent this occurrence renders under:
   * `Tree.tsx`'s HTML5 idiom exactly — `dataTransfer` guarded, because jsdom's synthetic drags
   * have none — and the engine's verdict (`canDrop`, never a rule re-derived here) deciding which
   * rows accept a drop at all. An invalid row simply has no `dragover` handler, so it never
   * `preventDefault`s and the browser refuses the drop for us. The pinned Home is out of the
   * gesture on BOTH sides (YAZ-920: it descends into nothing, so a drop there is a root-drop in
   * disguise, which v1 does not do). The drop opens the sheet and writes nothing.
   */
  const dragOn = (member: IndexRecord, fromPath: string | null) => {
    const pinned = member.path === homePath
    const target = !pinned && dragging !== null && canDrop(dragging.child, member, lookup).ok
    return {
      draggable: !pinned,
      onDragStart: (e: React.DragEvent) => {
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        setDragging({ child: member, fromPath })
      },
      onDragEnd: () => {
        setDragging(null)
        setDropPath(null)
      },
      onDragOver: target
        ? (e: React.DragEvent) => {
            e.preventDefault() // this row accepts the drop; without it the browser would refuse
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
            if (dropPath !== member.path) setDropPath(member.path)
          }
        : undefined,
      onDragLeave: target
        ? () => {
            if (dropPath === member.path) setDropPath(null)
          }
        : undefined,
      onDrop: target
        ? (e: React.DragEvent) => {
            e.preventDefault()
            if (dragging === null) return
            setMoving({ child: dragging.child, fromPath: dragging.fromPath, target: member })
            setDragging(null)
            setDropPath(null)
          }
        : undefined,
    }
  }

  /** The confirmed move: the engine's card write (+ the source outline's), then the sheet goes. Nothing re-renders here —
      the index echo carries the new belonging, exactly as it carries every other change. */
  const runMove = async (move: PendingMove): Promise<void> => {
    try {
      await performMove(
        move.child,
        // The source RECORD: its outline drops the moved line (YAZ-1364, 🔒 D4). Null = Uncategorized.
        feed.records.find((record) => record.path === move.fromPath) ?? null,
        { path: move.target.path, name: move.target.basename, columns: folderPageSettings(move.target).columns },
        resolve ?? NEVER,
      )
    } catch (err: unknown) {
      // The sidebar's standing route for a failed file op (`setFolderPageFlag`'s idiom, YAZ-840):
      // the passive notice — never a second dialog on top of the one just dismissed.
      onNotice(`Can't move "${move.child.basename}" into "${move.target.basename}": ${err instanceof Error ? err.message : String(err)}`)
    }
    setMoving(null)
  }

  // A page stands under EVERY parent that claims it (⚡ D6), so one path can own several rows —
  // but an inline input is ONE input: two autofocused ones would fight, the second's mount
  // blurring (and so COMMITTING, since YAZ-1553) the first. Both land on the FIRST occurrence in document order,
  // which the top-down traversal below makes deterministic. Reset every render, never state.
  let renameRendered = false
  let createRendered = false

  /** The rename input in place of THIS file or disk-folder row, or null when it is not the target. */
  const renameOn = (path: string, initial: string, indent: number): ReactNode => {
    if (renaming === null || renaming.path !== path || renameRendered) return null
    renameRendered = true
    return <RenameInline initial={initial} indent={indent} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
  }

  /**
   * The create input pending at the ROOT — a right-click on blank space, which names no row
   * (YAZ-948). Claims the same one-input budget as `createUnder` below, so a pending create is
   * drawn exactly once whichever gesture started it.
   */
  const rootCreate: ReactNode =
    creating === null || creating.anchorPath !== null ? null : ((createRendered = true),
    (
      <li key="\u241Fnew">
        <CreateInline kind={creating.kind} seed={creating.seed} indent={8} onSubmit={creating.onSubmit} onCancel={creating.onCancel} />
      </li>
    ))

  /** The create input pending beneath this page or disk-folder anchor, as its own `<li>`. */
  const createUnder = (anchorPath: string, indent: number): ReactNode => {
    if (creating === null || creating.anchorPath !== anchorPath || createRendered) return null
    createRendered = true
    return (
      // `␟` (U+241F) separates the key's parts: a printable character that cannot appear in a
      // path or a name, so the key stays unique. It replaces a literal NUL, which did the same
      // job but made this file grep-invisible — `grep` treats a NUL byte as binary and skips it.
      <li key={`${anchorPath}␟new`}>
        <CreateInline kind={creating.kind} seed={creating.seed} indent={indent} onSubmit={creating.onSubmit} onCancel={creating.onCancel} />
      </li>
    )
  }

  const toggleUncategorizedFolder = (path: string): void => {
    setCollapsedUncategorizedFolders((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  const uncategorizedPageRow = (record: IndexRecord, depth: number): ReactNode[] => {
    const indent = 8 + depth * 14
    const inline = renameOn(record.path, record.basename, indent)
    const born = createUnder(record.path, indent)
    const row = (
      <li key={record.path} role="treeitem" aria-selected={record.path === activeFile || selection.paths.has(record.path)}>
        {inline ?? (
          <button
            type="button"
            className={`tree__row${record.path === activeFile ? ' tree__row--active' : ''}${selection.paths.has(record.path) ? ' tree__row--selected' : ''}${dropPath === record.path ? ' tree__row--drop' : ''}`}
            style={{ paddingLeft: indent }}
            title={record.path}
            data-path={record.path}
            onClick={(e) => open(record.path, e)}
            onContextMenu={(e) => onRowContextMenu({ type: 'file', path: record.path }, e)}
            // Disk ancestry remains visual organization, not TOPIC belonging: however deeply
            // this page sits on disk, a topic drop still gains a belonging from a null source.
            {...dragOn(record, null)}
          >
            <span className="tree__chevron tree__chevron--none" />
            <span className="tree__label">{record.basename}</span>
          </button>
        )}
      </li>
    )
    return born === null ? [row] : [row, born]
  }

  const uncategorizedRows = (tree: UncategorizedDiskTree, depth: number): ReactNode[] => [
    ...tree.folders.map((folder) => {
      const path = absoluteDiskFolder(root, folder.path)
      const indent = 8 + depth * 14
      const born = createUnder(path, 8 + (depth + 1) * 14)
      const isOpen = born !== null || !collapsedUncategorizedFolders.has(folder.path)
      const inline = renameOn(path, folder.name, indent)
      return (
        <li key={folder.path} role="treeitem" aria-expanded={isOpen} aria-selected={selection.paths.has(path)}>
          {inline ?? (
            <button
              type="button"
              className={`tree__row tree__row--dir${selection.paths.has(path) ? ' tree__row--selected' : ''}`}
              style={{ paddingLeft: indent }}
              title={path}
              data-path={path}
              data-uncategorized-folder={folder.path}
              // The Files dir row's rule (YAZ-1578, 🔒 D1; D9, YAZ-1674): shift toggles the folder
              // in or out of the selection and never folds; a plain click SELECTS it and folds.
              onClick={(e) => {
                if (e.shiftKey) {
                  selection.toggle(path)
                  return
                }
                selection.set(path)
                toggleUncategorizedFolder(folder.path)
              }}
              onContextMenu={(e) => onRowContextMenu({ type: 'dir', path }, e)}
            >
              <span className={`tree__chevron${isOpen ? ' tree__chevron--open' : ''}`} />
              <span className="tree__label">{folder.name}</span>
            </button>
          )}
          {isOpen && (
            <ul className="tree" role="group">
              {born}
              {uncategorizedRows(folder, depth + 1)}
            </ul>
          )}
        </li>
      )
    }),
    ...tree.pages.flatMap((record) => uncategorizedPageRow(record, depth)),
  ]

  const rowsFor = (members: readonly IndexRecord[], depth: number, ancestors: readonly string[]): ReactNode[] =>
    members.flatMap((member) => {
      // `trail` is the ancestor PATH of this row's own subtree — it is what guards the descent,
      // and (joined) what makes the React key unique for a page rendered under two parents.
      const trail = [...ancestors, member.path]
      const isFolderPage = lookup.isFolderPage(member)
      const kids = childrenFor(member, trail)
      const isOpen = kids.length > 0 && expanded.has(member.path)
      const active = member.path === activeFile
      const picked = selection.paths.has(member.path)
      const indent = 8 + depth * 14
      const inlineRename = renameOn(member.path, member.basename, indent)
      const row = (
        <li key={trail.join('>')} role="treeitem" aria-expanded={kids.length > 0 ? isOpen : undefined} aria-selected={active || picked}>
          {/* Rename (YAZ-865) replaces the row exactly as it does in the file tree — never beside it. */}
          {inlineRename ?? (
            <button
              type="button"
              className={`tree__row${isFolderPage ? ' tree__row--dir' : ''}${active ? ' tree__row--active' : ''}${picked ? ' tree__row--selected' : ''}${dropPath === member.path ? ' tree__row--drop' : ''}`}
              style={{ paddingLeft: indent }}
              title={member.path}
              data-path={member.path}
              // The row's SOURCE is the parent it renders under (YAZ-991) — the last ancestor on
              // this occurrence's trail, and null for a ROOT row, which stands under nobody.
              {...dragOn(member, ancestors[ancestors.length - 1] ?? null)}
              onClick={(e) => {
                // The MOUSE half (⚡ YAZ-870, amended by YAZ-921): a click opens AND unfolds
                // (⌘ says "not now"), and a click on the TOPIC you are already reading toggles
                // the fold — a second knock is not navigation. The KEYBOARD half (detail 0,
                // Enter through the walk — YAZ-936) never moves the tree at all: Enter just
                // opens the page, ←/→ are the fold gestures, so previewing topics never
                // rearranges the panel underfoot.
                const keyboard = e.detail === 0
                // Shift selects and does NOTHING else (YAZ-1336, 🔒 D2), the fold included: on a
                // topic, selecting the page must not also rearrange the tree under the cursor.
                if (e.shiftKey) {
                  open(member.path, e)
                  return
                }
                if (!keyboard && active && kids.length > 0 && !e.metaKey) {
                  selection.set(member.path) // the fold-only click selects too (D9, YAZ-1674)
                  toggle(member.path)
                  return
                }
                open(member.path, e)
                if (!keyboard && kids.length > 0 && !e.metaKey) expand(member.path)
              }}
              onContextMenu={(e) => onRowContextMenu({ type: 'file', path: member.path }, e)}
            >
              {kids.length > 0 ? (
                // 🔒 D3: the chevron is its OWN hit target — expanding a topic is not opening it.
                // (The row around it opens AND unfolds since ⚡ YAZ-870; the chevron alone folds.)
                <span
                  role="button"
                  className={`tree__chevron${isOpen ? ' tree__chevron--open' : ''}`}
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${member.basename}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(member.path)
                  }}
                />
              ) : (
                <span className="tree__chevron tree__chevron--none" />
              )}
              {/* Home wears the HOUSE (YAZ-920), not the folder glyph — it is the vault's front
                  door, not one topic among the others — and counts nothing: its members are the
                  roots below it. */}
              {member.path === homePath ? (
                <svg className="tree__glyph" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2.5 7.5 8 2.5l5.5 5v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
                  <path d="M6.5 14v-4h3v4" />
                </svg>
              ) : (
                isFolderPage && <FolderPageGlyph className="tree__glyph" />
              )}
              <span className="tree__label">{member.basename}</span>
              {/* DIRECT members — the honest fact about the page, so a member hidden from THIS
                  branch by the loop guard is still counted where it belongs. The chevron above
                  asks the guarded question instead, so it never opens onto nothing. */}
              {isFolderPage && member.path !== homePath && <span className="tree__count">{lookup.pagesIn(member.path).length}</span>}
            </button>
          )}
        </li>
      )
      // The create input sits directly under the row it was asked from — a SIBLING on disk, so
      // it wears that row's own indent — and above whatever the row is expanded onto.
      const born = createUnder(member.path, indent)
      const below = isOpen ? rowsFor(kids, depth + 1, trail) : []
      return born === null ? [row, ...below] : [row, born, ...below]
    })

  // The offer's live half (see the module doc): `resolve` is null until the first index lands, and
  // a card shown then would be asking about a vault nobody has read yet.
  const offerHome = unadopted && resolve !== null && resolve(HOME_LINK) === null

  // Keyboard walking (YAZ-921): ↑/↓ rove focus across every visible row — topics, pages and the
  // Uncategorized rows alike (they all wear `.tree__row`) — and Enter is simply the row's own
  // click (the rows are buttons), so open/unfold/toggle need no second contract. From outside
  // the rows, ↓ enters at the top and ↑ at the bottom.
  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // The move sheet stands INSIDE this div (it is the tree's own state), so while it is open the
    // keyboard is entirely its own (YAZ-991): ↑/↓ must not rove — or ←/→ fold — the rows behind a
    // modal whose focus lives on Cancel.
    if (moving !== null) return
    // ←/→ fold and unfold the row underfoot WITHOUT visiting it (Enter is the visit) — the
    // ARIA-tree convention, and the only way to tidy topics mid-walk. Chevron-less leaves
    // (`--none`, and the pathless Uncategorized header) fold nothing.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const row = document.activeElement
      if (!(row instanceof HTMLElement)) return
      if (row.querySelector('.tree__chevron:not(.tree__chevron--none)') === null) return
      const diskFolder = row.dataset.uncategorizedFolder
      if (diskFolder !== undefined) {
        e.preventDefault()
        const isOpen = !collapsedUncategorizedFolders.has(diskFolder)
        if (e.key === 'ArrowLeft' ? isOpen : !isOpen) toggleUncategorizedFolder(diskFolder)
        return
      }
      if (row.dataset.path === undefined) return
      e.preventDefault()
      const isOpen = expanded.has(row.dataset.path)
      if (e.key === 'ArrowLeft' ? isOpen : !isOpen) toggle(row.dataset.path)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.tree__row'))
    if (rows.length === 0) return
    e.preventDefault()
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'ArrowDown' ? (at === -1 ? 0 : Math.min(at + 1, rows.length - 1)) : at === -1 ? rows.length - 1 : Math.max(at - 1, 0)
    rows[next]?.focus()
  }

  return (
    <div ref={hostRef} onKeyDown={onTreeKeyDown}>
      {offerHome && (
        <div className="topics-offer">
          <p className="topics-offer__title">Your map starts here</p>
          <p className="topics-offer__body">A Home page is the top of your topics. Making one adds a single note to this folder.</p>
          <button type="button" className="btn btn--primary topics-offer__go" onClick={onCreateHome}>
            Create Home
          </button>
        </div>
      )}
      {(roots.length > 0 || rootCreate !== null) && (
        <ul className="tree" role="tree" aria-label="Topics">
          {/* A blank-space create belongs to the ROOT (YAZ-948), so it stands above the roots at
              their own indent — and it is the whole tree when there are no roots yet. */}
          {rootCreate}
          {rowsFor(roots, 0, [])}
        </ul>
      )}
      {orphans.length > 0 && (
        <ul className="tree tree--uncategorized" role="tree" aria-label="Uncategorized">
          <li role="treeitem" aria-expanded={showOrphans}>
            {/* 🔒 D7: the whole row toggles — there is no page behind it to open. */}
            <button type="button" className="tree__row tree__row--muted" style={{ paddingLeft: 8 }} onClick={() => setShowOrphans((on) => !on)}>
              <span className={`tree__chevron${showOrphans ? ' tree__chevron--open' : ''}`} />
              <span className="tree__label">Uncategorized</span>
              <span className="tree__count">{orphans.length}</span>
            </button>
            {showOrphans && (
              <ul className="tree" role="group">
                {/* Pages keep every Topics gesture at every disk depth. Folder rows fold this
                    projection and share Files directory actions, but never topic drag semantics. */}
                {uncategorizedRows(orphanDiskTree, 1)}
              </ul>
            )}
          </li>
        </ul>
      )}
      {moving !== null && (
        // 🔒 The drop asks before it writes (YAZ-959): the sheet names the page, the parent this
        // ROW came from and the topic it landed on — and, because a page can belong to several
        // folder pages, the ones this move leaves alone. `already-parent` is refused upstream, so
        // the target itself can never be among them.
        <ConfirmMove
          page={moving.child.basename}
          from={moving.fromPath === null ? null : nameOf(moving.fromPath)}
          to={moving.target.basename}
          others={lookup
            .folderPagesOf(moving.child.path)
            .filter((path) => path !== moving.fromPath)
            .map(nameOf)}
          onConfirm={() => void runMove(moving)}
          onCancel={() => setMoving(null)}
        />
      )}
    </div>
  )
}
