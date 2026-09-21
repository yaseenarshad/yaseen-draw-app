/**
 * The migration's suite (YAZ-853). Every case builds a SYNTHETIC vault in a temp dir, `git init`s
 * it and runs the real CLI as a child process — the same command a human types — so the git
 * preflight, the exit codes, the report file and Node's own type stripping are all under test.
 * The real vault (`business-wiki-MASTER`) is never touched by anything here.
 *
 * The fixture mirrors the audited shape of that vault in miniature: registered and unregistered
 * types, `channels:` / `functions:` link arrays beside a `function:` text field, deep
 * `functions/N …/` trees, a `channels/<sub>/` bin, the kept `taxonomy/` and `metrics/…` subtrees,
 * one `.base`, per-type templates, `_scripts/` python, and pages with no `page_type` at all.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { makeResolver, parseArgs, pluralNameFor } from './migrateFolderPages.mjs'

const SCRIPT = fileURLToPath(new URL('./migrateFolderPages.mjs', import.meta.url))
const vaults = []

afterEach(() => {
  while (vaults.length > 0) fs.rmSync(vaults.pop(), { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Writes `files` (root-relative path → content) into a fresh temp dir and commits them. */
function makeVault(files, { commit = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-pages-migrate-'))
  vaults.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
  }
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'migration@test.local')
  git('config', 'user.name', 'Migration Test')
  git('config', 'commit.gpgsign', 'false')
  if (commit) {
    git('add', '-A')
    git('commit', '-q', '-m', 'fixture')
  }
  return root
}

function run(root, ...args) {
  const result = execFileSync(process.execPath, [SCRIPT, '--vault', root, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    // execFileSync throws on a non-zero exit; capture instead so every case can assert on it.
  })
  return { status: 0, stdout: result, stderr: '' }
}

function runAllowingFailure(root, ...args) {
  try {
    return run(root, ...args)
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (root, rel) => fs.existsSync(path.join(root, rel))
const report = (root) => read(root, 'migration-report.md')

/** The one number a second dry run has to be able to say is zero. */
function pendingChanges(stdout) {
  const m = /\| \*\*Pending changes\*\* \| \*\*(\d+)\*\* \|/.exec(stdout)
  expect(m, 'the report always carries a pending-changes count').not.toBeNull()
  return Number(m[1])
}

/**
 * Every `.md` in the vault, root-relative, `/`-separated and sorted. The report is left out: it is
 * the script's own artifact and carries a fresh timestamp on every run by design.
 */
function markdownFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.name.endsWith('.md')) out.push(path.relative(root, abs).split(path.sep).join('/'))
    }
  }
  walk(root)
  return out.filter((rel) => rel !== 'migration-report.md').sort()
}

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

const TYPES_JSON = JSON.stringify(
  {
    version: 1,
    types: {
      problem: {
        displayName: 'Problem',
        folder: 'problems',
        properties: {
          kpis_impacted: { kind: 'multi-link', target: 'kpi' },
          sold_to: { kind: 'multi-link', target: 'role' },
          sku_tag: { kind: 'text', required: true },
        },
      },
      // Declared but carried by no page: no folder page is created for it, and a target naming
      // it still gets the name one WOULD have.
      role: { displayName: 'Role', folder: 'roles', properties: {} },
      function: { pluralName: 'Functions', folder: 'functions', properties: {} },
      channel: { pluralName: 'Channels', folder: 'channels', properties: { spend: { kind: 'number' } } },
      metric: { displayName: 'Metric', folder: 'metrics', properties: {} },
      industry: { displayName: 'Industry', folder: 'industries', properties: {} },
    },
    properties: {},
  },
  null,
  2,
)

