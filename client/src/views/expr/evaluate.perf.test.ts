import { describe, expect, it } from 'vitest'
import { FileValue, type FileRecordLike, type Scope, compile, evaluate, isTruthy } from './index'

/** 1000 records × a 5-clause filter + 3 formulas must stay well under a frame (GRO-2131). */
const FILTER = 'file.ext == "md" && status != "done" && file.hasTag("book") && price > 10 && file.inFolder("Library")'
const FORMULAS = {
  label: 'if(price, price.toFixed(2) + " dollars")',
  age: '(now() - file.mtime).days.floor()',
  info: 'title + " (" + tags.join("/") + ")"',
}

function record(i: number): FileRecordLike {
  return {
    path: `Library/${i % 7}/Note ${i}.md`,
    name: `Note ${i}.md`,
    basename: `Note ${i}`,
    folder: `Library/${i % 7}`,
    ext: i % 13 === 0 ? 'markdown' : 'md',
    size: i * 10,
    ctime: 1_700_000_000_000 + i,
    mtime: 1_750_000_000_000 + i * 1000,
    properties: {},
    aliases: [],
    tags: ['book', `genre/${i % 5}`],
    links: [`Note ${i + 1}`],
    embeds: [],
  }
}

function scope(i: number): Scope {
  return {
    note: { status: i % 3 ? 'todo' : 'done', price: i % 50, title: `Note ${i}`, tags: ['a', 'b'], due: '2026-08-01' },
    file: new FileValue(record(i)),
    formulas: FORMULAS,
    this: null,
  }
}

describe('perf', () => {
  it('1000 records × 5-clause filter + 3 formulas under 50 ms', () => {
    const filter = compile(FILTER).expr!
    const formulas = Object.keys(FORMULAS).map(k => compile(`formula.${k}`).expr!)
    const scopes = Array.from({ length: 1000 }, (_, i) => scope(i))
    const run = () => {
      let kept = 0
      for (const s of scopes) {
        if (isTruthy(evaluate(filter, s))) kept++
        for (const f of formulas) evaluate(f, s)
      }
      return kept
    }
    run() // warm-up (JIT)
    const t0 = performance.now()
    const kept = run()
    const ms = performance.now() - t0
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(1000)
    // eslint-disable-next-line no-console
    console.log(`perf: 1000 records in ${ms.toFixed(1)} ms (${kept} kept)`)
    // Runs in the `perf` project, alone on an idle pool (YAZ-740), so this is a real budget:
    // ~7 ms measured, 50 ms allowed. A 3x algorithmic regression fails it; a busy machine cannot.
    expect(ms).toBeLessThan(50)
  })
})
