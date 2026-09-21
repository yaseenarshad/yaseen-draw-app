import { useRef, useState, type DragEvent } from 'react'
import { DragHandleIcon } from './icons'
import { ColumnPicker } from './ColumnPicker'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { type ViewSet, type ViewDef, type Mutate, type SortSpec, type GroupBySpec, groupByLevels } from '../viewSchema'
import { propertyLabel } from '../engine'
import { columnTyping } from '../editorType'
import type { FolderPageSettings } from '../folderPageSettings'
import { canonicalKey } from './keys'
import { allPropertyKeys, propertyOptions } from './properties'

export interface SortMenuProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  onUpdate: Mutate
  folderPage?: FolderPageSettings | null
  properties?: PropertiesResponse | null
}

const EMPTY_SORT: SortSpec[] = []

const flip = (d: string | undefined): 'ASC' | 'DESC' => (d === 'DESC' ? 'ASC' : 'DESC')

/** Sort menu (GRO-2135): `view.sort` rows (property, direction, order, remove) and `view.groupBy` beneath. */
export function SortMenu({ def, view, viewIndex, records, onUpdate, folderPage, properties }: SortMenuProps) {
  const keys = allPropertyKeys(def, view, records, folderPage?.columns)
  const sort = view.sort ?? EMPTY_SORT
  const [groupBy, thenBy] = groupByLevels(view)
  const nextId = useRef(sort.length)
  const source = useRef(sort)
  const ids = useRef(sort.map((_, i) => i))
  const pending = useRef<{ signature: string; ids: number[] } | null>(null)
  const signature = JSON.stringify(sort)
  // ViewsPane reparses YAML after each write. Keep local rule identities through our own edits,
  // including duplicate properties; an external replacement gets fresh identities.
  if (source.current !== sort) {
    if (pending.current?.signature === signature) ids.current = pending.current.ids
    else if (JSON.stringify(source.current) !== signature) ids.current = sort.map(() => nextId.current++)
    source.current = sort
    pending.current = null
  }
  const ruleIds = ids.current
  const [drag, setDrag] = useState<{ id: number; to: number; signature: string } | null>(null)
  const dragging = drag?.signature === signature ? drag : null
  const insertionAt = (event: DragEvent<HTMLElement>, index: number) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? index : index + 1
  }

  const writeSort = (next: SortSpec[], nextIds = ruleIds) => {
    pending.current = { signature: JSON.stringify(next), ids: nextIds }
    onUpdate((d) => {
      if (next.length) d.views[viewIndex].sort = next
      else delete d.views[viewIndex].sort
    })
  }
  const setSort = (i: number, patch: Partial<SortSpec>) => writeSort(sort.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const moveSort = (from: number, insertion: number) => {
    const to = insertion > from ? insertion - 1 : insertion
    if (to === from || to < 0 || to >= sort.length) return
    const next = [...sort]
    const ids = [...ruleIds]
    const [rule] = next.splice(from, 1)
    const [id] = ids.splice(from, 1)
    next.splice(to, 0, rule)
    ids.splice(to, 0, id)
    writeSort(next, ids)
  }
  // Both levels in one write (YAZ-745): outer alone keeps today's single-object form, a second
  // level makes it the ordered list. The same property twice is not a grouping — the outer wins.
  const writeGroup = (outer: GroupBySpec | null, inner: GroupBySpec | null) =>
    onUpdate((d) => {
      const second = outer !== null && inner !== null && canonicalKey(inner.property) !== canonicalKey(outer.property) ? inner : null
      if (outer === null) delete d.views[viewIndex].groupBy
      else d.views[viewIndex].groupBy = second === null ? outer : [outer, second]
    })

  const groupDirectionLabel = (group: GroupBySpec) => {
    const typing = columnTyping(group.property, records, properties, folderPage)
    const declaredOptions = view.type === 'board' && (typing?.assigned === 'select' || typing?.assigned === 'multi-select')
    return declaredOptions ? (group.direction === 'DESC' ? 'Reversed option order' : 'Option order') : (group.direction === 'DESC' ? 'DESC' : 'ASC')
  }

  const options = (current: string | undefined, without?: string) =>
    propertyOptions(def, keys, current).filter((o) => o.value !== without)

  return (
    <div className="view-menu sort-menu">
      {sort.length === 0 ? (
        <p className="view-menu__empty">No sort</p>
      ) : (
        <ul className="view-menu__list">
          {sort.map((s, i) => (
            <li key={ruleIds[i]} className={[
              'view-rule',
              dragging?.id === ruleIds[i] ? 'view-prop--dragging' : '',
              dragging?.to === i ? 'view-prop--insert-before' : '',
              dragging?.to === sort.length && i === sort.length - 1 ? 'view-prop--insert-after' : '',
            ].filter(Boolean).join(' ')}
              onDragOver={event => {
                if (!dragging) return
                event.preventDefault()
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
                const to = insertionAt(event, i)
                if (to !== dragging.to) setDrag({ ...dragging, to })
              }}
              onDrop={event => {
                if (!dragging) return
                event.preventDefault()
                const from = ruleIds.indexOf(dragging.id)
                if (from >= 0) moveSort(from, insertionAt(event, i))
                setDrag(null)
              }}
            >
              <div className="view-rule__main">
                <button type="button" className="view-rule__nav view-prop__handle"
                  aria-label={`Reorder sort ${i + 1}: ${propertyLabel(def, s.property)}`}
                  title="Drag to reorder · Arrow keys when focused"
                  disabled={sort.length < 2} draggable={sort.length > 1}
                  onDragStart={event => {
                    event.dataTransfer?.setData('text/plain', String(ruleIds[i]))
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
                    const row = event.currentTarget.closest('li')
                    if (row) event.dataTransfer?.setDragImage?.(row, 12, 16)
                    setDrag({ id: ruleIds[i], to: i, signature })
                  }}
                  onDragEnd={() => setDrag(null)}
                  onKeyDown={event => {
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                    event.preventDefault()
                    moveSort(i, event.key === 'ArrowUp' ? i - 1 : i + 2)
                  }}
                ><DragHandleIcon /></button>
                <ColumnPicker label="Sort property" value={canonicalKey(s.property)} onChange={(value) => setSort(i, { property: value })} options={options(s.property)} />
                <button type="button" className="view-chip" aria-label="Direction" title="Toggle direction" onClick={() => setSort(i, { direction: flip(s.direction) })}>
                  {s.direction === 'DESC' ? 'DESC' : 'ASC'}
                </button>
                <button type="button" className="view-rule__remove" aria-label="Remove sort" title="Remove sort" onClick={() => writeSort(sort.filter((_, j) => j !== i), ruleIds.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="view-menu__foot">
        <button type="button" className="view-menu__action" onClick={() => writeSort([...sort, { property: canonicalKey(keys[0] ?? 'file.name'), direction: 'ASC' }], [...ruleIds, nextId.current++])}>
          Add sort
        </button>
      </div>
      <p className="view-menu__label">Group by</p>
      <div className="view-rule__main">
        <ColumnPicker
          label="Group by"
          value={groupBy ? canonicalKey(groupBy.property) : ''}
          onChange={(value) => writeGroup(value ? { property: value, direction: groupBy?.direction === 'DESC' ? 'DESC' : 'ASC' } : null, thenBy ?? null)}
         options={[{value: '', label: 'None'}, ...options(groupBy?.property)]} />
        {groupBy && (
          <button type="button" className="view-chip" aria-label="Group direction" title="Toggle direction" onClick={() => writeGroup({ property: canonicalKey(groupBy.property), direction: flip(groupBy.direction) }, thenBy ?? null)}>
            {groupDirectionLabel(groupBy)}
          </button>
        )}
      </div>
      {groupBy && (
        <div className="view-rule__main">
          <ColumnPicker
            label="Then group by"
            value={thenBy ? canonicalKey(thenBy.property) : ''}
            onChange={(value) => writeGroup(groupBy, value ? { property: value, direction: thenBy?.direction === 'DESC' ? 'DESC' : 'ASC' } : null)}
           options={[{value: '', label: 'None'}, ...options(thenBy?.property, canonicalKey(groupBy.property))]} />
          {thenBy && (
            <button type="button" className="view-chip" aria-label="Then group direction" title="Toggle direction" onClick={() => writeGroup(groupBy, { property: canonicalKey(thenBy.property), direction: flip(thenBy.direction) })}>
              {groupDirectionLabel(thenBy)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