/** The mini-vault every "happy path" case starts from. */
function fixture(extra = {}) {
  return {
    '.yaseendocs/types.json': TYPES_JSON,
    '.yaseendocs/templates/problem.md': '---\npage_type: problem\nsku_tag:\nchannels: []\n---\n\n# Problem template\n',
    '.yaseendocs/templates/metric.md': '---\n---\n\n# Metric template\n',

    // A deep function tree: the problem goes out to problems/, the function page comes up flat.
    'functions/1. Sales/CRM Hygiene.md':
      '---\npage_type: problem\n# a comment nobody may eat\nkpis_impacted: ["[[CAC]]"]\nfunctions: ["[[Sales]]"]\nfunction: Sales\nsku_tag: operational\n---\n\n# CRM Hygiene\n\nOwned by [[Sales]], measured by [[CAC]].\n',
    'functions/1. Sales/Sales.md': '---\npage_type: function\n---\n\n# Sales\n',
    'functions/X Cross-Functional/Handoffs.md':
      '---\npage_type: problem\nfunctions: ["[[Sales]]", "[[Sales]]"]\nfunction: Sales\n---\n\n# Handoffs\n',

    // A channels/<sub>/ bin that dissolves into the type's registry folder.
    'channels/Outbound/Cold Email.md': '---\npage_type: channel\nspend: 1200\n---\n\n# Cold Email\n',

    // Cards outside both trees.
    'kpis/CAC.md': '---\npage_type: kpi\nchannels: ["[[Cold Email]]"]\nunit: currency\n---\n\n# CAC\n',
    'kpis/Win Rate.md': '---\npage_type: kpi\n---\n\n# Win Rate\n',
    'books/Traction.md': '---\npage_type: book\nauthor: Weinberg\n---\n\n# Traction\n',
    'industries/PLG SaaS.md': '---\npage_type: industry\n---\n\n# PLG SaaS\n',

    // The two kept subtrees: transformed as cards, never moved.
    'metrics/calculated/Blended CAC.md': '---\npage_type: metric\n---\n\n# Blended CAC\n',
    'taxonomy/Verticals.md': '---\npage_type: taxonomy\n---\n\n# Verticals\n',

    // A text-only `function:` — no links field carried it, so it stays.
    'notes/Standup.md': '---\nfunction: Sales\n---\n\n# Standup\n',
    // No frontmatter at all.
    'notes/Loose thought.md': '# Loose thought\n\nSee [[CAC]].\n',

    'functions/Problems by function.base': 'views:\n  - type: table\n    name: Table\n',
    '_scripts/tag_pages.py': "import yaml\n\ndoc['page_type'] = 'problem'\nopen(p, 'w').write(yaml.dump(doc))\n",
    '_scripts/report_only.py': "print(doc.get('page_type'))\n",
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('naming (🔒 D4)', () => {
  it('takes the registry pluralName first, then displayName, then the irregulars, then the type name', () => {
    expect(pluralNameFor('function', { pluralName: 'Functions' })).toEqual({
      name: 'Functions',
      source: 'types.json pluralName',
    })
    expect(pluralNameFor('industry', { displayName: 'Industry' })).toEqual({
      name: 'Industries',
      source: 'types.json displayName',
    })
    expect(pluralNameFor('kpi', undefined)).toEqual({ name: 'KPIs', source: 'irregulars map' })
    expect(pluralNameFor('book', undefined).name).toBe('Books')
    expect(pluralNameFor('author', undefined).name).toBe('Authors')
    expect(pluralNameFor('metric', undefined).name).toBe('Metrics')
    expect(pluralNameFor('funnel-stage', undefined).name).toBe('Funnel Stages')
    expect(pluralNameFor('process', undefined).name).toBe('Processes')
  })
})

describe('resolution', () => {
  const pages = [
    { abs: '/v/KPIs.md', folder: '', basename: 'KPIs', aliases: [] },
    { abs: '/v/deep/nest/CAC.md', folder: 'deep/nest', basename: 'CAC', aliases: [] },
    { abs: '/v/CAC.md', folder: '', basename: 'CAC', aliases: ['Cost of acquisition'] },
  ]
  const resolve = makeResolver(pages, '/v')

  it('is case-insensitive, strips `|alias` and `#heading`, and prefers the shallowest duplicate', () => {
    expect(resolve('[[kpis]]').abs).toBe('/v/KPIs.md')
    expect(resolve('[[CAC|the metric]]').abs).toBe('/v/CAC.md')
    expect(resolve('[[CAC#Definition]]').abs).toBe('/v/CAC.md')
    expect(resolve('[[deep/nest/CAC]]').abs).toBe('/v/deep/nest/CAC.md')
    expect(resolve('[[Cost of acquisition]]').abs).toBe('/v/CAC.md')
    expect(resolve('[[Nobody]]')).toBeNull()
  })
})

describe('the CLI surface', () => {
  it('defaults to a dry run and needs no flag for it', () => {
    expect(parseArgs(['--vault', '/x'])).toEqual({ vault: '/x', apply: false, help: false })
    expect(parseArgs(['--vault', '/x', '--apply']).apply).toBe(true)
    expect(parseArgs(['--vault=/x', '--dry-run']).apply).toBe(false)
    expect(parseArgs(['--nope']).error).toMatch(/unknown argument/)
  })
})

// ---------------------------------------------------------------------------
// The git gate (🔒 D1)
// ---------------------------------------------------------------------------

describe('the git gate (🔒 D1)', () => {
  it('refuses a folder that is not a git repository', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-pages-nogit-'))
    vaults.push(root)
    fs.writeFileSync(path.join(root, 'A.md'), '---\npage_type: kpi\n---\n')
    const result = runAllowingFailure(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/not a git repository/)
    expect(exists(root, 'migration-report.md')).toBe(false)
  })

  it('refuses a dirty tree, and names what is dirty', () => {
    const root = makeVault(fixture())
    fs.writeFileSync(path.join(root, 'kpis/CAC.md'), '---\npage_type: kpi\nunit: edited\n---\n')
    const result = runAllowingFailure(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/REFUSING TO RUN/)
    expect(result.stderr).toMatch(/uncommitted changes/)
    expect(result.stderr).toContain('kpis/CAC.md')
    // Nothing was written, the report included.
    expect(exists(root, 'migration-report.md')).toBe(false)
  })

  it('forgives its OWN report, so a dry run never blocks the --apply that follows', () => {
    const root = makeVault(fixture())
    run(root)
    expect(exists(root, 'migration-report.md')).toBe(true)
    // The report is now an untracked file in the tree, and --apply still runs.
    expect(run(root, '--apply').status).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The whole transform
// ---------------------------------------------------------------------------

describe('the transform (🔒 D3/D4/D5)', () => {
  it('a dry run changes NOTHING on disk but the report', () => {
    const root = makeVault(fixture())
    const before = markdownFiles(root).map((rel) => [rel, read(root, rel)])
    const result = run(root)
    expect(result.status).toBe(0)
    for (const [rel, content] of before) expect(read(root, rel)).toBe(content)
    expect(exists(root, 'Home.md')).toBe(false)
    expect(exists(root, 'KPIs.md')).toBe(false)
    expect(exists(root, '.yaseendocs/types.json')).toBe(true)
    expect(exists(root, 'functions/Problems by function.base')).toBe(true)
    expect(pendingChanges(result.stdout)).toBeGreaterThan(0)
  })

  it('rewrites the cards per key, keeping every other byte', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    const crm = read(root, 'problems/CRM Hygiene.md')

    // page_type / channels / functions gone, the rest untouched — comment included.
    expect(crm).not.toMatch(/^page_type:/m)
    expect(crm).not.toMatch(/^functions:/m)
    expect(crm).toContain('# a comment nobody may eat')
    expect(crm).toContain('kpis_impacted: ["[[CAC]]"]')
    expect(crm).toContain('sku_tag: operational')
    expect(crm).toContain('# CRM Hygiene\n\nOwned by [[Sales]], measured by [[CAC]].\n')

    // page_type became a folder page entry; the `functions:` links merged in beside it.
    expect(crm).toMatch(/folder_pages:\n\s+- "\[\[Problems\]\]"\n\s+- "\[\[Sales\]\]"/)

    // The `function:` TEXT field went only because `functions:` carried the same data (🔒 D3).
    expect(crm).not.toMatch(/^function:/m)
  })

  it('merges `channels:` in order and de-duplicates like a click', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    expect(read(root, 'kpis/CAC.md')).toMatch(/folder_pages:\n\s+- "\[\[KPIs\]\]"\n\s+- "\[\[Cold Email\]\]"/)
    expect(read(root, 'kpis/CAC.md')).toContain('unit: currency')
    // `functions: ["[[Sales]]", "[[Sales]]"]` is ONE entry, not two.
    const handoffs = read(root, 'problems/Handoffs.md')
    expect(handoffs.match(/\[\[Sales\]\]/g)).toHaveLength(1)
  })

  it('keeps a text-only `function:` and lists it in the report (🔒 D3)', () => {
    const root = makeVault(fixture())
    const result = run(root, '--apply')
    expect(read(root, 'notes/Standup.md')).toContain('function: Sales')
    expect(result.stdout).toMatch(/## Text-only `function:` pages KEPT \(1\)/)
    expect(result.stdout).toContain('`notes/Standup.md`')
  })

  it('creates one folder page per distinct page_type, with columns from the registry', () => {
    const root = makeVault(fixture())
    run(root, '--apply')

    const problems = read(root, 'Problems.md')
    expect(problems).toContain('folder_page: true')
    expect(problems).toContain('folder_pages:\n  - "[[Home]]"')
    expect(problems).toContain('folder: problems')
    expect(problems).toContain('kpis_impacted:')
    expect(problems).toContain('kind: multi-link')
    // `target: kpi` became the wikilink to that type's folder page.
    expect(problems).toContain('target: "[[KPIs]]"')
    expect(problems).toContain('required: true')

    // Unregistered types get a folder page too, with no columns and no folder.
    const books = read(root, 'Books.md')
    expect(books).toContain('folder_page: true')
    expect(books).not.toContain('folder_page_settings')

    for (const name of ['Problems.md', 'Functions.md', 'Channels.md', 'KPIs.md', 'Books.md', 'Industries.md', 'Metrics.md', 'Taxonomies.md']) {
      expect(exists(root, name), name).toBe(true)
    }
    // A type no page carries gets no folder page of its own.
    expect(exists(root, 'Roles.md')).toBe(false)
  })

  it('points a target at a declared-but-unused type by name, and says so', () => {
    const root = makeVault(fixture())
    const result = run(root, '--apply')
    expect(read(root, 'Problems.md')).toContain('target: "[[Roles]]"')
    expect(result.stdout).toMatch(/targets `role`, a type no page carries — pointed at \[\[Roles\]\], which does not exist yet/)
  })

  it('flags channel and function pages so the merged entries can count (🔒 D4)', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    expect(read(root, 'functions/Sales.md')).toContain('folder_page: true')
    expect(read(root, 'functions/Sales.md')).toContain('"[[Functions]]"')
    expect(read(root, 'channels/Cold Email.md')).toContain('folder_page: true')
    expect(read(root, 'channels/Cold Email.md')).toContain('"[[Channels]]"')
  })

  it('creates Home with an outline listing the folder pages, registered first', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    const home = read(root, 'Home.md')
    expect(home).toContain('folder_page: true')
    expect(home).toContain('type: outline')
    for (const name of ['Channels', 'Functions', 'Industries', 'Metrics', 'Problems', 'Books', 'KPIs', 'Taxonomies']) {
      expect(home, name).toContain(`"[[${name}]]"`)
    }
    // Registered types (sorted by their registry folder) lead; the unregistered follow.
    const at = (name) => home.indexOf(`[[${name}]]`)
    expect(at('Channels')).toBeLessThan(at('Books'))
    expect(at('Problems')).toBeLessThan(at('Books'))
    expect(at('Books')).toBeLessThan(at('KPIs'))
  })

  it('renames the templates onto the folder page names (🔒 D4)', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    expect(exists(root, '.yaseendocs/templates/problem.md')).toBe(false)
    expect(exists(root, '.yaseendocs/templates/Problems.md')).toBe(true)
    const template = read(root, '.yaseendocs/templates/Problems.md')
    expect(template).toContain('# Problem template')
    // The 7D rule: a renamed template's CONTENT migrates too — dead keys scrubbed, the rest kept.
    expect(template).not.toContain('page_type')
    expect(template).not.toContain('channels: []')
    expect(template).toContain('sku_tag:')
    expect(exists(root, '.yaseendocs/templates/Metrics.md')).toBe(true)
  })

  it('deletes types.json once it has been extracted, writing no properties.json when it declares none', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    expect(exists(root, '.yaseendocs/types.json')).toBe(false)
    expect(exists(root, '.yaseendocs/properties.json')).toBe(false)
  })

  it('writes properties.json when types.json DOES carry vault-wide declarations', () => {
    const root = makeVault(
      fixture({
        '.yaseendocs/types.json': JSON.stringify({
          version: 1,
          types: { problem: { displayName: 'Problem', folder: 'problems', properties: {} } },
          properties: { owner: { kind: 'text' }, sold_to: { kind: 'multi-link', target: 'problem' } },
        }),
      }),
    )
    const result = run(root, '--apply')
    const declared = JSON.parse(read(root, '.yaseendocs/properties.json'))
    expect(declared.version).toBe(1)
    expect(declared.properties.owner).toEqual({ kind: 'text' })
    expect(declared.properties.sold_to).toEqual({ kind: 'multi-link', target: '[[Problems]]' })
    expect(result.stdout).toMatch(/## `\.yaseendocs\/properties\.json`/)
  })

  it('flattens the functions tree and dissolves the channels bins (🔒 D5)', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    expect(exists(root, 'problems/CRM Hygiene.md')).toBe(true)
    expect(exists(root, 'problems/Handoffs.md')).toBe(true)
    expect(exists(root, 'functions/Sales.md')).toBe(true)
    expect(exists(root, 'channels/Cold Email.md')).toBe(true)
    expect(exists(root, 'functions/1. Sales')).toBe(false)
    expect(exists(root, 'functions/X Cross-Functional')).toBe(false)
    expect(exists(root, 'channels/Outbound')).toBe(false)
  })

  it('never touches taxonomy/ or metrics/calculated|counts|sums placement (🔒 D5)', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    expect(exists(root, 'metrics/calculated/Blended CAC.md')).toBe(true)
    expect(exists(root, 'taxonomy/Verticals.md')).toBe(true)
    // Still transformed as cards, just never moved.
    expect(read(root, 'taxonomy/Verticals.md')).toContain('"[[Taxonomies]]"')
  })

  it('deletes the retired .base file (🔒 D5)', () => {
    const root = makeVault(fixture())
    const result = run(root, '--apply')
    expect(exists(root, 'functions/Problems by function.base')).toBe(false)
    expect(result.stdout).toContain('Problems by function.base')
  })

  it('gives every _scripts/ python a writes-page_type verdict and runs none of them (🔒 D5)', () => {
    const root = makeVault(fixture())
    const before = read(root, '_scripts/tag_pages.py')
    const result = run(root, '--apply')
    expect(read(root, '_scripts/tag_pages.py')).toBe(before)
    expect(result.stdout).toMatch(/\| `_scripts\/tag_pages\.py` \| yes \|/)
    expect(result.stdout).toMatch(/\| `_scripts\/report_only\.py` \| no \|/)
  })

  it('lists the pages with no page_type as the Uncategorized set (🔒 D6)', () => {
    const root = makeVault(fixture())
    const result = run(root)
    expect(result.stdout).toMatch(/## Pages with no `page_type` → Uncategorized \(2\)/)
    expect(result.stdout).toContain('`notes/Standup.md`')
    expect(result.stdout).toContain('`notes/Loose thought.md`')
  })

  it('writes the report to the vault as well as printing it (🔒 D6)', () => {
    const root = makeVault(fixture())
    const result = run(root)
    expect(report(root).trim()).toBe(result.stdout.split('\nReport written to')[0].trim())
    expect(report(root)).toMatch(/^# Folder-page migration report/)
  })
})

// ---------------------------------------------------------------------------
// Idempotency (🔒 D1)
// ---------------------------------------------------------------------------

describe('idempotency (🔒 D1)', () => {
  it('a dry run after --apply reports ZERO pending changes', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'pipe' })
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'migrated'], { stdio: 'pipe' })

    const second = run(root)
    expect(pendingChanges(second.stdout)).toBe(0)
    expect(second.stdout).toContain('this vault is already migrated')
  })

  it('a second --apply rewrites nothing', () => {
    const root = makeVault(fixture())
    run(root, '--apply')
    execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'pipe' })
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'migrated'], { stdio: 'pipe' })

    const snapshot = markdownFiles(root).map((rel) => [rel, read(root, rel)])
    run(root, '--apply')
    expect(markdownFiles(root)).toEqual(snapshot.map(([rel]) => rel))
    for (const [rel, content] of snapshot) expect(read(root, rel), rel).toBe(content)
  })
})

