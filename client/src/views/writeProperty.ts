import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { BridgeRequestError, api } from '../api'

export type ContentTransform = (content: string) => string

export interface PropertyWrite {
  key: string
  value: unknown
}

/**
 * Apply one pure whole-file transformation with the shared no-op and optimistic-concurrency
 * contract: write against the bytes just read, then re-read and recompute once on conflict.
 * Resolves with the bytes that are on disk afterwards — the transformed content, or the fresh
 * read when the transform was a no-op — so a caller can adopt exactly what landed (YAZ-1472).
 */
export async function transformFile(path: string, transform: ContentTransform): Promise<{ mtime: number; content: string }> {
  let file = await api.readFile(path)
  let retried = false

  for (;;) {
    const content = transform(file.content)
    if (content === file.content) return { mtime: file.mtime, content }
    try {
      return { mtime: (await api.writeFile({ path, content, expectedMtime: file.mtime })).mtime, content }
    } catch (err) {
      if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT' || retried) throw err
      retried = true
      file = await api.readFile(path)
    }
  }
}

/** Apply several frontmatter changes in one guarded whole-file transformation. */
export async function writeProperties(path: string, writes: readonly PropertyWrite[]): Promise<{ mtime: number }> {
  return transformFile(path, (content) => writes.reduce((next, { key, value }) => setFrontmatterProperty(next, key, value), content))
}

/** Change one frontmatter key; the one-key specialization of `writeProperties` (GRO-2141). */
export async function writeProperty(path: string, key: string, value: unknown): Promise<{ mtime: number }> {
  return writeProperties(path, [{ key, value }])
}

/**
 * Add one frontmatter key only when it is absent from the LATEST file bytes (YAZ-999). Index
 * records may lag the disk, so presence is checked again after the read and after a conflict.
 * Every present value wins — including null/falsy values and a value whose type disagrees with
 * the declaration asking for the backfill.
 */
export async function writePropertyIfMissing(path: string, key: string, value: unknown): Promise<{ mtime: number }> {
  return transformFile(path, (content) => {
    const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
    if (Object.prototype.hasOwnProperty.call(parsed.properties, key)) return content
    // On broken frontmatter this is also the authoritative validation step: it throws the same
    // FrontmatterWriteError as every other one-key write, and the file stays untouched.
    return setFrontmatterProperty(content, key, value)
  })
}
