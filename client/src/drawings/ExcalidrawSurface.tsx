/**
 * THE ENGINE SEAM (YAZ-879, rebuilt for the drawing DOCUMENT in 🔒 YAZ-1810, given its chrome in
 * YAZ-1812).
 *
 * 🔒 ONE FILE OWNS THE CANVAS. This is the only component that mounts `<Excalidraw>`, the only
 * one that knows how a scene serializes, and the only one that knows what "changed" means to the
 * engine. `DrawingEditor` — the autosave, the dirty state, the conflict bar, the chips — imports
 * this module's TYPES and this component and nothing else, so replacing the engine rewrites this
 * file and touches no chrome. `DrawingEditor.test.tsx` mocks this one module and pins that
 * boundary rather than trusting it.
 *
 * LAZY: the engine arrives through `engine.ts`'s `loadExcalidraw()` — one dynamic import per
 * renderer, with the offline font pin and the export-source pin already applied — and the
 * stylesheet rides the same first open, so the entry chunk stays free of both.
 *
 * SNAPSHOTS, NOT A CONTROLLED SCENE: the surface stays UNCONTROLLED (the engine owns its undo,
 * selection and tool state) and reports outward through `onSnapshot`. A snapshot is a cheap
 * change KEY — `getSceneVersion`, the engine's own sum of element versions, which is what it
 * offers for exactly this — plus a `serialize()` that costs nothing until a save fires. The
 * FIRST snapshot is emitted at mount, from the loaded scene, BEFORE the engine's own first
 * `onChange`, so the host always has a baseline to call "clean" even if the engine never
 * volunteers one. That baseline runs the disk elements through the engine's own
 * `restoreElements()` first: restore is what the engine actually mounts (it bumps element
 * `version` and materialises rounding values), so only a restore-then-compare baseline agrees
 * with the engine's first `onChange`, and an untouched drawing never reads as dirty. Restore is
 * deterministic, so the two independent runs always land on the same sum.
 *
 * ⚡ `getSceneVersion` IS A SUM, and a sum is not an identity: an undo that returns to the same
 * total reads CLEAN. Accepted on YAZ-1775 (demo round 1) — the alternative is hashing the
 * serialised scene on every pointer move, which is the cost the version exists to avoid, and the
 * failure mode is "a redundant save was skipped", not "an edit was lost".
 *
 * SHAPE ON DISK: `serializeAsJSON(…, 'local')` is the library's OWN writer — the same one its
 * "Save to disk" uses — so element cleanup is its rules, not ours. Two things are ours: the
 * `files` argument is deliberately EMPTY (🔒 D3: bytes live in `<vault>/assets/`, the scene
 * carries ids only) and a trailing newline, so a file this app creates and this app saves differ
 * only in what was drawn. A snapshot hands the host the engine's LIVE files and the ids the
 * scene still references alongside the lean JSON, so the host can work out what the store is
 * missing (`unpersistedFiles`) without ever seeing an engine type.
 *
 * ⚡ EVERY PROP HANDED TO THE ENGINE IS STABLE. `<Excalidraw>` is memoized and calls `onChange`
 * whenever it renders, so a prop rebuilt per render is a feedback loop: change → the host
 * re-renders → new `initialData` / `onChange` identity → the memo misses → change… (React error
 * #185, seen on the first mount of the original embed). Hence the module-level `UI_OPTIONS`, the
 * ref-backed callbacks, the once-only `initialData`, the launcher STORE the rail subscribes to
 * rather than props, and the host memoizing what it passes in.
 *
 * THE CHROME INSIDE THE ENGINE (🔒 D10). No `<MainMenu>` at all: the engine's own trigger is
 * hidden (`drawingEditor.css`, the web app's own rule) and its items moved out — File › Export
 * Image… ⌘⇧E and View › Canvas Background to the application menu (`drawingCommand.ts` routes
 * them to the visible drawing), Preferences to Settings › Canvas (🔒 D9). `renderTopLeftUI` is the
 * rail (`LauncherRail.tsx`: the panel hamburger plus the Writing / Frames toggles);
 * `renderTopRightUI` is the host's status chips, the slot the web app's CloudStatus sat in, so
 * they can never cover the tool island; the engine's one child is the docked workspace panel
 * (`CanvasSidebar.tsx`, ⚡ D8 amended). ⌘F / ⌘C open the Images / Components tabs with the web
 * app's guards, bound on THIS component's own element in the capture phase — never `window`.
 *
 * CANVAS PREFS BOTH WAYS (🔒 D9). `canvasPrefs` is the shell's copy, and `appliedRef` is what the
 * engine is believed to hold. Engine → shell: every `onChange` reads the prefs slice off the
 * engine's appState (`appStateToPrefs`) and, ONLY when it differs from `appliedRef`, records it
 * and reports it 300 ms later. Shell → engine: a `canvasPrefs` prop that differs from `appliedRef`
 * is pushed with `updateScene`, changed keys only, with `toolLock` merged into the CURRENT tool
 * and `framesVisible` applied through `updateFrameRendering` instead. Both directions compare
 * against that one ref before writing — that is the whole anti-ping-pong rule.
 */
