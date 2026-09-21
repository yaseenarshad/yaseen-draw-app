/**
 * The delete-a-view sheet's COPY (YAZ-1471, 🔒 D2), tested apart from the component exactly as
 * `removeMemberMessage` is: the sheet itself is `ConfirmRemoveMember`'s mechanics verbatim
 * (focus on Cancel, Esc cancels, Enter confirms, click-away cancels) and is pinned where it is
 * driven — on the tabs, in `Toolbar.test.tsx`. What is ONLY here is the sentence, and the one
 * thing it has to get right: an outline view takes a DOCUMENT with it, every other view takes a
 * configuration — and neither one takes a single page.
 */
import { describe, expect, it } from 'vitest'
import { deleteViewMessage } from './ConfirmDeleteView'

describe('deleteViewMessage', () => {
  it('an outline view names the document that goes with it', () => {
    expect(deleteViewMessage({ type: 'outline', name: 'Outline' })).toBe(
      "Delete the view 'Outline'? Its outline document goes with it — the pages themselves stay put.",
    )
  })

  it('every other view names its configuration instead', () => {
    expect(deleteViewMessage({ type: 'table', name: 'Table' })).toBe(
      "Delete the view 'Table'? Its columns, sort, filters and grouping go with it — the pages themselves stay put.",
    )
    expect(deleteViewMessage({ type: 'board', name: 'Kanban' })).toBe(
      "Delete the view 'Kanban'? Its columns, sort, filters and grouping go with it — the pages themselves stay put.",
    )
  })
})
