import { describe, expect, it } from 'vitest'
import type { ColumnTyping } from './editorType'
import { runView } from './engine'
import { boardOptionGroups } from './boardOptionGroups'
import { TEST_RECORDS } from './testRecords'
import type { ViewDef } from './viewSchema'

const board: ViewDef = { type: 'board', name: 'Board', groupBy: { property: 'note.status' }, showEmptyColumns: true }
const select = (options: string[], multiple = false): ColumnTyping => ({ assigned: multiple ? 'multi-select' : 'select', dominant: null, options })
const observed = (values: unknown[], view = board) => runView({ views: [view] }, view, values.map((status, i) => ({
  ...TEST_RECORDS[0], path: `/vault/${i}.md`, properties: { status },
}))).groups

describe('board option groups', () => {
  it('orders declared options including unused destinations, retaining observed rows and summaries', () => {
    const groups = observed(['Ready', 'Legacy'])!
    const before = structuredClone(groups)
    const result = boardOptionGroups(groups, board, () => select(['Later', 'Ready', 'Done']))!
    expect(result.map(g => g.key)).toEqual(['Later', 'Ready', 'Done', 'Legacy'])
    expect(result[0]).toMatchObject({ optionValue: 'Later', rows: [], summaries: {}, fannedOut: false })
    expect(result[1].rows).toBe(groups.find(g => g.key === 'Ready')!.rows)
    expect(groups).toEqual(before)
  })

  it('hides unused options when disabled while keeping populated options, unlisted values and No value', () => {
    const result = boardOptionGroups(observed(['Ready', 'Legacy', null]), { ...board, showEmptyColumns: false }, () => select(['Later', 'Ready']))!
    expect(result.map(g => g.key)).toEqual(['Ready', 'Legacy', null])
  })

  it('uses reverse declared order for descending grouping', () => {
    const result = boardOptionGroups([], { ...board, groupBy: { property: 'note.status', direction: 'DESC' } }, () => select(['Later', 'Ready', 'Done']))!
    expect(result.map(g => g.key)).toEqual(['Done', 'Ready', 'Later'])
  })

  it('marks empty Multi-select destinations as list fan-out before any values exist', () => {
    const result = boardOptionGroups([], board, () => select(['A', 'B'], true))!
    expect(result.map(g => [g.optionValue, g.fannedOut, g.rows.length])).toEqual([['A', true, 0], ['B', true, 0]])
  })

  it('builds nested options inside populated and unused outer groups', () => {
    const view: ViewDef = { ...board, groupBy: [{ property: 'note.status' }, { property: 'note.labels' }] }
    const record = { ...TEST_RECORDS[0], properties: { status: 'Ready', labels: ['A'] } }
    const groups = runView({ views: [view] }, view, [record]).groups
    const result = boardOptionGroups(groups, view, key => key === 'note.status' ? select(['Later', 'Ready']) : select(['B', 'A'], true))!
    expect(result.map(g => g.key)).toEqual(['Later', 'Ready'])
    expect(result.map(g => g.children?.map(c => c.key))).toEqual([['B', 'A'], ['B', 'A']])
    expect(result[0].children?.every(g => g.fannedOut && g.rows.length === 0)).toBe(true)
    expect(result[1].children?.find(g => g.key === 'A')?.rows).toHaveLength(1)
  })

  it('keeps differently typed existing values even when their text matches an option', () => {
    const result = boardOptionGroups(observed([1, null]), board, () => select(['1', 'null']))!
    expect(result.map(g => g.key)).toEqual(['1', 'null', 1, null])
  })

  it('does not recreate an inner option whose matching rows the engine merged into the outer', () => {
    const view: ViewDef = { ...board, groupBy: [{ property: 'note.status' }, { property: 'note.stage' }] }
    const record = { ...TEST_RECORDS[0], properties: { status: 'Ready', stage: 'Ready' } }
    const groups = runView({ views: [view] }, view, [record]).groups!
    const result = boardOptionGroups(groups, view, () => select(['Ready', 'Later']))!
    expect(result.map(g => [g.key, g.children?.map(c => c.key)])).toEqual([
      ['Ready', ['Later']], ['Later', ['Ready']],
    ])
    expect(result[0].direct).toBe(groups[0].direct)
    expect(result[0].direct?.map(row => row.record.path)).toEqual([record.path])
    expect(result[0].rows).toBe(groups[0].rows)
  })

  it('preserves direct rows when both levels group on the same property', () => {
    const view: ViewDef = { ...board, groupBy: [{ property: 'note.status' }, { property: 'note.status' }] }
    const groups = observed(['Ready'], view)!
    const result = boardOptionGroups(groups, view, () => select(['Ready']))!
    expect(result[0].children).toEqual([])
    expect(result[0].direct).toBe(groups[0].direct)
    expect(result[0].direct).toHaveLength(1)
  })

  it('leaves non-Board views and unconfigured property kinds unchanged', () => {
    const groups = observed(['Ready'])
    expect(boardOptionGroups(groups, { ...board, type: 'table' }, () => select(['Later']))).toBe(groups)
    expect(boardOptionGroups(groups, board, () => ({ assigned: 'text', dominant: null }))).toBe(groups)
    expect(boardOptionGroups(null, board, () => select(['Later']))).toBeNull()
  })
})