/*
 * ENGINE CONFIGURATION PARITY CHECKLIST (🔒 R3; source of truth: the "1A · Engine parity
 * checklist" comment on YAZ-1805). Every prop, `UIOptions` field, child, imperative call, startup
 * default and editor CSS rule the web app (`excalidraw-app/App.tsx` at fork `e72242f8`) applies
 * around `<Excalidraw>`, and what this surface does with it. No line is unmarked.
 *
 * §1 PROPS ON <Excalidraw>
 *   validateEmbeddable            DROPPED — cloud Doc embeddables, DOCS_ENABLED-gated; no Docs subsystem
 *   renderEmbeddable              DROPPED — renders a BoardDocEmbeddable out of the cloud store
 *   getEmbeddableActivationMode   DROPPED — same; the engine default "single" applies
 *   onChange                      PORTED  — snapshots + the 🔒 D9 prefs read-back + the panel's open tab
 *   onImageBackgroundRemoval      DROPPED — 🔒 D6, deferred to a Future issue
 *   onExport                      DROPPED — it awaits pending image loads before the engine's own
 *                                           file save, and that door is shut: autosave is the one
 *                                           door to the bytes
 *   initialData                   PORTED  — the scene off disk + 🔒 D3 assets + 🔒 D9 prefs in
 *                                           `appState`, `scrollToContent`
 *   isCollaborating               DROPPED — collab
 *   onPointerUpdate               DROPPED — collab
 *   UIOptions                     see §2
 *   langCode                      DROPPED — the web app's language picker; engine default en-US
 *   renderCustomStats             DROPPED — needs the engine toast + the cloud scene-size notice
 *   detectScroll                  PORTED  — false (this pane does not scroll under the canvas)
 *   handleKeyboardGlobally        DROPPED — 🔒 R3, THE ONE DELIBERATE DROP: several retained tabs
 *                                           each mount an engine, and every one of them would
 *                                           answer a single global key
 *   autoFocus                     PORTED  — true (safe on a background tab: hidden layers are
 *                                           `visibility: hidden` and Chromium will not focus into one)
 *   viewModeEnabled               DROPPED — the cloud viewer role; a drawing here is always editable
 *   viewModeSelectionEnabled      DROPPED — same
 *   theme                         PORTED  — the shell's resolved theme, live (a prop change re-themes)
 *   onThemeChange                 DROPPED — 🔒 D9/D10: theme is Settings › Appearance (and ⌘,), and
 *                                           there is no engine menu to change it from
 *   renderTopLeftUI               PORTED via 🔒 D10 — the rail: hamburger + Writing + Frames, nothing else
 *   renderTopRightUI              PORTED (slot), CONTENTS DROPPED — the shell's Save / Sync chips
 *                                           ride the row the CloudStatus sat in; the cloud size
 *                                           notice, the collab error and the collaboration trigger go
 *   onLinkOpen                    DROPPED for now — the web app's element-link `setViewport` is pure
 *                                           in-canvas navigation and is ported when a caller needs
 *                                           it; nothing in 2F opens an element link
 *   excalidrawAPI                 PORTED as `onExcalidrawAPI` (the fork's prop name) — the shell has
 *                                           no context provider
 *   UIOptions.getFormFactor       ADDED (ours, ⚡ R5) — `formFactor.ts`: phone when phone-sized, else
 *                                           desktop, NEVER tablet
 *   dockedSidebarBreakpoint / tools / welcomeScreen   DROPPED — engine defaults, as in the web app
 *
 * §2 UIOptions FIELDS
 *   canvasActions.clearCanvas                     PORTED  — false (the web app's own value)
 *   canvasActions.toggleTheme                     DROPPED — 🔒 D10: no <MainMenu> renders it
 *   canvasActions.export.onExportToBackend        DROPPED — the cloud share-link backend
 *   canvasActions.export.renderCustomUI           DROPPED — Excalidraw+
 *   canvasActions.loadScene                       ADDED false (ours) — the file IS the document
 *   canvasActions.saveToActiveFile                ADDED false (ours) — autosave owns the file
 *   canvasActions.saveAsImage / changeViewBackgroundColor   ENGINE DEFAULT — both are reached from
 *                                           the application menu instead (🔒 D10)
 *
 * §3 CHILDREN OF <Excalidraw>
 *   AppWelcomeScreen              DROPPED — a tab always opens on a real file; the shell's Welcome
 *                                           screen covers "no vault"
 *   OverwriteConfirmDialog        DROPPED — it guards loadScene / saveToActiveFile, both off
 *   AppFooter                     DROPPED — the Excalidraw+ / socials row. Its `refresh()` IDEA is kept,
 *                                           on the imperative handle, for a tab returning from hidden
 *   AIComponents / TTDDialogTrigger                DROPPED — AI, text-to-diagram (cloud)
 *   collab-offline + localStorage-quota `.alert`s  DROPPED — collab; and no scene lives in
 *                                           localStorage here (⚠️ the web app's `"alertalert--warning"`
 *                                           at App.tsx:1926 is an upstream typo — not copied)
 *   ShareableLinkDialog / ShareDialog / CloudShareDialog / Collab   DROPPED — cloud, share links, collab
 *   AppSidebar                    PORTED via ⚡ D8 amended — `CanvasSidebar.tsx`, Images / Components /
 *                                           Present; `boards` and `docs` dropped
 *   AppMenuItems / AppMainMenu    DROPPED — 🔒 D10, item by item in §4
 *   ErrorDialog                   DROPPED — the shell's notice toast and the editor's error line cover it
 *   CommandPalette                CUSTOM ITEMS DROPPED (collab, share, GitHub, socials, YouTube,
 *                                           Excalidraw+, install-PWA); the engine's own palette stays
 *   DebugCanvas                   DROPPED — dev-only visual debugger
 *
 * §4 AppMainMenu ITEMS, ONE BY ONE — where each one went
 *   LoadScene                     DROPPED — `loadScene: false`; the file is the document
 *   SaveToActiveFile              DROPPED — autosave owns the file
 *   Export                        PORTED via 3E — the shell's own Export menu (PNG / SVG / .excalidraw)
 *   SaveAsImage                   PORTED via 🔒 D10 — File › Export Image… ⌘⇧E → `menu:export-image`
 *                                           → `openImageExport()` below
 *   LiveCollaborationTrigger      DROPPED — collab
 *   CommandPalette (row)          DROPPED — the palette keeps its own shortcut
 *   SearchMenu                    DROPPED — ⌘K is the shell's vault search
 *   Help                          DROPPED — the shell's Help menu points at the repo README
 *   "Visual Debug"                DROPPED — dev-only
 *   Preferences                   PORTED via 🔒 D9 — Settings › Canvas
 *   ToggleTheme allowSystemTheme  PORTED via 🔒 D9 — Settings › Appearance, the only Appearance row
 *   LanguageList                  DROPPED — single-locale app
 *   ChangeCanvasBackground        PORTED via 🔒 D10 — View › Canvas Background ▸ (the fork's palette)
 *                                           → `menu:canvas-background` → `setCanvasBackground()` below
 *
 * §5 AppSidebar — what the canvas panel carries over
 *   launcher/tab registry         PORTED for components / image-studio / presentation; boards and
 *                                           docs DROPPED (the shell sidebar is the boards list)
 *   allowed tab set               PORTED (the three); `search` DROPPED — ⌘K is the shell's
 *   last-tab memory               BEHAVIOUR PORTED, KEY DROPPED — `SettingsState.canvasPanel.tab`
 *                                           instead of `yaseen-whiteboard-last-sidebar-section`
 *   `c` → Components, `f` → Image Studio   PORTED as ⌘C / ⌘F with the web app's guards
 *   `b` → Boards, `d` → Docs      DROPPED — the shell file panel keeps its own toggle; no Docs
 *   modifier + suppression gates  PORTED VERBATIM — they are why the shortcuts never fire mid-drag
 *                                           or mid-edit
 *   listener binding              MODIFIED — this component's own element, capture phase, never
 *                                           `window`/`document` (🔒 R3's reason)
 *   writing-mode toggle           PORTED via 🔒 D10 (rail) + 🔒 D9 (`CanvasPrefs.writingMode`)
 *   frames toggle                 PORTED via 🔒 D10 + 🔒 D9 — through `updateFrameRendering`, never appState
 *   hamburger gesture             PORTED, TARGET CHANGED (🔒 D10) — it opens the CANVAS panel
 *   dock preference               BEHAVIOUR PORTED, PER-USERNAME KEY DROPPED — `canvasPanel.docked`
 *   startup `toggleSidebar({name:null})`   PORTED — the panel starts closed
 *   board hover-preview / expanded-folder set / board drag MIME   DROPPED — all of it is the Boards tab
 *
 * §6 IMPERATIVE API — the doors this surface needs
 *   updateScene(elements/appState)   PORTED as `replaceScene()`, `openImageExport()`,
 *                                            `setCanvasBackground()`, the prefs push and the dock pref
 *   refresh()                        PORTED — a tab that was `visibility: hidden` may have been
 *                                            laid out at the wrong size
 *   focusContainer()                 RE-IMPLEMENTED — the engine keeps it on its App class, not on
 *                                            the imperative API, so the seam focuses the engine's
 *                                            own `.excalidraw-container` (what `focusContainer`
 *                                            does) for the tab-reveal handoff (🔒 YAZ-1812)
 *   toggleSidebar({name,tab,force})  PORTED — the hamburger and the two shortcuts
 *   getAppState / getSceneElements / getFiles / addFiles   PORTED — the 🔒 D3 hydrate/extract path
 *   updateFrameRendering             PORTED — the frames pref's one application path
 *   getName / setViewport            NOT USED — only the web app's `onLinkOpen` wanted them
 *   setToast / updateLibrary / resetFiles   DROPPED — toasts are the shell's notice; the upstream
 *                                            library panel is not ported; resetFiles was a cloud route switch
 *
 * §7 EDITOR CSS (`excalidraw-app/index.scss`, `components/AppSidebar.scss`) — in `drawingEditor.css`
 *   `--color-primary-contrast-offset`, light and dark   PORTED
 *   `.alert` placement + `--warning` / `--danger`       PORTED (the two colour variants ride one rule)
 *   `.main-menu-trigger { display: none }`              PORTED — 🔒 D10, the rule that hides the stock hamburger
 *   `.app-sidebar-launchers*` / `.app-sidebar-launcher` PORTED, REDUCED to the D10 rail
 *   `.default-sidebar`, `.sidebar-triggers`, `.app-sidebar-tab-trigger`   PORTED
 *   `.app-sidebar-footer`                               DROPPED — the footer was CloudAccount
 *   `.excalidraw-ui-top-right` container geometry       PORTED; `.cloud-status` styling DROPPED
 *   `.footer-center`, `.encrypted-icon`, `.active-collab`, `.highlighted`,
 *     `.is-collaborating [data-testid=clear-canvas-button]`, `.plus-banner`,
 *     `.board-preview-overlay*`, `.yaseen-welcome-lockup*`, `.collab-errors-button`,
 *     `.ShareDialog`                                    DROPPED — footer, collab, Excalidraw+, Boards, share
 *   presentation-active chrome hiding                   PORTED via 3D
 *   `.image-studio__footer`, PresentationSidebar footer  PORTED with their panels (3A / 3D)
 *   `.ToolIcon__keybinding` override                    DROPPED (⚡ R5) — the fork hides key hints only
 *                                            under `.App-toolbar--compact`, which this app never shows
 *
 * §8 STARTUP DEFAULTS AND THE TOOLBAR GATE
 *   Assistant font / architect roughness migrations     PORTED as plain prefs, NO migration stamps
 *   forced centred text align                           PORTED as a plain pref
 *   legacy stroke-width rename                          DROPPED — nothing here ever wrote the legacy key
 *   roughness sanitation                                PORTED as validation in `sanitizeCanvasPrefs`
 *   `currentItemCornerRadius`                           DROPPED — left at the engine default (demo round 4)
 *   `excalidraw.desktopUIMode`                          PORTED as a CONSTANT (⚡ R4/R5):
 *                                            `YASEEN_FULL_TOOLBAR_MODE = 'full'`, written before every
 *                                            mount; no user-facing toggle
 *
 * §9 THEME (`useHandleAppTheme.ts`)
 *   `"excalidraw-theme"` key      DROPPED — 🔒 D9: `SettingsState.theme`, broadcast to every window
 *   `system` tracks the OS live   PORTED — the shell's `lib/theme.ts` + main's `nativeTheme`
 *   fallback THEME.LIGHT          DROPPED — the shell's default is `system`
 *
 * §10/§11 PERSISTENCE
 *   every `browser:true, export:false` appState key     14 become `CanvasPrefs` (🔒 D9); the other 39
 *                                            are live tool state, export settings or per-session and
 *                                            stay the engine's, except `defaultSidebarDockedPreference`,
 *                                            which is the canvas panel's dock pref in the shell store
 *   every `excalidraw-app/` localStorage key            DROPPED (🔒 D9) — scene, appState, theme, collab,
 *                                            debug, tab-sync versions, legacy library, the two migration
 *                                            stamps, frames, last tab, dock. `excalidraw.desktopUIMode`
 *                                            is the one key this app touches, and only to WRITE it
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { referencedFileIds, type DrawingFileData } from '@shared/drawingAssets'
import { appStateToPrefs, changedPrefKeys, prefsEqual, prefsToAppState, type EngineAppStateSlice } from '@shared/canvasPrefs'
import { DEFAULT_CANVAS_PANEL, DEFAULT_CANVAS_PREFS, type CanvasPanelState, type CanvasPanelTab, type CanvasPrefs } from '@shared/types'
import { CANVAS_SIDEBAR, CanvasSidebar, openCanvasTab } from './CanvasSidebar'
import type { DrawingScene } from './drawingScene'
import { applyToolbarMode, loadExcalidraw, YASEEN_FULL_TOOLBAR_MODE, type ExcalidrawModule } from './engine'
import { yaseenFormFactor } from './formFactor'
import { applyFramesVisibility } from './framesVisibility'
import { createLauncherStore, LauncherRail } from './LauncherRail'

type ExcalidrawProps = ComponentProps<ExcalidrawModule['Excalidraw']>
type ChangeArgs = Parameters<NonNullable<ExcalidrawProps['onChange']>>
type ImperativeApi = NonNullable<Parameters<NonNullable<ExcalidrawProps['onExcalidrawAPI']>>[0]>
type EngineAppState = ChangeArgs[1]

/** What the host learns about the canvas; deliberately engine-free (a number and a thunk). */
export interface DrawingSnapshot {
  /** Cheap identity of the drawn content: equal to the baseline's = nothing to save. */
  readonly version: number
  /**
   * Everything a save needs, computed once when the save timer fires: the scene in the 🔒 D3
   * form (`files: {}`), the engine's live image map, and the ids the scene still references.
   */
  serialize(): { json: string; files: Record<string, DrawingFileData>; referenced: Set<string> }
}

