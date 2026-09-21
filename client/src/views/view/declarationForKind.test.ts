/** The one kind rule (YAZ-1549): fields that belong to other kinds never ride along a kind switch. */
import { describe, expect, it } from 'vitest'
import { declarationForKind } from './declarationForKind'

describe('declarationForKind', () => {
  it('a choice kind is born with an empty option list and keeps the one it has', () => {
    expect(declarationForKind({ kind: 'text' }, 'select')).toEqual({ kind: 'select', options: [] })
    expect(declarationForKind({ kind: 'select', options: ['A'], optionSort: 'ascending' }, 'multi-select')).toEqual({ kind: 'multi-select', options: ['A'], optionSort: 'ascending' })
  })

  it('leaving a choice kind drops options and optionSort', () => {
    expect(declarationForKind({ kind: 'select', options: ['A', 'B'], optionSort: 'descending' }, 'text')).toEqual({ kind: 'text' })
  })

  it('a target rides only on the link kinds, trimmed of blanks; a link ⇄ multi-link switch keeps it', () => {
    expect(declarationForKind({ kind: 'link', target: '[[People]]' }, 'text')).toEqual({ kind: 'text' })
    expect(declarationForKind({ kind: 'link', target: '[[People]]' }, 'multi-link')).toEqual({ kind: 'multi-link', target: '[[People]]' })
    expect(declarationForKind({ kind: 'text', target: '   ' }, 'link')).toEqual({ kind: 'link' })
  })

  it('an undeclared column becomes exactly the kind asked for; `required` survives every switch', () => {
    expect(declarationForKind(undefined, 'date')).toEqual({ kind: 'date' })
    expect(declarationForKind({ kind: 'text', required: true }, 'number')).toEqual({ kind: 'number', required: true })
  })

  it('never mutates its input', () => {
    const decl = { kind: 'link' as const, target: '[[People]]' }
    declarationForKind(decl, 'text')
    expect(decl).toEqual({ kind: 'link', target: '[[People]]' })
  })
})
