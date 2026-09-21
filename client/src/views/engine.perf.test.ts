import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ViewSet } from './viewSchema'
import { runView } from './engine'
describe('perf (GRO-2133)', () => {
  function record(i: number): IndexRecord {
    return {
      path: `/vault/Library/${i % 7}/Note ${i}.md`,
      name: `Note ${i}.md`,
      basename: `Note ${i}`,
      folder: `Library/${i % 7}`,
      ext: 'md',
      size: i * 10,
      ctime: 1_700_000_000_000 + i,
      mtime: 1_750_000_000_000 + i * 1000,
      properties: { status: i % 3 ? 'todo' : 'done', price: i % 50, title: `Note ${i}`, due: '2026-08-01', tags: ['a', 'b'] },
      aliases: [],
      tags: ['book', `genre/${i % 5}`],
      links: [`Note ${i + 1}`],
      embeds: [],
    }
  }

  it('1000 records × 3-clause filter + 2 formulas + sort + groupBy under 50 ms', () => {
    const records = Array.from({ length: 1000 }, (_, i) => record(i))
    const def: ViewSet = {
      formulas: { label: 'if(price, price.toFixed(2) + " dollars")', age: '(now() - file.mtime).days.floor()' },
      views: [
        {
          type: 'table',
          name: 'T',
          filters: { and: ['file.ext == "md"', 'status != "done"', 'price > 10'] },
          order: ['file.name', 'status', 'price', 'formula.label', 'formula.age'],
          sort: [{ property: 'price', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }],
          groupBy: { property: 'file.folder' },
          summaries: { price: 'Sum' },
        },
      ],
    }
    const go = () => runView(def, def.views[0], records, { thisFile: records[0].path, root: '/vault' })
    go() // warm-up (JIT)
    const t0 = performance.now()
    const r = go()
    const ms = performance.now() - t0
    expect(r.errors).toEqual([])
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows.length).toBeLessThan(1000)
    expect(r.groups).toHaveLength(7)
    expect(r.rows[0].values['formula.label']).toMatch(/dollars$/)
    // eslint-disable-next-line no-console
    console.log(`engine perf: 1000 records in ${ms.toFixed(1)} ms (${r.rows.length} kept)`)
    // Runs in the `perf` project, alone on an idle pool (YAZ-740), so this is a real budget:
    // ~18 ms measured, 50 ms allowed. The grouping wave's first cut regressed this 4-6x and was
    // caught HERE — at 150 ms it would have shipped.
    expect(ms).toBeLessThan(50)
  })

  it('1000 records × 3-clause filter + sort + two-level groupBy under 50 ms', () => {
    const records = Array.from({ length: 1000 }, (_, i) => record(i))
    const def: ViewSet = {
      views: [
        {
          type: 'table',
          name: 'T',
          filters: { and: ['file.ext == "md"', 'status != "done"', 'price > 10'] },
          order: ['file.name', 'status', 'price'],
          sort: [{ property: 'price', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }],
          groupBy: [{ property: 'file.folder' }, { property: 'price' }],
          summaries: { price: 'Sum' },
        },
      ],
    }
    const go = () => runView(def, def.views[0], records, { thisFile: records[0].path, root: '/vault' })
    go() // warm-up (JIT)
    const t0 = performance.now()
    const r = go()
    const ms = performance.now() - t0
    expect(r.errors).toEqual([])
    expect(r.groups).toHaveLength(7)
    // No price equals a folder name and none is missing, so every row lands in exactly one child.
    expect(r.groups!.every(g => g.direct!.length === 0)).toBe(true)
    expect(r.groups!.every(g => g.children!.length === 39 && g.children!.reduce((n, c) => n + c.rows.length, 0) === g.rows.length)).toBe(true)
    // eslint-disable-next-line no-console
    console.log(`engine perf: 1000 records, two levels in ${ms.toFixed(1)} ms (${r.rows.length} kept)`)
    // The inner level buckets each outer separately (YAZ-745), so the same budget must still hold.
    expect(ms).toBeLessThan(50)
  })
})