/** The engine-free handle the host gets; nothing in it names the package. */
export interface DrawingSurfaceApi {
  /** Re-measure the canvas — a tab hidden by `visibility` may have been laid out at the wrong size. */
  refresh(): void
  /**
   * Put the keyboard in the canvas (🔒 focus handoff on tab reveal, YAZ-1812): the engine's own
   * `focusContainer()`, so the tool hotkeys work without a click when a mounted tab comes back
   * into view. The HOST decides WHETHER — `focusHandoff.ts` is the gate — this only does it.
   */
  focus(): void
  /**
   * File › Export Image… (🔒 D10): the engine's OWN export dialog, opened through its own
   * `appState.openDialog` door — the clean way in, found in demo round 4, with no keyboard-event hack.
   */
  openImageExport(): void
  /**
   * View › Canvas Background (🔒 D10): `appState.viewBackgroundColor`, which the engine then
   * writes into the file. The one canvas value that is per BOARD rather than per user.
   */
  setCanvasBackground(color: string): void
  /**
   * Replace what the canvas shows (the file changed on disk under a clean editor). Returns the
   * version the engine will report for it — the host's new clean baseline. Computed from the
   * RESTORED elements we hand in, not read back from the engine afterwards: a read-back races
   * the engine's own commit, and a baseline one version stale makes the reload look like an
   * edit and writes it straight back to disk.
   */
  replaceScene(scene: DrawingScene): number
}

