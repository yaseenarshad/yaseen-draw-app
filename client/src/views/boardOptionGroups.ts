import type { Group } from './engine'
import type { ColumnTyping } from './editorType'
import { equals } from './expr'
import { groupByLevels, type ViewDef } from './viewSchema'

/** Declared options supply ordering and writable empty destinations; observed values stay visible. */
export function boardOptionGroups(groups: Group[] | null, view: ViewDef, typing: (key: string) => ColumnTyping): Group[] | null {
  if (groups === null || view.type !== 'board') return groups
  const levels = groupByLevels(view).slice(0, 2)
  const build = (input: Group[], level: number, outerKey?: Group['key']): Group[] => {
    const spec = levels[level]
    if (!spec) return input
    const column = typing(spec.property)
    const select = column?.assigned === 'select' || column?.assigned === 'multi-select'
    let output = input
    if (select) {
      // The engine keeps matching inner values directly under their outer. Do not invent
      // an empty child for a destination whose cards would immediately merge out of it.
      const options = (column.options ?? []).filter(option => outerKey == null || !equals(option, outerKey))
      if (spec.direction === 'DESC') options.reverse()
      const ordered = options.flatMap(option => {
        const existing = input.find(g => g.key === option)
        if (!existing && view.showEmptyColumns !== true) return []
        const group = existing ?? { key: option, label: option, rows: [], summaries: {}, fannedOut: false }
        return [{ ...group, optionValue: option, fannedOut: column.assigned === 'multi-select' }]
      })
      output = [...ordered, ...input.filter(g => !options.some(option => g.key === option))]
    }
    return level + 1 < levels.length ? output.map(g => ({ ...g, children: build(g.children ?? [], level + 1, g.key), direct: g.direct ?? [] })) : output
  }
  return build(groups, 0)
}
