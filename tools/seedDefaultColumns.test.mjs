/**
 * The default-column seed's suite (YAZ-1513), built like `migrateFolderPages.test.mjs`: every case
 * builds a SYNTHETIC vault in a temp dir, `git init`s it and runs the real CLI as a child process —
 * the same command a human types — so the git preflight, the exit codes and Node's own type
 * stripping are all under test. No real vault is ever touched.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_STATUS, parseArgs, planSettings } from './seedDefaultColumns.mjs'
import { shared } from './lib/vault.mjs'

const SCRIPT = fileURLToPath(new URL('./seedDefaultColumns.mjs', import.meta.url))
const vaults = []

afterEach(() => {
  while (vaults.length > 0) fs.rmSync(vaults.pop(), { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Writes `files` (root-relative path → content) into a fresh temp dir and commits them. */
function makeVault(files, { commit = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-default-columns-'))
  vaults.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
  }
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'seed@test.local')
  git('config', 'user.name', 'Seed Test')
  git('config', 'commit.gpgsign', 'false')
  if (commit) {
    git('add', '-A')
    git('commit', '-q', '-m', 'fixture')
  }
  return root
}

function run(root, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--vault', root, ...args], { encoding: 'utf8', stdio: 'pipe' })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const gitStatus = (root) => execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' })

const STATUS_YAML = '    status:\n      kind: select\n      options:\n        - 1-Backlog\n        - 2-Todo\n        - 3-In-Progress\n        - 4-Done\n'

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

const FIXTURE = {
  // No settings at all: the map, the columns map and the column are all created.
  'Bare.md': '---\nfolder_page: true\n---\n\n# Bare\n',
  // Settings with other columns and three views: outline (order = wikilinks — never touched), a
  // table with an order (gets note.status), a board with no order (needs nothing).
  'Rich.md':
    '---\n' +
    'title: Rich # kept\n' +
    'folder_page: true\n' +
    'folder_page_settings:\n' +
    '  folder: rich\n' +
    '  columns:\n' +
    '    owner:\n' +
    '      kind: link\n' +
    '  views:\n' +
    '    - type: outline\n' +
    '      name: Outline\n' +
    '      order:\n' +
    '        - "[[Alpha]]"\n' +
    '        - "[[Beta]]"\n' +
    '    - type: table\n' +
    '      name: Table\n' +
    '      order:\n' +
    '        - file.name\n' +
    '        - note.owner\n' +
    '    - type: board\n' +
    '      name: Board\n' +
    '---\n' +
    '\nprose body\n',
  // Already seeded, and one view already lists the bare `status` spelling: nothing to do.
  'Done.md':
    '---\nfolder_page: true\nfolder_page_settings:\n  columns:\n    status:\n      kind: select\n      options:\n        - A\n  views:\n    - type: table\n      name: T\n      order:\n        - status\n---\n',
  // Not a folder page (a string flag is not the flag): never touched.
  'Member.md': '---\nfolder_pages:\n  - "[[Bare]]"\nfolder_page: "true"\n---\n\n# Member\n',
  // A dotfolder is invisible to the scan.
  '.yaseendocs/Hidden.md': '---\nfolder_page: true\n---\n',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('the CLI surface', () => {
  it('defaults to a dry run, accepts --apply / --dry-run / --vault=, and rejects unknown flags', () => {
    expect(parseArgs(['--vault', '/v'])).toEqual({ vault: '/v', apply: false, help: false })
    expect(parseArgs(['--vault=/v', '--apply'])).toEqual({ vault: '/v', apply: true, help: false })
    expect(parseArgs(['--vault', '/v', '--apply', '--dry-run']).apply).toBe(false)
    expect(parseArgs(['--bogus']).error).toBe('unknown argument: --bogus')
  })
})

describe('the git gate', () => {
  it('refuses a folder that is not a git repository', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-nogit-'))
    vaults.push(root)
    fs.writeFileSync(path.join(root, 'Bare.md'), FIXTURE['Bare.md'])
    const result = run(root, '--apply')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('REFUSING TO RUN')
    expect(read(root, 'Bare.md')).toBe(FIXTURE['Bare.md'])
  })

  it('refuses a dirty tree — even for a dry run — and names what is dirty', () => {
    const root = makeVault(FIXTURE, { commit: false })
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('REFUSING TO RUN')
    expect(result.stderr).toContain('Bare.md')
    expect(read(root, 'Bare.md')).toBe(FIXTURE['Bare.md'])
  })
})