export interface DrawingSurfaceProps {
  /** The scene as it came off disk; the canvas opens on it and never re-reads it. */
  scene: DrawingScene
  /** The app's resolved appearance, handed to the engine as-is (a prop change re-themes live). */
  theme: 'light' | 'dark'
  /**
   * The shell's canvas preferences (🔒 D9). Seeded into `initialData.appState` at mount — layered
   * OVER the file's own appState, which overrides nothing of the drawing because none of these
   * keys are ones the engine exports into a file — and applied live whenever they differ from
   * what the engine is believed to hold.
   */
  canvasPrefs?: CanvasPrefs
  /** A pref the ENGINE or the rail changed. Reported only when a value actually moved, 300 ms debounced. */
  onCanvasPrefsChange?: (next: CanvasPrefs) => void
  /** What the canvas panel remembers: the tab the hamburger opens on, and the dock preference (🔒 D10). */
  canvasPanel?: CanvasPanelState
  onCanvasPanelChange?: (next: CanvasPanelState) => void
  /** Mount, then every engine change. The first call is the host's clean baseline. */
  onSnapshot: (snapshot: DrawingSnapshot) => void
  /** The engine itself failed to load — the host shows it and offers nothing but the message. */
  onFailed: (message: string) => void
  /** Called once the engine is mounted, with the handle above. */
  onApi?: (api: DrawingSurfaceApi) => void
  /** The status chips, in the engine's own top-right row; memoize it (see the prop-stability note). */
  renderTopRight?: () => ReactNode
}

