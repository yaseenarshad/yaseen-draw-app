/**
 * THE IN-CANVAS DOCKED PANEL (YAZ-1775 ⚡ D8 amended): the web app's `AppSidebar`
 * (`excalidraw-app/components/AppSidebar.tsx`) minus its Boards and Docs tabs. The shell sidebar
 * is this app's file manager, so the canvas panel holds only what the canvas owns — **Images**
 * (3B), **Components** (3C), **Present** (3D) — each an icon with a small label, in the web app's
 * own tab strip.
 *
 * Same engine `DefaultSidebar` the web app used: its docked/pinnable panel, `hideLibrary` (the
 * upstream element library is not ported), and a hamburger in `headerStart` that closes the panel
 * — the rail's hamburger being the other way. The engine's stock `DefaultSidebar.Trigger` is
 * rendered `hidden`: the panel's doors are the rail and ⌘F / ⌘C, never a floating trigger.
 *
 * The Images tab is the Image Studio (`client/src/media/`, YAZ-1818); Components and Present are
 * still placeholders — a real label and an honest line, not a blank pane — until 3C and 3D.
 *
 * ENGINE-BOUND BY DESIGN: this renders the engine's own components, so it takes the LOADED module
 * as a prop rather than importing the package (`engine.ts`'s lazy rule), and it is rendered only
 * by `ExcalidrawSurface`, as a memoized child of `<Excalidraw>`.
 */
import type { ReactNode } from 'react'
import { CANVAS_PANEL_TABS, type CanvasPanelTab } from '@shared/types'
import { ImageStudio } from '../media/ImageStudio'
import type { InsertTarget } from '../media/insertShape'
import type { ExcalidrawModule } from './engine'
import { hamburgerIcon, imageIcon, libraryIcon, presentationIcon } from './launcherIcons'

/** The engine sidebar name the web app used for its workspace panel. */
export const CANVAS_SIDEBAR = 'default'

/** The three tabs, left→right, with the web app's own labels. */
export const CANVAS_SIDEBAR_TABS: ReadonlyArray<{ tab: CanvasPanelTab; label: string; shortLabel: string; icon: ReactNode }> = [
  { tab: 'image-studio', label: 'Image Studio', shortLabel: 'Images', icon: imageIcon },
  { tab: 'components', label: 'Components', shortLabel: 'Components', icon: libraryIcon },
  { tab: 'presentation', label: 'Presentation', shortLabel: 'Present', icon: presentationIcon },
]

/** What a tab body says until 3C / 3D fill it. */
export const PHASE_3 = 'Coming in phase 3'

/** The engine's sidebar state, narrowed to the tab this app recognises (anything else = closed). */
export function openCanvasTab(openSidebar: { name?: string; tab?: string } | null | undefined): CanvasPanelTab | null {
  if (openSidebar == null || openSidebar.name !== CANVAS_SIDEBAR) return null
  const tab = openSidebar.tab
  return (CANVAS_PANEL_TABS as readonly string[]).includes(tab ?? '') ? (tab as CanvasPanelTab) : null
}

export interface CanvasSidebarProps {
  engine: ExcalidrawModule
  /** The open tab, read off `appState.openSidebar` by the surface; drives the triggers' emphasis. */
  activeTab: CanvasPanelTab | null
  /** The header hamburger: close the panel (the engine's `toggleSidebar({ name: null })`). */
  onClose: () => void
  /** The dock/pin gesture; the surface stores it in `SettingsState.canvasPanel` (🔒 D10). */
  onDock: (docked: boolean) => void
  /** The engine's imperative handle, for the Images tab's inserts; null until it has mounted. */
  excalidrawAPI: InsertTarget | null
  /** Bumped by ⌘F: the Images tab switches to Search and focuses the field (YAZ-1818). */
  searchFocusRequest: number
}

export function CanvasSidebar({ engine, activeTab, onClose, onDock, excalidrawAPI, searchFocusRequest }: CanvasSidebarProps) {
  const { DefaultSidebar, Sidebar } = engine
  return (
    <>
      {/* The engine's own floating trigger is not this app's door; the rail is (🔒 D10). */}
      <DefaultSidebar.Trigger hidden />
      <DefaultSidebar
        hideLibrary
        headerStart={
          <button type="button" className="app-sidebar-panel-toggle" aria-label="Close workspace panel" title="Close workspace panel" onClick={onClose}>
            {hamburgerIcon}
          </button>
        }
        onDock={onDock}
      >
        <DefaultSidebar.TabTriggers>
          {CANVAS_SIDEBAR_TABS.map(({ tab, label, shortLabel, icon }) => (
            <Sidebar.TabTrigger key={tab} tab={tab} className="app-sidebar-tab-trigger" aria-label={label} title={label} style={{ opacity: activeTab === tab ? 1 : 0.4 }}>
              {icon}
              <span className="app-sidebar-tab-label">{shortLabel}</span>
            </Sidebar.TabTrigger>
          ))}
        </DefaultSidebar.TabTriggers>
        {CANVAS_SIDEBAR_TABS.map(({ tab, label }) => (
          <Sidebar.Tab key={tab} tab={tab}>
            {tab === 'image-studio' ? (
              <ImageStudio engine={engine} excalidrawAPI={excalidrawAPI} searchFocusRequest={searchFocusRequest} />
            ) : (
              <div className="canvas-sidebar__placeholder" role="status">
                <strong>{label}</strong>
                <span>{PHASE_3}</span>
              </div>
            )}
          </Sidebar.Tab>
        ))}
      </DefaultSidebar>
    </>
  )
}
