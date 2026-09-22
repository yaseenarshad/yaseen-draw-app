/**
 * THE TWO TYPE GUARDS EVERY PARSER IN THIS APP SHARES.
 *
 * Every layer validates what it is handed — a store file, a vault config, a scene off disk, a
 * pasted component — and every one of them starts with the same two questions. Written once, so
 * "is this a plain object" cannot mean `typeof v === 'object'` in one module (where an ARRAY
 * passes) and something stricter in the next.
 */

/** A plain JSON object. `typeof [] === 'object'`, so the array check is part of the question. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A real number: not NaN, not Infinity, and not a numeric string. */
export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
