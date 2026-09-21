import { describe, expect, it } from 'vitest'
import { parseViews } from '../viewSchema'
import { TEST_RECORDS } from '../testRecords'
import { allPropertyKeys } from './properties'

const { def } = parseViews('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n')
const view = def.views[0]

describe('allPropertyKeys', () => {
  it('offers a DECLARED column no member carries a value for (YAZ-895)', () => {
    expect(allPropertyKeys(def, view, TEST_RECORDS)).not.toContain('note.owner')
    expect(allPropertyKeys(def, view, TEST_RECORDS, { owner: { kind: 'link' } })).toContain('note.owner')
  })

  it('a declared column already seen in the values is listed once, not twice', () => {
    const keys = allPropertyKeys(def, view, TEST_RECORDS, { status: { kind: 'text' } })
    expect(keys.filter((k) => k === 'note.status')).toEqual(['note.status'])
  })
})
