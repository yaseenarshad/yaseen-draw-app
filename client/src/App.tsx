import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { isViewOnly } from '@shared/fileKind'
import { MAIN_WORKSPACE_MIN_W, SIDEBAR_MAX_W, SIDEBAR_MIN_W, type CommentsOrder, type SettingsState, type SidebarLens, type TreeNode } from '@shared/types'
import { api, BridgeRequestError } from './api'
import { applyCrepeTheme } from './editor/crepeTheme'
import { Editor } from './editor/Editor'
import { newNoteBase } from './editor/wikilink/createFromLink'
import { createWikilinkCandidateSource } from './editor/wikilink/wikilinkPicker'
import { createWikilinkResolveSource } from './editor/wikilink/wikilinkPlugin'
import { createViewOnlyLinkSource } from './editor/wikilink/viewOnlyLinkSource'
import { useProperties } from './views/useProperties'
import { WikilinkIndexBridge } from './editor/wikilink/WikilinkIndexBridge'
import { useGithubSync } from './hooks/useGithubSync'
import { useLinkEvents } from './hooks/useLinkEvents'
import { useMenuEvents } from './hooks/useMenuEvents'
import { requestZoom } from './editor/zoomRequest'
import { usePickFolder } from './hooks/usePickFolder'
import { useWatch } from './hooks/useWatch'
import { countLinkReferences, renameNotice, updateLinksAfterRename } from './links/renameLinks'
import { buildViewOnlyCatalog, type ViewOnlyCatalog } from './links/viewOnlyCatalog'
import { useExternalRenames } from './links/useExternalRenames'
import { ownsCopyPathHotkey } from './lib/copyPathHotkey'
import { fileClipboardVerb } from './lib/fileClipboardHotkey'
import { LINK_NOTICE_MS, type Notice, type NoticeKind } from './lib/notice'
import { NoticeIcon } from './components/NoticeIcon'
import { basename } from './lib/paths'
import { carryEditorAcrossRename, carryEditorsAcrossDirRename, flushRenamedDir, flushRenamedPath, retireDeletedDir, retireDeletedPath } from './lib/renameContinuity'
import { EMPTY_SELECTION, orderedSelection } from './lib/selection'
import { storage } from './lib/storage'
import { ownsSidebarHotkey } from './lib/sidebarHotkey'
import { attentionCopy, buildSetupPrompt } from './lib/syncAttention'
import { resolveTheme, useSystemPrefersDark } from './lib/theme'
import { fileHash } from './lib/urlHash'
import { windowTitle } from './lib/windowTitle'
import { ConfirmRename, isNameChange } from './sidebar/ConfirmRename'
import { useEnsureHome } from './sidebar/ensureHome'
import { SettingsDialog } from './settings/SettingsDialog'
import { type SidebarClipboard, Sidebar } from './sidebar/Sidebar'
import type { SidebarRevealRequest } from './sidebar/revealRow'
import { TabBar } from './tabs/TabBar'
import { RightPanel } from './right-panel/RightPanel'
import type { PageDrag } from './workspace/pageDrag'
import { useWorkspace } from './workspace/useWorkspace'
import { Welcome } from './Welcome'

/** Reflect the open file in the URL (GRO-2069); replaceState keeps Back sane. */
function syncHash(path: string | null): void {
  history.replaceState(null, '', fileHash(path) || location.pathname + location.search)
}


// A workspace state change still re-renders App, but unchanged retained editors must not render
// with it: a folder page's Board runs layout animation after every render, so an unrelated right
// header click would otherwise remeasure and visibly nudge its cards.
const RetainedEditor = memo(Editor)

/**
 * Keeps the current-page navigation function stable for the lifetime of one retained right
 * editor. Crepe's lifecycle effect depends on this callback; creating it inside App's map would
 * destroy and rebuild every right-side editor whenever any header expanded or collapsed.
 */
function RightWorkspaceEditor({ path, navigate, ...props }: Omit<ComponentProps<typeof Editor>, 'onOpenFile'> & {
  path: string
  navigate: (from: string, to: string) => void
}) {
  const openFile = useCallback((to: string) => navigate(path, to), [navigate, path])
  return <RetainedEditor {...props} path={path} onOpenFile={openFile} />
}