/** The one failure this seam can raise on its own (the file's own failures are the host's). */
export const ENGINE_LOAD_FAILED = "Can't open the drawing editor."

/** How long the engine's own toggles settle before the shell hears about them (🔒 D9). */
export const PREFS_DEBOUNCE_MS = 300

/**
 * The file IS the document: the app's autosave is the ONE door to its bytes, so the engine's own
 * open and save-to-file doors stay shut — a second writer would race the first. `clearCanvas` is
 * off for the web app's own reason (a destructive action with no undo affordance in this shell).
 * Image export is untouched: it writes somewhere else entirely. `getFormFactor` is ours (⚡ R5):
 * the pane is a desktop editor whatever width the shell sidebar leaves it.
 */
const UI_OPTIONS = {
  canvasActions: { loadScene: false, saveToActiveFile: false, clearCanvas: false },
  getFormFactor: yaseenFormFactor,
} as const

/**
 * The file's own loose shape as the engine's arguments. `drawingScene.ts` validates only the
 * OUTLINE because the file is user data; the engine's `restore()` decides the rest.
 */
function engineScene(scene: DrawingScene, canvasAppState: Record<string, unknown>): { elements: ChangeArgs[0]; appState: EngineAppState; files: ChangeArgs[2] } {
  return {
    elements: scene.elements as ChangeArgs[0],
    appState: { ...scene.appState, ...canvasAppState } as unknown as EngineAppState,
    files: scene.files as ChangeArgs[2],
  }
}

