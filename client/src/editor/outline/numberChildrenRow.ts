/**
 * First row of the block handle menu (YAZ-729): number / un-number the hovered item's direct
 * children. Disabled when the item has no direct child list; the row only dispatches
 * toggleNumberedChildren's transaction and never touches text.
 */
import type { RowProvider } from '../blockHandleMenu'
import { childListState, toggleNumberedChildren } from './numberChildren'

export const numberChildrenRow: RowProvider = (view, target, ctx) => {
  const s = childListState(view.state.doc, target.inside)
  return [
    {
      label: s === 'ordered' ? 'Bullet children' : 'Number children',
      disabled: s === null,
      run: () => {
        const tr = toggleNumberedChildren(view.state, target.inside, ctx)
        if (tr !== null) {
          view.dispatch(tr)
          view.focus()
        }
      },
    },
  ]
}
