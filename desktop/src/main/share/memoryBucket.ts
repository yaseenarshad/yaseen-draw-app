/**
 * A Map-backed R2 bucket for the tests that run the REAL share Worker (`share/worker.js`) in
 * process. It keeps the R2 rules the Worker depends on: `put` takes a stream, `delete` takes one
 * key or up to 1,000, `list` pages at most 1,000 keys in key order with a cursor. `ops` counts
 * calls, so a test can hold one Worker request under the free plan's 50-subrequest cap.
 */
export const R2_PAGE = 1000

type Body = ReadableStream<Uint8Array> | ArrayBuffer | string | null

export function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; customMetadata: Record<string, string> }>()
  const ops = { count: 0 }
  const meta = (key: string) => {
    const o = objects.get(key)!
    return { key, size: o.bytes.length, customMetadata: o.customMetadata }
  }
  return {
    objects,
    ops,
    async put(key: string, body: Body, opts: { customMetadata?: Record<string, string> } = {}) {
      ops.count++
      const bytes = new Uint8Array(await new Response(body).arrayBuffer())
      objects.set(key, { bytes, customMetadata: opts.customMetadata ?? {} })
      return meta(key)
    },
    async head(key: string) {
      ops.count++
      return objects.has(key) ? meta(key) : null
    },
    async get(key: string) {
      ops.count++
      const o = objects.get(key)
      if (o === undefined) return null
      return { ...meta(key), body: new Blob([o.bytes]).stream(), text: async () => new TextDecoder().decode(o.bytes) }
    },
    async delete(keys: string | string[]) {
      ops.count++
      const list = Array.isArray(keys) ? keys : [keys]
      if (list.length > R2_PAGE) throw new Error(`R2 deletes at most ${R2_PAGE} keys per call`)
      for (const k of list) objects.delete(k)
    },
    async list({ prefix = '', cursor, limit = R2_PAGE }: { prefix?: string; cursor?: string; limit?: number } = {}) {
      ops.count++
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && (cursor === undefined || k > cursor)).sort()
      const page = keys.slice(0, Math.min(limit, R2_PAGE))
      const truncated = keys.length > page.length
      return { objects: page.map((key) => meta(key)), truncated, cursor: truncated ? page[page.length - 1] : undefined }
    },
  }
}

export type MemoryBucket = ReturnType<typeof memoryBucket>
