import { describe, expect, it } from 'vitest'
import { CANVAS_SIDEBAR, CANVAS_SIDEBAR_TABS, openCanvasTab } from './CanvasSidebar'

/**
 * `openCanvasTab` is the narrowing that decides whether the engine's own `openSidebar` counts as
 * one of THIS app's tabs — the engine may open a sidebar of its own at any time, and anything the
 * app does not recognise has to read as "the canvas panel is closed".
 */
describe('openCanvasTab', () => {
  it.each(CANVAS_SIDEBAR_TABS.map(({ tab }) => tab))('recognises the %s tab', (tab) => {
    expect(openCanvasTab({ name: CANVAS_SIDEBAR, tab })).toBe(tab)
  })

  it.each([
    ['no sidebar open (null)', null],
    ['no sidebar open (undefined)', undefined],
    ['another sidebar entirely', { name: 'library', tab: 'components' }],
    ['this sidebar on a tab the app does not have', { name: CANVAS_SIDEBAR, tab: 'boards' }],
    ['this sidebar with no tab at all', { name: CANVAS_SIDEBAR }],
  ])('reads %s as closed', (_label, openSidebar) => {
    expect(openCanvasTab(openSidebar)).toBeNull()
  })
})

describe('CANVAS_SIDEBAR_TABS', () => {
  it('is the three canvas tabs, left to right (⚡ YAZ-1775 D8 amended: Boards and Docs are the shell sidebar)', () => {
    expect(CANVAS_SIDEBAR_TABS.map((t) => t.tab)).toEqual(['image-studio', 'components', 'presentation'])
    expect(CANVAS_SIDEBAR_TABS.map((t) => t.shortLabel)).toEqual(['Images', 'Components', 'Present'])
    for (const { icon, label } of CANVAS_SIDEBAR_TABS) {
      expect(icon, label).toBeTruthy()
    }
  })
})
