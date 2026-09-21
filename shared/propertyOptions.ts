import type { PropertyDecl } from './types'

/** Ordered option labels. Tolerant reads drop invalid/duplicate entries without rewriting storage. */
export function readPropertyOptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return [...new Set(raw.filter((value): value is string => typeof value === 'string' && value.trim() !== ''))]
}

/** Config writes reject malformed labels instead of silently changing the submitted declaration. */
export function validPropertyOptions(raw: unknown): raw is string[] {
  const options = readPropertyOptions(raw)
  return Array.isArray(raw) && options !== undefined && options.length === raw.length
}

export function validPropertyOptionSort(raw: unknown): raw is NonNullable<PropertyDecl['optionSort']> {
  return raw === 'manual' || raw === 'ascending' || raw === 'descending'
}

const optionCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Presentation only: never replace the saved manual arrangement with a sorted array. */
export function orderedPropertyOptions(decl: Pick<PropertyDecl, 'options' | 'optionSort'>): readonly string[] | undefined {
  if (decl.options === undefined || decl.optionSort === undefined || decl.optionSort === 'manual') return decl.options
  const direction = decl.optionSort === 'descending' ? -1 : 1
  return [...decl.options].sort((a, b) => direction * optionCollator.compare(a, b))
}