describe('the transform', () => {
  it('a dry run reports every change and writes NOTHING', () => {
    const root = makeVault(FIXTURE)
    const result = run(root)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('DRY RUN')
    expect(result.stdout).toContain('Markdown files scanned: 4')
    expect(result.stdout).toContain('Folder pages found: 3')
    expect(result.stdout).toContain('Folder pages to change: 2')
    expect(result.stdout).toContain('- Bare.md:')
    expect(result.stdout).toContain('added columns.status')
    expect(result.stdout).toContain('appended note.status to views"Table".order')
    expect(result.stdout).toContain('- Done.md: nothing to do')
    expect(result.stdout).not.toContain('Member.md')
    expect(result.stdout).not.toContain('Hidden.md')
    expect(gitStatus(root)).toBe('')
  })

  it('--apply adds the column, creating the maps as needed, and appends note.status to non-outline orders only', () => {
    const root = makeVault(FIXTURE)
    const result = run(root, '--apply')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('APPLIED')

    expect(read(root, 'Bare.md')).toBe(`---\nfolder_page: true\nfolder_page_settings:\n  columns:\n${STATUS_YAML}---\n\n# Bare\n`)

    const rich = read(root, 'Rich.md')
    // every other byte survives: the comment, the sibling settings keys, their order, the body
    expect(rich.startsWith('---\ntitle: Rich # kept\nfolder_page: true\nfolder_page_settings:\n  folder: rich\n  columns:\n    owner:\n      kind: link\n' + STATUS_YAML)).toBe(true)
    expect(rich.endsWith('---\n\nprose body\n')).toBe(true)
    // the outline's wikilink order is untouched, the table's gets note.status LAST, the board is unchanged
    expect(rich).toContain('    - type: outline\n      name: Outline\n      order:\n        - "[[Alpha]]"\n        - "[[Beta]]"\n')
    expect(rich).toContain('    - type: table\n      name: Table\n      order:\n        - file.name\n        - note.owner\n        - note.status\n')
    expect(rich).toContain('    - type: board\n      name: Board\n---\n')

    // untouched pages are byte-identical
    expect(read(root, 'Done.md')).toBe(FIXTURE['Done.md'])
    expect(read(root, 'Member.md')).toBe(FIXTURE['Member.md'])
    expect(read(root, '.yaseendocs/Hidden.md')).toBe(FIXTURE['.yaseendocs/Hidden.md'])
    expect(gitStatus(root).trimEnd().split('\n').sort()).toEqual([' M Bare.md', ' M Rich.md'])
  })

  it('is idempotent: after --apply and a commit, a second run finds nothing to change', () => {
    const root = makeVault(FIXTURE)
    expect(run(root, '--apply').status).toBe(0)
    execFileSync('git', ['-C', root, 'commit', '-qam', 'seeded'], { stdio: 'pipe' })
    const before = { bare: read(root, 'Bare.md'), rich: read(root, 'Rich.md') }

    const again = run(root, '--apply')
    expect(again.status).toBe(0)
    expect(again.stdout).toContain('Folder pages changed: 0')
    expect(again.stdout).toContain('- Bare.md: nothing to do')
    expect(again.stdout).toContain('- Rich.md: nothing to do')
    expect(read(root, 'Bare.md')).toBe(before.bare)
    expect(read(root, 'Rich.md')).toBe(before.rich)
    expect(gitStatus(root)).toBe('')
  })

  it('never writes to broken frontmatter or a non-map settings key: the unparsable file is listed on its own and never counted as a folder page (YAZ-1549); the bad settings are a skip; exit 0', () => {
    const root = makeVault({
      'Broken.md': '---\nfolder_page: true\nkey: [unclosed\n---\n',
      'Scalar.md': '---\nfolder_page: true\nfolder_page_settings: nope\n---\n',
    })
    const result = run(root, '--apply')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Folder pages found: 1')
    expect(result.stdout).toContain('Could not parse 1 file(s) — not counted as folder pages, never written:')
    expect(result.stdout).toContain('- Broken.md: ')
    expect(result.stdout).not.toContain('- Broken.md: SKIPPED')
    expect(result.stdout).toContain('- Scalar.md: SKIPPED — folder_page_settings is not a map')
    expect(gitStatus(root)).toBe('')
  })

  it('parity (YAZ-1549): the seed writes the SAME declaration the app births — shared/folderPageDefaults.ts is the one spelling', async () => {
    const { DEFAULT_COLUMNS } = await shared('folderPageDefaults.ts')
    expect(DEFAULT_STATUS).toBe(DEFAULT_COLUMNS.status) // the very object, not a copy
    expect(DEFAULT_STATUS).toEqual({ kind: 'select', options: ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'] })
  })
})

describe('planSettings (pure)', () => {
  it('leaves a view alone when note.status OR status is already ordered, and views with no order', () => {
    const views = [
      { type: 'table', name: 'A', order: ['file.name', 'note.status'] },
      { type: 'table', name: 'B', order: ['status'] },
      { type: 'board', name: 'C' },
      { type: 'outline', name: 'O', order: ['[[X]]'] },
    ]
    const plan = planSettings({ folder_page_settings: { columns: { status: { kind: 'select' } }, views } })
    expect(plan.changes).toEqual([])
    expect(plan.value.views).toBe(views)
  })

  it('keeps sibling keys in place and appends to the order of every qualifying view', () => {
    const plan = planSettings({
      folder_page_settings: { defaultView: 'T', views: [{ type: 'table', name: 'T', order: ['file.name'] }, { type: 'cards', name: 'K', order: [] }] },
    })
    expect(Object.keys(plan.value)).toEqual(['defaultView', 'views', 'columns'])
    expect(plan.value.views.map((v) => v.order)).toEqual([['file.name', 'note.status'], ['note.status']])
    expect(plan.changes).toEqual(['added columns.status (select: 1-Backlog, 2-Todo, 3-In-Progress, 4-Done)', 'appended note.status to views"T".order', 'appended note.status to views"K".order'])
  })
})