export function ExcalidrawSurface({
  scene,
  theme,
  canvasPrefs = DEFAULT_CANVAS_PREFS,
  onCanvasPrefsChange,
  canvasPanel = DEFAULT_CANVAS_PANEL,
  onCanvasPanelChange,
  onSnapshot,
  onFailed,
  onApi,
  renderTopRight,
}: DrawingSurfaceProps) {
  const [engine, setEngine] = useState<ExcalidrawModule | null>(null)
  // Callbacks change identity on every host render; the load must run ONCE and `onChange` must
  // never change identity, so all of them go through refs.
  const engineRef = useRef<ExcalidrawModule | null>(null)
  const emitRef = useRef(onSnapshot)
  const failRef = useRef(onFailed)
  const apiRef = useRef(onApi)
  const prefsOutRef = useRef(onCanvasPrefsChange)
  const panelOutRef = useRef(onCanvasPanelChange)
  const panelRef = useRef(canvasPanel)
  /** The engine's raw handle, for the rail and the shortcuts; null until it has mounted. */
  const rawApiRef = useRef<ImperativeApi | null>(null)
  /**
   * The same handle as STATE, because the Images tab is a child of `<Excalidraw>` that has to
   * re-render when it arrives (YAZ-1818) — a ref alone would leave the tab's insert button
   * disabled for the life of the mount.
   */
  const [imperativeApi, setImperativeApi] = useState<ImperativeApi | null>(null)
  /** ⌘F's counter: every press is a fresh request to focus the Images tab's search field. */
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  /**
   * Whether the canvas holds a selection, for the Components tab's "Save selection" (YAZ-1819).
   * The web app read it with the engine's `useUIAppState()` hook inside the panel; here it is read
   * off the SAME `onChange` the rest of this seam is driven by, so the tab needs no engine hook —
   * and because it is a boolean, the memoized panel is re-made only when it actually flips.
   */
  const [hasSelection, setHasSelection] = useState(false)
  /** This seam's own element — the handle's `focus()` reaches the engine's container through it. */
  const rootRef = useRef<HTMLDivElement | null>(null)
  emitRef.current = onSnapshot
  failRef.current = onFailed
  apiRef.current = onApi
  prefsOutRef.current = onCanvasPrefsChange
  panelOutRef.current = onCanvasPanelChange
  panelRef.current = canvasPanel

  /** What the engine is believed to hold (see the anti-ping-pong note in the module doc). */
  const appliedRef = useRef<CanvasPrefs>(canvasPrefs)
  /** The engine → shell debounce: the latest value and its timer. */
  const pendingRef = useRef<{ prefs: CanvasPrefs; timer: ReturnType<typeof setTimeout> } | null>(null)
  const reportPrefs = useCallback((next: CanvasPrefs) => {
    if (pendingRef.current !== null) clearTimeout(pendingRef.current.timer)
    pendingRef.current = {
      prefs: next,
      timer: setTimeout(() => {
        pendingRef.current = null
        prefsOutRef.current?.(next)
      }, PREFS_DEBOUNCE_MS),
    }
  }, [])
  // Unmount: a change still on the timer is reported rather than lost.
  useEffect(
    () => () => {
      const pending = pendingRef.current
      if (pending === null) return
      clearTimeout(pending.timer)
      pendingRef.current = null
      prefsOutRef.current?.(pending.prefs)
    },
    [],
  )

  /** Remember a panel choice (🔒 D10); a value that did not move is not a write. */
  const rememberPanel = useCallback((patch: Partial<CanvasPanelState>) => {
    const next = { ...panelRef.current, ...patch }
    if (next.tab === panelRef.current.tab && next.docked === panelRef.current.docked) return
    panelRef.current = next
    panelOutRef.current?.(next)
  }, [])

  // The rail's store, made ONCE: the hamburger drives the engine's sidebar, the two toggles write
  // the PREF and let the round trip apply it. Every action reads the refs above, so the store — and
  // therefore `renderTopLeftUI` — never changes identity.
  const rail = useMemo(() => {
    const flip = (key: 'writingMode' | 'framesVisible') => prefsOutRef.current?.({ ...appliedRef.current, [key]: !appliedRef.current[key] })
    const store = createLauncherStore(
      {
        // 🔒 D10: open on the last-used tab (Components until then); pressing again closes.
        togglePanel: () => {
          if (store.getState().activeTab !== null) rawApiRef.current?.toggleSidebar({ name: null, force: false })
          else rawApiRef.current?.toggleSidebar({ name: CANVAS_SIDEBAR, tab: panelRef.current.tab, force: true })
        },
        // The web app's rule: open on the tab; the ACTIVE tab's own shortcut closes the panel.
        openTab: (tab) => rawApiRef.current?.toggleSidebar({ name: CANVAS_SIDEBAR, tab, force: store.getState().activeTab !== tab }),
        toggleWriting: () => flip('writingMode'),
        toggleFrames: () => flip('framesVisible'),
      },
      { ready: false, activeTab: null, writingMode: canvasPrefs.writingMode, framesVisible: canvasPrefs.framesVisible },
    )
    return store
    // Mount-only by contract: the initial values are read once, and every later value arrives
    // through `set` from the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closePanel = useCallback(() => rawApiRef.current?.toggleSidebar({ name: null, force: false }), [])
  const onDock = useCallback((docked: boolean) => rememberPanel({ docked }), [rememberPanel])

  /**
   * The web app's `c` / `f` shortcuts (`AppSidebar.tsx:983-1078`) as ⌘C → Components and
   * ⌘F → Images, with its guards kept verbatim: the primary modifier alone, no repeat, no IME
   * composition, no editable target, no live text selection, and — asked of the engine itself —
   * no element being drawn, dragged, resized, rotated or cropped, no text being edited, no dialog
   * open and nothing selected. Those gates are why the keys never fire mid-drag or mid-edit, and
   * why ⌘C still copies a selection.
   *
   * Bound on THIS element in the CAPTURE phase, never `window`: the shell keeps several tabs
   * mounted, each with its own engine, and only the focused canvas may answer (🔒 R3).
   */
  const onKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      const api = rawApiRef.current
      if (api === null) return
      const key = event.key.toLowerCase()
      const tab: CanvasPanelTab | null = key === 'c' ? 'components' : key === 'f' ? 'image-studio' : null
      if (tab === null || !event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.repeat || event.nativeEvent.isComposing) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("[contenteditable='true']") !== null)) return
      const selection = window.getSelection()
      if (selection !== null && !selection.isCollapsed) return
      const appState = api.getAppState() as unknown as Record<string, unknown>
      const busy = BUSY_APP_STATE_KEYS.some((k) => Boolean(appState[k]))
      if (busy || appState.cursorButton === 'down' || Object.keys((appState.selectedElementIds ?? {}) as Record<string, unknown>).length > 0) return
      event.preventDefault()
      event.stopPropagation()
      rail.openTab(tab)
      // ⌘F does not just open the tab, it puts the caret in the search field — the web app's
      // `onRequestImageStudioSearch` (`AppSidebar.tsx:1071-1072`), as a counter the tab watches.
      if (tab === 'image-studio') setSearchFocusRequest((request) => request + 1)
    },
    [rail],
  )

  // Shell → engine (🔒 D9): a prop that differs from what was last applied is pushed, changed keys
  // only. `framesVisible` goes through `updateFrameRendering`; `toolLock` is merged into the tool
  // the engine is HOLDING, because a partial `activeTool` would wipe it.
  useEffect(() => {
    rail.set({ writingMode: canvasPrefs.writingMode, framesVisible: canvasPrefs.framesVisible })
    if (prefsEqual(canvasPrefs, appliedRef.current)) return
    const keys = changedPrefKeys(appliedRef.current, canvasPrefs)
    appliedRef.current = canvasPrefs
    const api = rawApiRef.current
    if (api === null) return
    const appState = prefsToAppState(
      canvasPrefs,
      keys.filter((k) => k !== 'toolLock' && k !== 'framesVisible'),
    )
    if (keys.includes('toolLock')) appState.activeTool = { ...api.getAppState().activeTool, locked: canvasPrefs.toolLock }
    if (Object.keys(appState).length > 0) api.updateScene({ appState: appState as unknown as EngineAppState })
    if (keys.includes('framesVisible')) applyFramesVisibility(api, canvasPrefs.framesVisible)
  }, [canvasPrefs, rail])

  // The scene and the prefs are read ONCE, at mount, by the effect below; a ref keeps them out of
  // its dependency list without lying to the linter about what it uses.
  const openedOn = useRef({ scene, canvasPrefs })

  useEffect(() => {
    let live = true
    // The stylesheet is the canvas's, and arrives with it.
    void import('@excalidraw/excalidraw/index.css')
    // ⚡ R4/R5: the engine reads its styles-panel mode out of localStorage at mount, so the one
    // mode this app ships lands there before every mount — the guard against a stray stored value.
    applyToolbarMode(YASEEN_FULL_TOOLBAR_MODE)
    loadExcalidraw().then(
      (mod) => {
        if (!live) return
        engineRef.current = mod
        setEngine(mod)
        // The baseline, before the engine has said anything — through the engine's own restore,
        // because restored elements are what it mounts (see the module doc).
        const { elements, appState, files } = engineScene(openedOn.current.scene, prefsToAppState(openedOn.current.canvasPrefs))
        emitRef.current(snapshotOf(mod, mod.restoreElements(elements, null) as ChangeArgs[0], appState, files))
      },
      () => {
        if (live) failRef.current(ENGINE_LOAD_FAILED)
      },
    )
    return () => {
      live = false
    }
  }, [])

  // Built ONCE, from the mount-time scene and prefs: the engine reads `initialData` only at mount,
  // and a fresh identity on every settings write would re-render the memoized `<Excalidraw>` for
  // nothing (the #185 rule). The saved scene may sit far from the origin, so open on what it holds.
  const [initialData] = useState(() => ({ ...engineScene(scene, prefsToAppState(canvasPrefs)), scrollToContent: true }))

  const onChange = useCallback(
    (elements: ChangeArgs[0], appState: EngineAppState, files: ChangeArgs[2]) => {
      const mod = engineRef.current
      if (mod !== null) emitRef.current(snapshotOf(mod, elements, appState, files))
      // The canvas panel's open tab: the rail's emphasis, the triggers' opacity, and the memory
      // the hamburger opens on next time.
      setHasSelection(Object.keys((appState as unknown as { selectedElementIds?: Record<string, unknown> }).selectedElementIds ?? {}).length > 0)
      const activeTab = openCanvasTab((appState as unknown as { openSidebar?: { name?: string; tab?: string } | null }).openSidebar)
      if (activeTab !== null) rememberPanel({ tab: activeTab })
      rail.set({ activeTab })
      // Engine → shell (🔒 D9): the prefs slice, compared before anything is written.
      const seen = appStateToPrefs(appState as unknown as EngineAppStateSlice, appliedRef.current)
      if (prefsEqual(seen, appliedRef.current)) return
      appliedRef.current = seen
      rail.set({ writingMode: seen.writingMode, framesVisible: seen.framesVisible })
      reportPrefs(seen)
    },
    [rail, rememberPanel, reportPrefs],
  )

  /** The imperative handle, wrapped once into the engine-free API the host sees. */
  const onExcalidrawAPI = useCallback(
    (api: ImperativeApi | null) => {
      const mod = engineRef.current
      // The engine hands null on unmount; the host's ref keeps the last live handle, which it
      // never calls after its own unmount.
      if (mod === null || api === null) return
      rawApiRef.current = api
      setImperativeApi(api)
      // Frames are never appState (🔒 D9): applied the moment the engine can take them.
      applyFramesVisibility(api, appliedRef.current.framesVisible)
      // The dock preference the web app kept per cloud username, kept in the shell store here.
      const docked = panelRef.current.docked
      if (api.getAppState().defaultSidebarDockedPreference !== docked) api.updateScene({ appState: { defaultSidebarDockedPreference: docked } as unknown as EngineAppState })
      rail.set({ ready: true })
      apiRef.current?.({
        refresh: () => api.refresh(),
        // `focusContainer()` lives on the engine's App class, not on this handle — so do what it
        // does: focus the engine's own container, the element it gives `tabIndex` for exactly this.
        focus: () => rootRef.current?.querySelector<HTMLElement>('.excalidraw-container')?.focus(),
        openImageExport: () => api.updateScene({ appState: { openDialog: { name: 'imageExport' } } as unknown as EngineAppState }),
        setCanvasBackground: (color) => api.updateScene({ appState: { viewBackgroundColor: color } as unknown as EngineAppState }),
        replaceScene: (next) => {
          const restored = mod.restoreElements(next.elements as ChangeArgs[0], null)
          api.updateScene({ elements: restored })
          const entries = Object.values(next.files) as Parameters<ImperativeApi['addFiles']>[0]
          if (entries.length > 0) api.addFiles(entries)
          return mod.getSceneVersion(restored)
        },
      })
    },
    [rail],
  )

  // The rail rides the slot the web app's launchers did; its identity never changes (see above).
  const renderTopLeftUI = useCallback(() => <LauncherRail store={rail} />, [rail])
  // The chips live in the engine's OWN top-right row (the slot the web app's cloud status sits
  // in) rather than a strip above the canvas, so the canvas starts directly under the tab bar
  // and the chips can never cover the toolbar island.
  const renderTopRightUI = useMemo(
    () => (renderTopRight === undefined ? undefined : () => <div className="excalidraw-ui-top-right drawing-editor__top-right">{renderTopRight()}</div>),
    [renderTopRight],
  )

  // The panel is re-created only when the open tab moves — its triggers' emphasis is the one
  // thing about it that depends on live state.
  const [activeTab, setActiveTab] = useState<CanvasPanelTab | null>(null)
  useEffect(() => rail.subscribe(() => setActiveTab(rail.getState().activeTab)), [rail])
  const canvasSidebar = useMemo(
    () =>
      engine === null ? null : (
        <CanvasSidebar
          engine={engine}
          activeTab={activeTab}
          onClose={closePanel}
          onDock={onDock}
          excalidrawAPI={imperativeApi}
          searchFocusRequest={searchFocusRequest}
          hasSelection={hasSelection}
        />
      ),
    [engine, activeTab, closePanel, onDock, imperativeApi, searchFocusRequest, hasSelection],
  )

  if (engine === null) return <div className="drawing-editor__loading" />
  const { Excalidraw } = engine
  return (
    // The surface's own element, so ⌘F / ⌘C are heard here and nowhere else in the shell.
    <div ref={rootRef} className="drawing-surface" onKeyDownCapture={onKeyDownCapture}>
      <Excalidraw
        initialData={initialData}
        theme={theme}
        UIOptions={UI_OPTIONS}
        onChange={onChange}
        onExcalidrawAPI={onExcalidrawAPI}
        renderTopLeftUI={renderTopLeftUI}
        renderTopRightUI={renderTopRightUI}
        // The engine's own scroll listener is for a page that scrolls under it; this pane does not.
        detectScroll={false}
        // Safe on a background tab: hidden layers are `visibility: hidden` (tabs.css), and
        // Chromium will not move focus into a hidden subtree — so only a visible canvas takes it.
        autoFocus
      >
        {canvasSidebar}
      </Excalidraw>
    </div>
  )
}