// ---------------------------------------------------------------------------
// Tolerance and refusals
// ---------------------------------------------------------------------------

describe('tolerance (report, never block)', () => {
  it('tolerates scalar link fields, and never writes to broken frontmatter', () => {
    const root = makeVault(
      fixture({
        // A scalar where the vault usually has a list — the indexer counts it as one entry.
        'kpis/LTV.md': '---\npage_type: kpi\nchannels: "[[Cold Email]]"\n---\n\n# LTV\n',
        // Frontmatter that will not parse at all.
        'notes/Broken.md': '---\npage_type: kpi\n  bad: [unclosed\n---\n\n# Broken\n',
      }),
    )
    const before = read(root, 'notes/Broken.md')
    const result = runAllowingFailure(root, '--apply')

    expect(read(root, 'kpis/LTV.md')).toMatch(/folder_pages:\n\s+- "\[\[KPIs\]\]"\n\s+- "\[\[Cold Email\]\]"/)
    expect(read(root, 'notes/Broken.md')).toBe(before)
    expect(result.stdout).toMatch(/## Pages skipped \(1\)/)
    expect(result.stdout).toMatch(/notes\/Broken\.md.*will not parse/)
  })

  it('never merges into a `folder_pages` MAPPING — it stops that card and says so', () => {
    const root = makeVault(
      fixture({ 'kpis/NRR.md': '---\npage_type: kpi\nfolder_pages:\n  a: 1\n---\n\n# NRR\n' }),
    )
    const before = read(root, 'kpis/NRR.md')
    runAllowingFailure(root, '--apply')
    expect(read(root, 'kpis/NRR.md')).toBe(before)
    expect(report(root)).toMatch(/kpis\/NRR\.md.*is a mapping/)
  })

  it('stops a move onto an occupied name instead of overwriting it (🔒 D5)', () => {
    const root = makeVault(
      fixture({
        // A second `CRM Hygiene` already sits in problems/ — the move must not eat it.
        'problems/CRM Hygiene.md': '---\npage_type: problem\n---\n\n# The original CRM Hygiene\n',
      }),
    )
    run(root, '--apply')
    expect(read(root, 'problems/CRM Hygiene.md')).toContain('# The original CRM Hygiene')
    expect(exists(root, 'functions/1. Sales/CRM Hygiene.md')).toBe(true)
    expect(report(root)).toMatch(/## Name collisions — STOPPED \(1\)/)
    expect(report(root)).toMatch(/functions\/1\. Sales\/CRM Hygiene\.md/)
  })

  it('adopts a folder page that already exists rather than creating a rival', () => {
    const root = makeVault(
      fixture({
        'KPIs.md':
          '---\nfolder_page_settings:\n  views:\n    - type: table\n      name: Mine\n---\n\n# KPIs\n\nMy own page.\n',
      }),
    )
    run(root, '--apply')
    const kpis = read(root, 'KPIs.md')
    expect(kpis).toContain('# KPIs\n\nMy own page.')
    expect(kpis).toContain('folder_page: true')
    // Its own settings survive untouched — nothing is ever overwritten.
    expect(kpis).toContain('name: Mine')
    expect(kpis).toContain('"[[Home]]"')
    expect(report(root)).toMatch(/adopted, already existed/)
  })

  it('never spawns a rival Home when one already answers', () => {
    const root = makeVault(fixture({ 'notes/home.md': '---\naliases: [Home]\n---\n\n# The real home\n' }))
    run(root, '--apply')
    expect(exists(root, 'Home.md')).toBe(false)
    expect(read(root, 'notes/home.md')).toContain('folder_page: true')
    expect(report(root)).toMatch(/already resolves to `notes\/home\.md`/)
  })
})

// ---------------------------------------------------------------------------
// Post-checks (🔒 D6)
// ---------------------------------------------------------------------------

describe('post-checks (🔒 D6)', () => {
  it('all four pass on a clean migration', () => {
    const root = makeVault(fixture())
    const result = run(root, '--apply')
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/### PASS — no `page_type` key remains anywhere/)
    expect(result.stdout).toMatch(/### PASS — every written `folder_pages` entry resolves to a flagged folder page/)
    expect(result.stdout).toMatch(/### PASS — per-folder-page member counts equal the old per-type counts/)
    expect(result.stdout).toMatch(/### PASS — every pre-existing body `\[\[wikilink\]\]` still resolves to the same page/)
    expect(result.stdout).not.toMatch(/### FAIL/)
    // The member-count table shows its work.
    expect(result.stdout).toMatch(/\| Problems \| `problem` \| 2 \| 0 \| 2 \| 2 \| ok \|/)
  })

  it('FAILS loudly, and exits 1, when a merged entry resolves to nothing', () => {
    // `channels: ["[[Nowhere]]"]` merges a dangling link into folder_pages — the entry was
    // written by this migration and can never count, so post-check 2 must catch it.
    const root = makeVault(fixture({ 'kpis/ARR.md': '---\npage_type: kpi\nchannels: ["[[Nowhere]]"]\n---\n\n# ARR\n' }))
    const result = runAllowingFailure(root, '--apply')
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/### FAIL — every written `folder_pages` entry resolves to a flagged folder page/)
    expect(result.stdout).toMatch(/kpis\/ARR\.md: \[\[Nowhere\]\] resolves to nothing/)
    expect(result.stderr).toMatch(/post-check\(s\) FAILED/)
    expect(report(root)).toMatch(/### FAIL/)
  })

  it('FAILS when a move breaks a pathed body wikilink', () => {
    const root = makeVault(
      fixture({
        'notes/Index.md': '---\n---\n\n# Index\n\nSee [[functions/1. Sales/CRM Hygiene]].\n',
      }),
    )
    const result = runAllowingFailure(root, '--apply')
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/### FAIL — every pre-existing body `\[\[wikilink\]\]` still resolves to the same page/)
    expect(result.stdout).toMatch(/notes\/Index\.md: \[\[functions\/1\. Sales\/CRM Hygiene\]\]/)
  })
})
