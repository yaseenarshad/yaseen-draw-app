import type { PropertyDecl, PropertyKind } from '@shared/types'

/**
 * A declaration re-typed to `kind`, with the fields that belong to OTHER kinds dropped (YAZ-1549):
 * `options` / `optionSort` ride only on the choice kinds (a choice kind is born with an empty list),
 * `target` only on the link kinds. Every kind switch — "+ Add column" at save, the detail panel's
 * Type select, "Make relation" — goes through this one rule, so a target typed under Link can never
 * ride into a Text declaration and a Select's options never outlive the Select.
 */
export function declarationForKind(decl: Partial<PropertyDecl> | undefined, kind: PropertyKind): PropertyDecl {
  const next: PropertyDecl = { ...decl, kind }
  if (kind === 'select' || kind === 'multi-select') {
    if (next.options === undefined) next.options = []
  } else {
    delete next.options
    delete next.optionSort
  }
  if (kind !== 'link' && kind !== 'multi-link') delete next.target
  else if (next.target !== undefined && next.target.trim() === '') delete next.target
  return next
}