/**
 * The web app's "a gesture is in flight" set (`AppSidebar.tsx:1011-1061`), as appState keys: any
 * one of them truthy means the keystroke could have meant something else.
 */
const BUSY_APP_STATE_KEYS = [
  'newElement',
  'multiElement',
  'selectionElement',
  'resizingElement',
  'selectedLinearElement',
  'editingFrame',
  'croppingElementId',
  'selectedElementsAreBeingDragged',
  'isResizing',
  'isRotating',
  'editingTextElement',
  'openDialog',
] as const

/** One snapshot from the engine's own two utilities; the only place either is called. */
function snapshotOf(engine: ExcalidrawModule, elements: ChangeArgs[0], appState: EngineAppState, files: ChangeArgs[2]): DrawingSnapshot {
  return {
    version: engine.getSceneVersion(elements),
    serialize: () => {
      // The engine's map, flattened to the two fields that cross the bridge: its `created` /
      // `lastRetrieved` bookkeeping is about this session, not about the file.
      const live: Record<string, DrawingFileData> = {}
      for (const [id, entry] of Object.entries(files ?? {})) {
        if (typeof entry?.dataURL === 'string' && typeof entry.mimeType === 'string') live[id] = { mimeType: entry.mimeType, dataURL: entry.dataURL }
      }
      return {
        // 🔒 D3: an EMPTY files map on purpose — the scene names its images and never carries
        // them. A text file in a git vault ends with a newline, as a new drawing is written.
        json: `${engine.serializeAsJSON(elements, appState, {}, 'local')}\n`,
        files: live,
        referenced: referencedFileIds(elements),
      }
    },
  }
}
