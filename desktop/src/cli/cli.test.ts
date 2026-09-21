/**
 * `yaseendraw` (YAZ-1617): the program runs in-process against real temp files — `main(argv, io)`
 * with captured stdio — so every receipt, refusal and exit code is pinned without spawning.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readComments } from '@shared/comments'
import { HELP, USAGE, find, label, main, transformOnDisk } from './cli'

let dir: string
beforeEach(async () => {
  // realpath: macOS's tmpdir is a symlink (`/var` → `/private/var`) and `resolve()` in the CLI does not follow it.
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-1617-')))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

interface Run {
  code: number
  out: string
  err: string
}

async function run(argv: string[], stdin = ''): Promise<Run> {
  let out = ''
  let err = ''
  const code = await main(argv, { stdin: async () => stdin, stdout: (t) => (out += t), stderr: (t) => (err += t) })
  return { code, out, err }
}

async function page(name: string, content: string): Promise<string> {
  const p = path.join(dir, name)
  await writeFile(p, content, 'utf8')
  return p
}

const at = (n: number) => `2026-09-11T18:22:0${n}Z`
const PERSON_AND_AGENT = `---
title: Weekly
comments:
  - id: aa1
    n: 1
    at: ${at(1)}
    body: Person's comment
  - id: bb2
    n: 2
    at: ${at(2)}
    by: agent
    title: Numbers
    body: Agent's comment
  - id: cc3
    n: 1
    at: ${at(3)}
    reply_to: bb2
    by: agent
    body: Agent's reply
---
# Weekly
`

describe('help and usage', () => {
  it('no arguments, `help`, `--help` and `-h` print the contract and exit 0', async () => {
    for (const argv of [[], ['help'], ['--help'], ['comment', '-h']]) {
      const r = await run(argv)
      expect(r).toEqual({ code: 0, out: HELP, err: '' })
    }
  })

  it('the contract names every verb and both rules an agent must know', () => {
    for (const word of ['comment ', 'comments ', 'edit ', 'delete ', '--body', '--title', '--reply-to', '--by', '--json', 'by: agent', 'never in the body', 'Exit codes']) {
      expect(HELP).toContain(word)
    }
  })

  it('usage errors exit 2 with the reason and the usage block on stderr, nothing on stdout', async () => {
    const p = await page('a.md', '')
    for (const [argv, reason] of [
      [['frobnicate', p], 'unknown command: frobnicate'],
      [['comment'], 'comment needs a page'],
      [['comment', p], '--body is required'],
      [['comment', p, '--body'], '--body needs a value'],
      [['comment', p, '--titel', 'Numbers', '--body', 'x'], 'unknown flag: --titel'],
      [['comment', p, '--body', 'x', '--replyto', '2'], 'unknown flag: --replyto'],
      [['edit', p], 'edit needs a comment (#3, #3.1, or its id)'],
      [['delete', p], 'delete needs a comment (#3, #3.1, or its id)'],
    ] as const) {
      const r = await run([...argv])
      expect(r.code, argv.join(' ')).toBe(2)
      expect(r.out).toBe('')
      expect(r.err).toBe(`${reason}\n${USAGE}\n`)
    }
  })
})

describe('comment', () => {
  it('grows a page with no frontmatter, writes `by: agent`, numbers it and prints the receipt', async () => {
    const p = await page('fresh.md', '# Fresh\n\nBody stays.\n')
    const r = await run(['comment', p, '--body', 'First!'])
    expect(r).toEqual({ code: 0, out: `#1 added to ${p}\n`, err: '' })
    const content = await readFile(p, 'utf8')
    expect(content.endsWith('---\n# Fresh\n\nBody stays.\n')).toBe(true)
    const [c] = readComments(content)
    expect(c).toMatchObject({ n: 1, by: 'agent', body: 'First!' })
    expect(c.id).toMatch(/^[0-9a-f]{8}$/)
    expect(c.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    expect(content).toMatch(/    at: [^\n]+\n    by: agent\n    body: First!\n/)
  })

  it('a reply files under the top-level parent and reads as #2.2; --title and --by are honoured', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    const r = await run(['comment', p, '--reply-to', 'cc3', '--title', 'Follow-up', '--by', 'codex', '--body', 'Seen.'])
    expect(r).toEqual({ code: 0, out: `#2.2 added to ${p}\n`, err: '' })
    const added = readComments(await readFile(p, 'utf8')).find((c) => c.body === 'Seen.')
    expect(added).toMatchObject({ n: 2, reply_to: 'bb2', by: 'codex', title: 'Follow-up' })
    // A blank --by is not a declaration: it falls back to `agent`, so the comment stays the agent's to edit or delete.
    await run(['comment', p, '--by', '  ', '--body', 'blank by'])
    expect(readComments(await readFile(p, 'utf8')).find((c) => c.body === 'blank by')?.by).toBe('agent')
  })

  it('--reply-to takes the number the app shows (#2, or bare 2) as well as the id; an unknown target is refused, nothing written', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    expect((await run(['comment', p, '--reply-to', '#2', '--body', 'by number'])).out).toBe(`#2.2 added to ${p}\n`)
    expect((await run(['comment', p, '--reply-to', '2', '--body', 'bare number'])).out).toBe(`#2.3 added to ${p}\n`)
    expect(readComments(await readFile(p, 'utf8')).filter((c) => c.reply_to === 'bb2')).toHaveLength(3)
    const before = await readFile(p, 'utf8')
    expect(await run(['comment', p, '--reply-to', '9', '--body', 'orphan?'])).toEqual({ code: 1, out: '', err: `no comment 9 on ${p}\n` })
    expect(await readFile(p, 'utf8')).toBe(before)
  })

  it('`--body -` takes the comment from stdin, multi-line and all', async () => {
    const p = await page('s.md', '')
    const r = await run(['comment', p, '--body', '-'], 'line one\nline two\n')
    expect(r.code).toBe(0)
    expect(readComments(await readFile(p, 'utf8'))[0].body).toBe('line one\nline two')
  })

  it('a relative page path resolves against the working directory', async () => {
    const p = await page('rel.md', '')
    const cwd = process.cwd()
    process.chdir(dir)
    try {
      expect((await run(['comment', 'rel.md', '--body', 'x'])).out).toBe(`#1 added to ${p}\n`)
    } finally {
      process.chdir(cwd)
    }
  })

  it('refuses a foreign `comments:` value and a broken block — exit 1, bytes untouched', async () => {
    const foreign = await page('f.md', '---\ncomments: 3\n---\n')
    const broken = await page('b.md', '---\ntitle: [\n---\n')
    for (const [p, reason] of [
      [foreign, 'the comments property is not a comment list (foreign)'],
      [broken, 'the properties block does not parse (invalid)'],
    ] as const) {
      const before = await readFile(p, 'utf8')
      const r = await run(['comment', p, '--body', 'x'])
      expect(r).toEqual({ code: 1, out: '', err: `${reason}\n` })
      expect(await readFile(p, 'utf8')).toBe(before)
    }
  })

  it('a page that is not markdown is refused by EVERY verb before any I/O; a missing page with exit 1', async () => {
    const txt = await page('notes.txt', 'hi')
    for (const argv of [['comment', txt, '--body', 'x'], ['comments', txt], ['edit', txt, '#1', '--body', 'x'], ['delete', txt, '#1']]) {
      const r = await run(argv)
      expect(r.code, argv[0]).toBe(1)
      expect(r.err).toBe('only .md/.markdown files are editable\n')
    }
    expect(await readFile(txt, 'utf8')).toBe('hi')
    const missing = await run(['comment', path.join(dir, 'nope.md'), '--body', 'x'])
    expect(missing.code).toBe(1)
    expect(missing.err).not.toBe('')
  })
})

describe('comments', () => {
  it('lists every thread: label, stamp, writer, title or first line; replies indented', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    const r = await run(['comments', p])
    expect(r).toEqual({
      code: 0,
      err: '',
      out: `#1  aa1  ${at(1)}  Person's comment\n#2  bb2  ${at(2)}  (agent)  Numbers\n  #2.1  cc3  ${at(3)}  (agent)  Agent's reply\n`,
    })
  })

  it('--json prints the threads shape; an empty page says so', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    const threads = JSON.parse((await run(['comments', p, '--json'])).out)
    expect(threads).toHaveLength(2)
    expect(threads[1].comment.id).toBe('bb2')
    expect(threads[1].replies[0].id).toBe('cc3')
    const empty = await page('e.md', '# Nothing\n')
    expect((await run(['comments', empty])).out).toBe(`no comments on ${empty}\n`)
    expect(JSON.parse((await run(['comments', empty, '--json'])).out)).toEqual([])
  })
})

describe('edit and delete (🔒 D4: only what an agent wrote)', () => {
  it('edit replaces the body, keeps the title when --title is absent, blank --title removes it, and stamps `edited`', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    expect(await run(['edit', p, 'bb2', '--body', 'Fixed.'])).toEqual({ code: 0, out: '#2 edited\n', err: '' })
    let c = readComments(await readFile(p, 'utf8')).find((x) => x.id === 'bb2')
    expect(c).toMatchObject({ body: 'Fixed.', title: 'Numbers', by: 'agent' })
    expect(c?.edited).toMatch(/Z$/)
    await run(['edit', p, 'bb2', '--body', 'Again.', '--title', ''])
    c = readComments(await readFile(p, 'utf8')).find((x) => x.id === 'bb2')
    expect(c?.title).toBeUndefined()
    expect(c?.body).toBe('Again.')
  })

  it('delete removes the comment and its replies, and says how many', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    expect(await run(['delete', p, 'bb2'])).toEqual({ code: 0, out: '#2 deleted (and 1 reply)\n', err: '' })
    const left = readComments(await readFile(p, 'utf8'))
    expect(left.map((c) => c.id)).toEqual(['aa1'])
    const p2 = await page('w2.md', PERSON_AND_AGENT)
    expect((await run(['delete', p2, 'cc3'])).out).toBe('#2.1 deleted\n')
  })

  it("refuses a person's comment (no `by`) for both verbs — exit 1, bytes untouched", async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    for (const argv of [
      ['edit', p, 'aa1', '--body', 'nope'],
      ['delete', p, 'aa1'],
    ]) {
      const r = await run(argv)
      expect(r).toEqual({ code: 1, out: '', err: '#1 was left by a person — edit or delete it in the app\n' })
    }
    expect(await readFile(p, 'utf8')).toBe(PERSON_AND_AGENT)
  })

  it('edit and delete take the number too (#2.1), and an unknown name is refused with exit 1', async () => {
    const p = await page('w.md', PERSON_AND_AGENT)
    expect((await run(['edit', p, '#2.1', '--body', 'by number'])).out).toBe('#2.1 edited\n')
    expect(readComments(await readFile(p, 'utf8')).find((c) => c.id === 'cc3')?.body).toBe('by number')
    expect((await run(['delete', p, '2.1'])).out).toBe('#2.1 deleted\n')
    expect(await run(['delete', p, 'zz9'])).toEqual({ code: 1, out: '', err: `no comment zz9 on ${p}\n` })
    expect(await run(['delete', p, '#7'])).toEqual({ code: 1, out: '', err: `no comment #7 on ${p}\n` })
  })
})

describe('transformOnDisk (🔒 D8 on disk)', () => {
  it('a file that changes under the first write is re-read and the transform recomputed once', async () => {
    const p = await page('c.md', 'v1\n')
    let calls = 0
    const content = await transformOnDisk(p, (fresh) => {
      calls++
      if (calls === 1) writeFileSync(p, 'v2\n') // someone else lands between the read and the write
      return `${fresh}+\n`
    })
    expect(calls).toBe(2)
    expect(content).toBe('v2\n+\n')
    expect(await readFile(p, 'utf8')).toBe('v2\n+\n')
  })

  it('a second conflict is not retried: the CONFLICT surfaces and the file keeps the other writer\'s bytes', async () => {
    const p = await page('c.md', 'v1\n')
    let n = 0
    await expect(transformOnDisk(p, (fresh) => {
      writeFileSync(p, `v${++n + 1}\n`)
      return `${fresh}+\n`
    })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(p, 'utf8')).toBe('v3\n')
  })

  it('a no-op transform writes nothing', async () => {
    const p = await page('c.md', 'same\n')
    expect(await transformOnDisk(p, (fresh) => fresh)).toBe('same\n')
  })
})

describe('label and find', () => {
  it('find: by id, by #n / n, by #n.m / n.m; an id wins over a number that happens to match', () => {
    const comments = readComments(PERSON_AND_AGENT)
    expect(find(comments, 'cc3')?.id).toBe('cc3')
    expect(find(comments, '#2')?.id).toBe('bb2')
    expect(find(comments, '2')?.id).toBe('bb2')
    expect(find(comments, '#2.1')?.id).toBe('cc3')
    expect(find(comments, '2.1')?.id).toBe('cc3')
    expect(find(comments, '#3')).toBeUndefined()
    expect(find(comments, '#2.9')).toBeUndefined()
    const clash = readComments(`---\ncomments:\n  - id: "2"\n    n: 1\n    at: ${at(1)}\n    body: my id is the digit two\n  - id: b\n    n: 2\n    at: ${at(2)}\n    body: I am #2\n---\n`)
    expect(find(clash, '2')?.id).toBe('2')
  })

  it('label: #n, #parent.n, and the id when there is no number', () => {
    const comments = readComments(PERSON_AND_AGENT)
    expect(comments.map((c) => label(comments, c))).toEqual(['#1', '#2', '#2.1'])
    const bare = readComments('---\ncomments:\n  - id: h1\n    at: 2026-01-01T00:00:00Z\n    body: hand-written\n---\n')
    expect(label(bare, bare[0])).toBe('h1')
  })
})

describe('the door stays Electron-free (🔒 D1)', () => {
  it('nothing cli.ts reaches, directly or through main/fs, imports electron', () => {
    const seen = new Set<string>()
    const walk = (file: string): void => {
      if (seen.has(file)) return
      seen.add(file)
      for (const m of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
        const spec = m[1]
        expect(spec, `${path.relative(process.cwd(), file)} imports ${spec}`).not.toBe('electron')
        if (spec.startsWith('.')) walk(`${path.resolve(path.dirname(file), spec)}.ts`)
      }
    }
    walk(path.resolve(__dirname, 'index.ts'))
    expect(seen.size).toBeGreaterThan(3) // index → cli → main/fs/file → fsUtils, boundedRead …
  })
})