export function App() {
  const [root, setRoot] = useState<string | null>(storage.getRoot)
  // Workspace (Tabs I2 + YAZ-966): one renderer-owned model, seeded from the boot identity snapshot
  // (a pasted `#/abs/path.md` URL wins as the active tab — bootTabs). The ACTIVE tab is this
  // window's `file`: title, URL hash and the sidebar highlight all follow it.
  const {
    tabs, active: file, mounted, openCurrent, openBackground, activate, close: closeTab, move: moveTab,
    closeActive, next: nextTab, prev: prevTab, back, forward, canBack, canForward, reset: resetTabs,
    renamePath: renameWorkspacePath, renameDirPath: renameWorkspaceDir, deletePath: deleteWorkspacePath, deleteDirPath: deleteWorkspaceDir,
    rightPanel, rightMounted, openRight, openRightBackground, navigateRight, toggleRight, closeRight,
    moveRight, transferMainToRight, transferRightToMain,
    rightBack, rightForward, canRightBack, canRightForward, setRightOpen, setRightWidth,
  } = useWorkspace(root)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storage.getSidebarCollapsed)
  const sidebarCollapsedRef = useRef(sidebarCollapsed)
  const [sidebarWidth, setSidebarWidth] = useState(storage.getSidebarWidth)
  // The sidebar's active LENS (🔒 D4, YAZ-847): App-owned and persisted because the Sidebar is
  // mounted `key={root}` and only while open; sidebar-local view state would reset on every
  // collapse/reopen and root switch. Window identity like visibility since YAZ-1628 — one
  // `WindowEntry.sidebarLens`; never a second flag.
  const [sidebarLens, setSidebarLens] = useState(storage.getSidebarLens)
  // ⌘⇧C's read-only window onto the sidebar's multi-selection (🔒 D4, YAZ-1338). App owns the
  // BOX and the chord; the Sidebar owns the selection (🔒 D1) and writes it in here, emptying it
  // when it unmounts. A ref rather than state on purpose: App needs the answer only at the
  // moment the key is pressed, and re-rendering this whole window on every shift+click would be
  // a real cost for a fact nothing on screen up here shows.
  const sidebarSelection = useRef<ReadonlySet<string>>(EMPTY_SELECTION)
  // ⌘C / ⌘X / ⌘V's handle (D6 amended, YAZ-1674): the mounted Sidebar's two verbs, null while collapsed.
  const sidebarClipboard = useRef<SidebarClipboard | null>(null)
  const sidebarRevealId = useRef(0)
  const [sidebarRevealRequest, setSidebarRevealRequest] = useState<SidebarRevealRequest | null>(null)
  const [resizing, setResizing] = useState(false)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [settings, setSettings] = useState(storage.getSettings)
  const watch = useWatch(root)
  // Wikilinks (Links A, GRO-2190): ONE resolve source per window — a stable object every
  // editor's wikilink plugin subscribes to; WikilinkIndexBridge (below) keeps it fed from the
  // vault index, so index changes restyle links live without any editor remounting. The stable
  // navigation-only source beside it is tree-derived; only the picker's rows compose both feeds.
  const [wikilinks] = useState(createWikilinkResolveSource)
  const [wikilinkCandidates] = useState(createWikilinkCandidateSource)
  const [viewOnlyLinks] = useState(createViewOnlyLinkSource)
  // The vault's property DECLARATIONS (YAZ-835), owned here for the same reason `wikilinks` is:
  // ONE per window, threaded down rather than re-fetched per surface. It is the editor ladder's
  // rung 2 inside a folder page's contents block (YAZ-846) — Editor → FolderPageContents.
  const { properties: propertyDecls } = useProperties(root)
  // GitHub sync (YAZ-1081 3A/3B), owned here for the same reason: ONE per window. Two surfaces
  // read it — the editor's chip (every mounted tab) and the settings cog's section — and they
  // must never disagree, which two hooks watching the same root eventually would.
  const githubSync = useGithubSync(root)
  // The attention banner (3B): passive, exactly like the external-rename one — `role="status"`,
  // explicit buttons, never a modal. Sync failing is not worth stealing focus over; the vault
  // still works, and the note in front of the user is untouched.
  //
  // Dismissal is per-PROBLEM, not per-session: it resets on ANY transition of state or reason,
  // so a retry that fails again — or a different failure — says so rather than staying silent
  // because the user waved off an earlier one.
  const [syncDismissed, setSyncDismissed] = useState(false)
  const syncState = githubSync.status?.state ?? null
  const syncReason = githubSync.status?.attention ?? null
  useEffect(() => {
    setSyncDismissed(false)
  }, [syncState, syncReason])
  const syncCopy = githubSync.status === null ? null : attentionCopy(githubSync.status)
  // ⌘K's half of the search-bar focus handshake (YAZ-801, wired in YAZ-804): `openSearch` sets it
  // (including the collapsed case, which un-collapses and mounts the sidebar with the flag already
  // true); the sidebar focuses its input and clears it through the callback.
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false)
  const searchFocusHandled = useCallback(() => setPendingSearchFocus(false), [])

  // Settings and sidebar width are global. Visibility (YAZ-1280) and the lens (YAZ-1628) are
  // window identity and never follow another renderer's `state:changed` broadcast.
  useEffect(
    () =>
      storage.subscribe(() => {
        setSettings(storage.getSettings())
        setSidebarWidth(storage.getSidebarWidth())
      }),
    [],
  )

  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const visibleSidebarWidth = root !== null && !sidebarCollapsed ? sidebarWidth : 0
  const rightOverlay = rightPanel.open && windowWidth < visibleSidebarWidth + rightPanel.width + MAIN_WORKSPACE_MIN_W

  const toggleSidebar = useCallback(() => {
    const next = !sidebarCollapsedRef.current
    sidebarCollapsedRef.current = next
    storage.setSidebarCollapsed(next)
    setSidebarCollapsed(next)
  }, [])

  // Renderer bubble phase is deliberate: Milkdown and other focused tools get first ownership.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!ownsSidebarHotkey(event)) return
      event.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleSidebar])

  // Dragging past 60% of the minimum reads as "close it" rather than "make it tiny" — the
  // sidebar collapses and the remembered width stays whatever it was before the drag.
  const startSidebarResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      const start = sidebarWidth
      const x0 = e.clientX
      let raw = start
      let width = start
      const move = (ev: MouseEvent) => {
        raw = start + ev.clientX - x0
        width = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, raw))
        setSidebarWidth(width)
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        document.body.style.cursor = ''
        setResizing(false)
        if (raw < SIDEBAR_MIN_W * 0.6) {
          setSidebarWidth(start)
          toggleSidebar()
        } else if (width !== start) storage.setSidebarWidth(width)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
      document.body.style.cursor = 'col-resize'
      setResizing(true)
    },
    [sidebarWidth, toggleSidebar],
  )

  const changeSettings = useCallback((next: SettingsState) => {
    storage.setSettings(next)
    setSettings(next)
  }, [])

  /** A lens tab click (YAZ-847): write through to this window's identity, then mirror it locally. */
  const changeLens = useCallback((next: SidebarLens) => {
    storage.setSidebarLens(next)
    setSidebarLens(next)
  }, [])

  // Files & Links (C2-, GRO-2240; YAZ-1643): where a bare unresolved [[link]] creates its page —
  // the "default location for new notes" setting resolved against this window's root + the
  // CALLING editor's own path (`sourcePath`: the page the link was clicked or typed in, so a
  // right-panel or folder-page editor creates beside itself, never beside the main tab).
  // A ref-backed getter: the value recomputes at CLICK time from whatever settings are current
  // (settings changes broadcast via storage.subscribe land in `settings` above), while the
  // callback identity stays stable — it sits in CrepeHost's effect deps, and a new identity
  // would remount every open editor.
  const newNoteFolderInputs = useRef({ settings, root })
  newNoteFolderInputs.current = { settings, root }
  const newNoteFolderFor = useCallback((sourcePath: string) => {
    const { settings: s, root: r } = newNoteFolderInputs.current
    return r === null ? '' : newNoteBase(s, r, sourcePath)
  }, [])
  // The comment stream's order toggle (YAZ-1515) writes the setting through the same ref-backed,
  // stable door: `RetainedEditor` is `memo(Editor)`, and a fresh arrow per render would re-render
  // every retained editor tree on any App state change.
  const changeCommentsOrder = useCallback((order: CommentsOrder) => changeSettings({ ...newNoteFolderInputs.current.settings, commentsOrder: order }), [changeSettings])

  // Appearance (Desktop K, GRO-2218): `system` tracks the OS live; explicit values win.
  // `data-theme` goes on <html> so body / fixed overlays follow app.css's dark tokens, and
  // the Crepe frame vars swap in the same commit (CSS-only — the open editor never remounts).
  // storage.init() resolves before the first render, so the first paint is already themed.
  const prefersDark = useSystemPrefersDark()
  const theme = resolveTheme(settings.theme, prefersDark)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    applyCrepeTheme(theme)
  }, [theme])

  // Editor spacing settings land as CSS custom properties; app.css consumes them (GRO-2024).
  // Bullet threading and content width are CSS gates too — no editor remount.
  const settingsVars = {
    '--edit-line-height': settings.lineSpacing,
    '--edit-block-gap': `${settings.blockGap}px`,
    '--thread-width': `${settings.threadWidth}px`,
    // Absent → bulletThreading.css falls back to the app accent.
    ...(settings.threadColor !== null ? { '--thread-color': settings.threadColor } : {}),
    '--side-w': `${sidebarWidth}px`,
  } as CSSProperties

  // The URL hash mirrors the ACTIVE tab (GRO-2069; rule 17: on boot the hash already won as
  // the active tab in bootTabs, so this first run is a no-op re-write of the same hash).
  useEffect(() => syncHash(file), [file])

  // The OS window title mirrors what is open (C3, GRO-2165); Electron follows document.title.
  useEffect(() => {
    document.title = windowTitle(root, file)
  }, [root, file])

  /**
   * Switch this window to `path` in place (C3, GRO-2165). Resolves false — and drops the dead
   * MRU entry — when the folder is gone on disk (C2), leaving the window as it is; any other
   * probe failure still switches, and the sidebar surfaces the error.
   */
  const openRoot = useCallback(async (path: string): Promise<boolean> => {
    try {
      await api.tree(path)
    } catch (err) {
      if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) {
        storage.removeRecentRoot(path)
        return false
      }
    }
    storage.setRoot(path) // ONE identity write: { root, file: null, tabs: [] } (Tabs rule 13)
    storage.pushRecentRoot(path)
    setSidebarRevealRequest(null)
    setRoot(path)
    // The folder's remembered file becomes the sole restored tab (D6); reset mirrors it down.
    resetTabs(path, storage.getLastFile(path))
    return true
  }, [resetTabs])

  const { pick, picking } = usePickFolder({ onPicked: openRoot })

  // ⌘W ladder (Tabs rule 7): close the active tab; with zero tabs open (incl. Welcome) close
  // the WINDOW through the real close path so the close/flush handshake runs.
  const closeTabOrWindow = useCallback(() => {
    if (!closeActive()) void window.yaseenDocs.window.closeSelf()
  }, [closeActive])

  // ⌘K (D4, YAZ-804): un-collapse this window through the one persisted toggle path, then ask
  // the sidebar to focus its search bar (it mounts with the flag already true).
  const openSearch = useCallback(() => {
    if (sidebarCollapsed) toggleSidebar()
    setPendingSearchFocus(true)
  }, [sidebarCollapsed, toggleSidebar])

  // ⌘O (YAZ-1767 D8): the ⌘K handshake for the vault switcher — un-collapse first, then bump a
  // request counter the sidebar header's panel consumes. The request is pinned to the root it was
  // made on: the Sidebar remounts `key={root}`, and a stale counter must not reopen the panel on
  // the vault an in-place "Open folder…" just switched to. Welcome (root null) has no switcher.
  const [switcherRequest, setSwitcherRequest] = useState<{ seq: number; root: string | null }>({ seq: 0, root: null })
  const openVaultSwitcher = useCallback(() => {
    if (root === null) return
    if (sidebarCollapsed) toggleSidebar()
    setSwitcherRequest((prev) => ({ seq: prev.seq + 1, root }))
  }, [root, sidebarCollapsed, toggleSidebar])

  const showInSidebar = useCallback((path: string) => {
    if (sidebarCollapsed) toggleSidebar()
    // Favorites is a SUBSET of the vault (YAZ-1766 D1): a reveal there hops to Files, where every row exists.
    const lens = sidebarLens === 'favorites' ? 'files' : sidebarLens
    if (lens !== sidebarLens) changeLens(lens)
    setSidebarRevealRequest({ id: ++sidebarRevealId.current, path, lens })
  }, [sidebarCollapsed, sidebarLens, toggleSidebar, changeLens])

  // A folder search row (🔒 D3, YAZ-1491): always the FILES lens, whichever tab was showing. The
  // sidebar is necessarily open (the row was clicked in it), so no un-collapse step here.
  const revealInFiles = useCallback((path: string) => {
    changeLens('files')
    setSidebarRevealRequest({ id: ++sidebarRevealId.current, path, lens: 'files' })
  }, [changeLens])

  const consumeSidebarReveal = useCallback((id: number) => {
    setSidebarRevealRequest((request) => request?.id === id ? null : request)
  }, [])

  // The settings dialog (YAZ-1679) is App's so the sidebar cog, ⌘, and the app menu's Settings…
  // open the ONE dialog — and it can open with the sidebar collapsed. `open`/`close` are stable
  // because `useMenuEvents` resubscribes whenever a callback identity changes.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  // File › Open Folder… / Open Recent (GRO-2161) reuse the same flows as the in-app buttons;
  // File › Close Tab and Window › Next/Previous Tab (GRO-2232) drive the tab model.
  useMenuEvents({ onOpenFolder: pick, onOpenRoot: openRoot, onSearch: openSearch, onSwitchVault: openVaultSwitcher, onSettings: openSettings, onToggleSidebar: toggleSidebar, onCloseTab: closeTabOrWindow, onNextTab: nextTab, onPrevTab: prevTab, onZoom: requestZoom })

  // Deep links (E1, GRO-2171): a routed link behaves like a sidebar click (Tabs rule 10) —
  // it activates the file's tab when already open, else opens it in the CURRENT tab;
  // a link that could not open shows a transient notice — unobtrusive, never a dialog.
  const [notice, setNotice] = useState<Notice | null>(null)
  // The one door every surface uses (D10 amended, YAZ-1674): text plus an optional glyph kind,
  // `'info'` unless the caller names one — so nothing that already said `onNotice(text)` changed.
  const notify = useCallback((text: string, icon: NoticeKind = 'info') => setNotice({ text, icon }), [])
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), LINK_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])
  useLinkEvents({ onOpenFile: openCurrent, onNotice: notify })

  /**
   * ⌘⇧C copies paths (🔒 D4, YAZ-1338) — the multi-selection when one is standing, else the file
   * you are looking at, so the chord answers with the sidebar collapsed too. The listener is
   * App's for the same reason ⌘B's is (YAZ-1280): the Sidebar unmounts while hidden, and a window
   * shortcut cannot live in a panel that comes and goes. It reads the selection through
   * `sidebarSelection`, the box the Sidebar keeps current and empties on its way out (🔒 D1: the
   * state itself never leaves that component) — read here, never written.
   *
   * ORDER is the panel's, through the one `orderedSelection` the context menu's plural items use,
   * so ⌘⇧C and "Copy N paths" can never spell one selection two ways. With the sidebar hidden
   * there is no `.sidebar__body` to read an order from, and the set's own order is the answer.
   *
   * With nothing selected AND nothing open the chord is NOT ours: no preventDefault, so whatever
   * else the platform does with it still happens.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!ownsCopyPathHotkey(event)) return
      const selected = sidebarSelection.current
      const text = selected.size > 0 ? orderedSelection(selected, document.querySelector('.sidebar__body')).join('\n') : file
      if (text === null) return
      event.preventDefault()
      // BOTH outcomes speak through the window's one passive notice (YAZ-1341): the user cannot
      // see a clipboard land, so a copy needs its yes as much as its no.
      const copied = text.split('\n').length
      void navigator.clipboard.writeText(text).then(
        () => notify(copied === 1 ? 'Copied path' : `Copied ${copied} paths`),
        (error: unknown) => notify(`Can't copy path: ${error instanceof Error ? error.message : String(error)}`),
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [file])

  /**
   * ⌘C / ⌘X / ⌘V for the sidebar's FILE clipboard (D6 amended, YAZ-1674) — ⌘⇧C's sibling in every
   * way: a window listener (a panel listener needs focus inside the panel, and after a click on
   * the open file focus sits in the editor — YAZ-961's handoff — while blank space is not
   * focusable at all), the same ownership boundary (`ownsWindowChord`: a field, the ProseMirror
   * editor or a modal keeps the key, so text copy/paste is untouched), and a handle the Sidebar
   * fills and empties. The RULES are the Sidebar's — target, order, the clipboard gate — so
   * this only asks, and swallows the key exactly when a verb says it acted.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const verb = fileClipboardVerb(event)
      if (verb === null) return
      const clipboard = sidebarClipboard.current
      if (clipboard === null) return
      const acted = verb === 'paste' ? clipboard.paste() : clipboard.cutOrCopy(verb)
      if (!acted) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // HOME (6C-, YAZ-849): every ADOPTED vault gets one the first time its index lands — one
  // `Home.md` carrying `folder_page: true`, created automatically, never twice, never over
  // anything. An UN-ADOPTED folder (no `.yaseendocs/`) is not written into at all: `unadopted`
  // rides down to the Topics lens, which offers a card whose button runs the same create. It
  // belongs HERE, beside the window's one index feed, because Home is born on VAULT OPEN — the
  // sidebar is unmounted while collapsed, and the Topics tree only exists on its own lens.
  const { unadopted, createHome } = useEnsureHome(root, wikilinks, openCurrent, notify)

  // External rename/move resilience (Links E1c, GRO-2242 — locked: confirm-first, NEVER
  // automatic, never a dialog): ONE detector fed by the cold-start reconcile diff and by
  // consecutive index snapshots (WikilinkIndexBridge's onSnapshot below), surfacing ONE
  // passive app-level banner at a time. Update → repair the app (file:repair-rename, whose
  // file:renamed push drives the SAME tab/editor downstream as an in-app rename) + rewrite
  // the referencing notes; Dismiss → drop for this session. In-app renames are suppressed
  // through the file:renamed effect below, so their watcher echo never banners.
  const { banner: renameBanner, onSnapshot: onIndexSnapshot, suppress: suppressRenameHypothesis, update: updateRenameBanner, dismiss: dismissRenameBanner } = useExternalRenames(root, notify)
  const relLabel = useCallback((p: string) => (root !== null && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p), [root])

  // In-app rename (Links E1 GRO-2194, folders E1b GRO-2241). `file:renamed` reaches EVERY
  // window (originator included): BEFORE the workspace remap unmounts the old-path editor(s), a
  // dirty buffer is carried into the new path and the old controller retired (no flush to
  // the old path — see lib/renameContinuity.ts); then its main/right owner follows in place,
  // and title/URL-hash track the active main tab through the existing effects above. A `dir`
  // event is a PREFIX remap: every open editor and workspace path under the folder follows, and a window
  // ROOTED at (or under) the folder — a subfolder opened as a vault — follows too (main's
  // store repair already moved its WindowEntry.root; setRoot only mirrors it locally, so
  // no identity write that could clobber the repaired file/tabs).
  useEffect(
    () =>
      window.yaseenDocs.file.onRenamed(({ oldPath, newPath, kind }) => {
        // E1c: an in-app rename's watcher echo (unlink+add with preserved stats) must never
        // be re-offered as an "external rename" hypothesis.
        suppressRenameHypothesis(oldPath, newPath, kind)
        if (kind === 'dir') {
          carryEditorsAcrossDirRename(oldPath, newPath)
          const movedRoot = root !== null && (root === oldPath || root.startsWith(`${oldPath}/`)) ? newPath + root.slice(oldPath.length) : undefined
          renameWorkspaceDir(oldPath, newPath, movedRoot)
          if (movedRoot !== undefined) setRoot(movedRoot)
          return
        }
        carryEditorAcrossRename(oldPath, newPath)
        renameWorkspacePath(oldPath, newPath)
      }),
    [renameWorkspacePath, renameWorkspaceDir, root, suppressRenameHypothesis],
  )

  /**
   * The sidebar's Rename/move commit (files E1, folders + drag-moves E1b): flush our own
   * buffer(s) for the file — or every open editor under the folder — snapshot the index
   * BEFORE the rename (afterwards the old name no longer resolves), rename, then rewrite
   * every referencing note through the shared-resolver engine. All failures land in the
   * passive notice — never a dialog, never a rejection back into the inline input.
   */
  const renameFile = useCallback(
    async (oldPath: string, newPath: string, viewOnlyCatalog: ViewOnlyCatalog | null): Promise<void> => {
      const r = root
      if (r === null) return
      // (a) our own unsaved buffers travel WITH the file(s). The kind is unknown until the
      // rename answers, so both run — each is a no-op for the other kind.
      await flushRenamedPath(oldPath)
      await flushRenamedDir(oldPath)
      let records: Awaited<ReturnType<typeof api.index>>['records'] = []
      try {
        records = (await api.index(r)).records
      } catch {
        records = [] // no index snapshot → the rename still runs, links just stay as they are
      }
      let kind: 'file' | 'dir'
      try {
        kind = (await api.rename({ oldPath, newPath })).kind
      } catch (err) {
        const exists = err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS'
        notify(exists ? `Can't rename: "${basename(newPath)}" already exists` : `Can't rename: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      const hasMovedViewFile = viewOnlyCatalog?.entries.some((entry) =>
        kind === 'dir' ? entry.path.startsWith(`${oldPath}/`) : entry.path === oldPath,
      ) ?? false
      const summary = await updateLinksAfterRename({
        root: r,
        oldPath,
        newPath,
        kind,
        records,
        ...(hasMovedViewFile ? { viewOnlyCatalog } : {}),
      })
      if (summary.updated > 0 || summary.skipped > 0) notify(renameNotice(summary))
    },
    [root],
  )

  /**
   * THE ONE DOOR (⚡ YAZ-888, amending decision E / GRO-2096 for NAME changes). Every rename
   * gesture in the app arrives here as (oldPath, newPath, kind) — the sidebar's inline rename, its
   * drag-move, and the page title — so the rule is asked ONCE, here, and no surface reimplements
   * it: a changed NAME confirms first (the rename chains into the file on disk and then into
   * every note that links to it), a MOVE runs silently exactly as it always has (a confirm on
   * every drag would be hostile, and bare links keep resolving across a move anyway).
   *
   * Markdown-only renames still count synchronously. A ready lightweight catalog may prove a
   * view-only FILE; directories always read one fresh tree so newly arrived descendants count.
   * The chosen snapshot is pinned through confirmation, and a root change cancels the request.
   */
  const [pendingRename, setPendingRename] = useState<{ root: string; oldPath: string; newPath: string; count: number; viewOnlyCatalog: ViewOnlyCatalog | null } | null>(null)
  const renameRootGeneration = useRef(0)
  useLayoutEffect(() => {
    renameRootGeneration.current++
    setPendingRename(null)
  }, [root])

  const catalogForRename = useCallback(async (oldPath: string, kind: TreeNode['type']): Promise<ViewOnlyCatalog | null | undefined> => {
    if (root === null || (kind === 'file' && !isViewOnly(oldPath))) return null
    const requestedRoot = root
    const generation = renameRootGeneration.current
    const current = viewOnlyLinks.catalog
    if (kind === 'file' && current?.root === requestedRoot && current.entries.some((entry) => entry.path === oldPath)) return current
    try {
      const response = await api.tree(requestedRoot)
      if (generation !== renameRootGeneration.current) return undefined
      if (response.root !== requestedRoot) {
        notify("Can't rename: couldn't load the current file list")
        return undefined
      }
      const catalog = buildViewOnlyCatalog(requestedRoot, response.tree)
      if (kind === 'file' && !catalog.entries.some((entry) => entry.path === oldPath)) {
        notify(`Can't rename: "${basename(oldPath)}" is no longer in the current file list`)
        return undefined
      }
      return catalog
    } catch {
      if (generation !== renameRootGeneration.current) return undefined
      notify("Can't rename: couldn't load the current file list")
      return undefined
    }
  }, [root, viewOnlyLinks])

  const requestRename = useCallback(
    async (oldPath: string, newPath: string, kind: TreeNode['type']): Promise<void> => {
      if (root === null) return
      const catalog = await catalogForRename(oldPath, kind)
      if (catalog === undefined) return
      if (!isNameChange(oldPath, newPath)) return renameFile(oldPath, newPath, catalog)
      const records = wikilinks.records
      const hasMovedViewFile = catalog?.entries.some((entry) =>
        kind === 'file' ? entry.path === oldPath : entry.path.startsWith(`${oldPath}/`),
      ) ?? false
      // File-vs-directory comes from the concrete tree/editor gesture. Extension and semantic
      // membership cannot answer it: `Archive.json` may be a directory, while a JSON file has no IndexRecord.
      setPendingRename({
        root,
        oldPath,
        newPath,
        count: countLinkReferences({ root, oldPath, kind, records, ...(hasMovedViewFile ? { viewOnlyCatalog: catalog } : {}) }),
        viewOnlyCatalog: catalog,
      })
    },
    [root, catalogForRename, renameFile, wikilinks],
  )
  const requestEditorRename = useCallback(
    (oldPath: string, newPath: string) => requestRename(oldPath, newPath, 'file'),
    [requestRename],
  )

  const confirmRename = useCallback(() => {
    if (pendingRename === null) return
    if (pendingRename.root !== root) {
      setPendingRename(null)
      return
    }
    const { oldPath, newPath, viewOnlyCatalog } = pendingRename
    setPendingRename(null)
    void renameFile(oldPath, newPath, viewOnlyCatalog)
  }, [root, pendingRename, renameFile])

  /**
   * In-app delete landed (GRO-2272). Reaches EVERY window, originator included.
   *
   * ORDER IS NOT NEGOTIABLE: retire the editor, THEN remap the workspace. Removing a page owner unmounts its
   * editor, and `useAutosave`'s unmount cleanup flushes the live buffer to disk — which would
   * recreate the file that was just trashed. Retiring first makes that flush a no-op. Reverse
   * these two lines and the delete silently fails a second later.
   *
   * A window ROOTED at (or under) a deleted folder is deliberately not repaired here: the
   * sidebar's existing `onRootMissing` probe owns that, and it also drops the dead MRU entry.
   */
  useEffect(
    () =>
      window.yaseenDocs.file.onDeleted(({ path, kind }) => {
        if (kind === 'dir') {
          retireDeletedDir(path)
          deleteWorkspaceDir(path)
          return
        }
        retireDeletedPath(path)
        deleteWorkspacePath(path)
      }),
    [deleteWorkspacePath, deleteWorkspaceDir],
  )

  /**
   * The sidebar's Delete commit (GRO-2272). Deliberately NOT the mirror of `renameFile`, and
   * the two omissions are both load-bearing:
   *
   *  - NO pre-delete flush. `renameFile` flushes so the unsaved buffer travels with the file;
   *    a delete has nowhere to travel to, so flushing would write the file to disk moments
   *    before trashing it — pointless at best, racy at worst.
   *  - NO link rewriting. LOCKED decision C (GRO-2272): notes referencing the deleted page are
   *    left BYTE-IDENTICAL; their `[[links]]` simply go unresolved (the Links A decoration
   *    already renders that) and create-on-click restores the page. Deleting one note must
   *    never silently edit N others — a far bigger blast radius than the gesture, and
   *    un-trashing the file would not undo those edits. Do not "fix" this by adding cleanup.
   *
   * Every failure lands in the passive notice, never a dialog; this promise never rejects back
   * into the caller, matching `onRenameFile`.
   */
  const deleteFile = useCallback(async (path: string): Promise<void> => {
    try {
      await api.delete({ path })
    } catch (err) {
      const name = basename(path)
      // A failed trash means NOTHING was deleted — say so, rather than a bare error string.
      notify(
        err instanceof BridgeRequestError && err.code === 'IO_ERROR'
          ? `Can't move "${name}" to the Trash — nothing was deleted`
          : `Can't delete "${name}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [])

  const onRootMissing = useCallback(() => {
    storage.setRoot(null) // one identity write: { root: null, file: null, tabs: [] }
    setSidebarRevealRequest(null)
    setRoot(null)
    resetTabs(null, null)
  }, [resetTabs])
  // The ACTIVE file vanished on disk: close its tab, ⌘W-style (a neighbour takes over).
  const onFileMissing = useCallback(() => void closeActive(), [closeActive])

  const editorCommon = root === null ? null : {
    root,
    watch,
    onNotice: notify,
    newNoteFolderFor,
    wikilinks,
    wikilinkCandidates,
    viewOnlyLinks,
    properties: propertyDecls,
    onOpenFileRight: openRight,
    onRenameFile: requestEditorRename,
    sync: githubSync.status,
    onSyncNow: githubSync.syncNow,
    // YAZ-1515: the comment stream's order is a SETTING, threaded down like every other one.
    commentsOrder: settings.commentsOrder,
    onChangeCommentsOrder: changeCommentsOrder,
  }

  const dropOnMain = (page: PageDrag, at: number): void => {
    if (page.owner === 'right') transferRightToMain(page.path, at)
  }
  const dropOnRight = (page: PageDrag, at: number): void => {
    if (page.owner === 'main') {
      transferMainToRight(page.path, at)
      return
    }
    const from = rightPanel.items.indexOf(page.path)
    if (from === -1) return
    moveRight(from, at > from ? at - 1 : at)
  }

  return (
    <div className="app" style={settingsVars} data-threading={settings.bulletThreading ? 'on' : 'off'} data-content-width={settings.contentWidth}>
      {notice !== null && (
        // `data-icon` is a test / observability hook — nothing in the CSS selects it; the glyph is the SVG.
        <div className="link-notice" role="status" data-icon={notice.icon}>
          <NoticeIcon icon={notice.icon} />
          <span className="link-notice__text">{notice.text}</span>
        </div>
      )}
      {/* YAZ-1679: unmounted when closed, never hidden. ONE useGithubSync per window (above): the
          dialog's Sync page and the editor's chip read the same status, so they can never
          disagree about what this vault is doing. */}
      {settingsOpen && <SettingsDialog ctx={{ settings, onChange: changeSettings, sync: { status: githubSync.status, setEnabled: githubSync.setEnabled } }} onClose={closeSettings} />}
      {/* E1c (GRO-2242): the passive external-rename confirmation banner — one hypothesis at a
          time, oldest first. Confirm-first, ALWAYS: no rewrite until Update; Dismiss drops it
          for this session. Passive: steals no focus, Esc is not bound, never a dialog. */}
      {renameBanner !== null && (
        <div className="rename-banner" role="status">
          <span className="rename-banner__text">
            Looks like <code>{relLabel(renameBanner.oldPath)}</code> became <code>{relLabel(renameBanner.newPath)}</code> — update {renameBanner.count} link{renameBanner.count === 1 ? '' : 's'}?
          </span>
          <button type="button" onClick={updateRenameBanner}>
            Update
          </button>
          <button type="button" onClick={dismissRenameBanner}>
            Dismiss
          </button>
        </div>
      )}
      {/* 3B: sync needs attention. Two of the five reasons are things this app cannot fix from
          inside itself (git missing, credentials rejected), so the offer is a prompt to paste
          into any LLM — an assistant that CAN drive the terminal — rather than a wizard. */}
      {syncCopy !== null && !syncDismissed && root !== null && githubSync.status !== null && (
        <div className="sync-banner" role="status">
          <span className="sync-banner__text">
            <strong>{syncCopy.title}</strong> {syncCopy.body}
          </span>
          {syncCopy.showSetupPrompt && (
            <button type="button" onClick={() => void navigator.clipboard.writeText(buildSetupPrompt(root, githubSync.status?.attention ?? 'error'))}>
              Copy setup prompt
            </button>
          )}
          <button type="button" onClick={() => setSyncDismissed(true)}>
            Dismiss
          </button>
        </div>
      )}
      {root !== null && !sidebarCollapsed && (
        <Sidebar
          key={root}
          root={root}
          activeFile={file}
          watch={watch}
          onOpenFile={openCurrent}
          onOpenFileBackground={openBackground}
          onRevealInFiles={revealInFiles}
          onPickFolder={pick}
          pickDisabled={picking}
          onCollapse={toggleSidebar}
          // The lens tabs (YAZ-847): App owns the value, the sidebar only renders the row.
          lens={sidebarLens}
          revealRequest={sidebarRevealRequest}
          onRevealConsumed={consumeSidebarReveal}
          onLensChange={changeLens}
          settings={settings}
          onChangeSettings={changeSettings}
          onOpenSettings={openSettings}
          onRootMissing={onRootMissing}
          onFileMissing={onFileMissing}
          onRenameFile={requestRename}
          onDeleteFile={deleteFile}
          onNotice={notify}
          // ⌘⇧C's box (🔒 D4, YAZ-1338): the panel keeps it current, the chord above reads it.
          selectionRef={sidebarSelection}
          // ⌘C / ⌘X / ⌘V's handle (D6 amended, YAZ-1674): the panel fills it, the listener above asks it.
          clipboardRef={sidebarClipboard}
          // The folder-page toggle's flag state (YAZ-840) reads the SAME per-window index source
          // WikilinkIndexBridge already feeds below — read-only, and no second feed.
          indexSource={wikilinks}
          pendingSearchFocus={pendingSearchFocus}
          onSearchFocusHandled={searchFocusHandled}
          // ⌘O (YAZ-1767 D8): only a request made on THIS root counts; any other reads as none.
          switcherOpenRequest={switcherRequest.root === root ? switcherRequest.seq : 0}
          // 6C's offer (YAZ-849): the fact and the button, both App's, both straight through.
          unadopted={unadopted}
          onCreateHome={createHome}
        />
      )}
      {root !== null && !sidebarCollapsed && <div className={`sidebar-resize${resizing ? ' sidebar-resize--active' : ''}`} aria-hidden onMouseDown={startSidebarResize} />}
      {root === null ? (
        <section className="editor">
          {/* No dialog opens by itself (C2, GRO-2164): the Welcome screen offers recents + Open folder…. */}
          <Welcome recents={storage.getRecentRoots()} onOpenRecent={openRoot} onPickFolder={pick} picking={picking} />
        </section>
      ) : (
        <div className="workspace">
          <WikilinkIndexBridge root={root} watch={watch} source={wikilinks} candidates={wikilinkCandidates} viewOnly={viewOnlyLinks} onSnapshot={onIndexSnapshot} />
          {/* Tabs rule 2: the strip shows whenever a folder is open — even with one (or zero) tabs. */}
          <TabBar
            tabs={tabs}
            active={file}
            onActivate={activate}
            onClose={closeTab}
            onMove={moveTab}
            onDropPage={dropOnMain}
            onMoveToRight={(path) => transferMainToRight(path, rightPanel.items.length)}
            canBack={canBack}
            canForward={canForward}
            onBack={back}
            onForward={forward}
            onShowSidebar={sidebarCollapsed ? toggleSidebar : undefined}
            onShowInSidebar={showInSidebar}
            onNotice={notify}
          />
          <div className="tabstack">
            {mounted.length === 0 && editorCommon !== null && <RetainedEditor {...editorCommon} path={null} onOpenFile={openCurrent} onOpenFileBackground={openBackground} />}
            {mounted.map((path) => (
              // Every VISITED tab keeps its editor mounted so scroll/cursor/undo/unsaved buffer
              // survive a switch (rule 6); inactive layers hide via visibility — see tabs.css
              // for why display:none would lose scroll positions.
              <div key={path} className={path === file ? 'tabstack__layer' : 'tabstack__layer tabstack__layer--hidden'}>
                {/* Wiki-link clicks (Links C, GRO-2192) ride the tabs API: plain → openCurrent, ⌘ → openBackground; create failures land in the link-notice. */}
                {editorCommon !== null && <RetainedEditor {...editorCommon} path={path} onOpenFile={openCurrent} onOpenFileBackground={openBackground} />}
              </div>
            ))}
          </div>
        </div>
      )}
      {root !== null && rightPanel.open && (
        <RightPanel
          items={rightPanel.items}
          expanded={rightPanel.expanded}
          width={rightPanel.width}
          overlay={rightOverlay}
          canBack={canRightBack}
          canForward={canRightForward}
          onBack={rightBack}
          onForward={rightForward}
          onToggle={toggleRight}
          onClose={closeRight}
          onHide={() => setRightOpen(false)}
          onResizeCommit={setRightWidth}
          onDropPage={dropOnRight}
          onMoveToMain={(path) => transferRightToMain(path, tabs.length)}
        >
          {editorCommon !== null && (
            <div className="right-panel__editor-stack">
              {rightMounted.map((path) => (
                <div
                  key={path}
                  data-testid={`right-layer-${path}`}
                  className={path === rightPanel.expanded ? 'right-panel__editor-layer' : 'right-panel__editor-layer right-panel__editor-layer--hidden'}
                >
                  <RightWorkspaceEditor
                    {...editorCommon}
                    path={path}
                    navigate={navigateRight}
                    onOpenFileBackground={openRightBackground}
                  />
                </div>
              ))}
            </div>
          )}
        </RightPanel>
      )}
      {root !== null && !rightPanel.open && (
        <button type="button" className="right-panel-reopen" aria-label="Show right panel" title="Show right panel" onClick={() => setRightOpen(true)}>
          ‹
        </button>
      )}
      {/* The name-change confirm (⚡ YAZ-888): App's, not the sidebar's, because the door is
          App's — the title and the tree both reach it, and one sheet answers for both. */}
      {pendingRename !== null && (
        <ConfirmRename
          oldPath={pendingRename.oldPath}
          newPath={pendingRename.newPath}
          count={pendingRename.count}
          onConfirm={confirmRename}
          onCancel={() => setPendingRename(null)}
        />
      )}
    </div>
  )
}
