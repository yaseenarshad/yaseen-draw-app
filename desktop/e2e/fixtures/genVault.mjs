#!/usr/bin/env node
/**
 * GRO-2227 (scope pass for the persistent vault-index cache, GRO-2223): synthetic fixture-vault
 * generator for index benchmarks. Deterministic — a given --notes/--seed pair always produces the
 * same vault. Shapes mirror `viewsFixture.ts` / `helpers.buildFixtureVault`: realistic frontmatter
 * (status/priority/pillar/tags/aliases on a subset), bodies with `[[wiki links]]` between notes,
 * inline #tags, code fences, `![[embeds]]`, folder depth 0-4, png stubs, `.yaseendraw/` config
 * and a `.trash` note.
 *
 * THE FOLDER-PAGE SHAPE (7C-, YAZ-855): the vault this emits speaks the model the app actually
 * ships. A handful of root-level FOLDER PAGES (`folder_page: true`, with columns and both skins)
 * hang off a `Home`; most notes name one — occasionally two — of them in their own
 * `folder_pages`, and the rest belong nowhere and wait under Uncategorized. Scale is unchanged:
 * `--notes` still counts ordinary notes, with the folder pages a fixed handful on top.
 * `page_type` and `.base` are gone from here, exactly as they are gone from the app.
 *
 * Generated vaults go to a TEMP dir, never the repo — an --out inside the repository is refused.
 *
 * Usage:
 *   node desktop/e2e/fixtures/genVault.mjs --notes 1000 [--out /tmp/vault-1k] [--seed 42]
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------- args ----------

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
const NOTES = Number(argOf('--notes') ?? 1000)
const SEED = Number(argOf('--seed') ?? 42)
if (!Number.isInteger(NOTES) || NOTES < 1) {
  console.error('usage: genVault.mjs --notes <n> [--out <dir outside the repo>] [--seed <n>]')
  process.exit(1)
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const outArg = argOf('--out')
if (outArg !== undefined && (path.resolve(outArg) === REPO_ROOT || path.resolve(outArg).startsWith(REPO_ROOT + path.sep))) {
  console.error(`refusing --out inside the repository (${REPO_ROOT}); generated vaults belong in a temp dir`)
  process.exit(1)
}

// ---------- seeded PRNG (mulberry32) ----------

let prngState = SEED >>> 0
function rand() {
  prngState = (prngState + 0x6d2b79f5) >>> 0
  let t = prngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min, max) => min + Math.floor(rand() * (max - min + 1))
const pick = (list) => list[Math.floor(rand() * list.length)]
const chance = (p) => rand() < p

// ---------- content pools ----------

const FOLDER_NAMES = ['Projects', 'Areas', 'Archive', 'Inbox', 'Content Pillars', 'Weekly Reviews', 'Clients', 'Research', 'Drafts', 'Meetings', 'People', 'Systems']
/**
 * The folder pages, in `Home`'s own order. Names deliberately unlike the note basenames
 * (`<TOPIC> <nnnn>`) and unlike the generated folder names (`<FOLDER_NAME> <n>`), so a
 * `[[wiki link]]` can never resolve to the wrong one.
 */
const TOPIC_PAGES = ['Topics', 'Playbooks', 'Accounts', 'Experiments', 'Rituals', 'Sources', 'Signals', 'Decisions']
const HOME_PAGE = 'Home'
const TOPICS = ['Idea', 'Meeting', 'Project', 'Review', 'Draft', 'Client Call', 'Research Note', 'Plan', 'Retro', 'Brief']
const STATUSES = ['idea', 'drafting', 'published', 'archived', 'in-review']
const PILLARS = ['Agentic Agency', 'Creator Economy', 'Trust Economy', 'Tech & Silicon Valley']
const TAGS = ['agentic', 'agentic/levels', 'creator', 'pillar', 'attribution', 'gtm', 'gtm/outbound', 'ops', 'writing', 'video']
const SENTENCES = [
  'The compounding effect of small daily improvements is easy to underestimate.',
  'Most funnels leak at the handoff between marketing and sales.',
  'A vault is only as useful as the links between its notes.',
  'Ship the smallest version that proves the mechanism works.',
  'Attribution is hard when every channel claims the same conversion.',
  'The archive is an asset when it is indexed and searchable.',
  'Levels of delegation map cleanly onto levels of agency.',
  'Write the spec before the code and the code writes itself.',
  'Distribution beats product quality more often than founders admit.',
  'A weekly review closes loops that daily work leaves open.',
]

// ---------- vault shape ----------

async function main() {
  const root = outArg !== undefined ? path.resolve(outArg) : await mkdtemp(path.join(tmpdir(), `mdapp-genvault-${NOTES}-`))

  // Folder tree, depth 0-4: root ('') plus ~1 folder per 25 notes, each parented on an existing folder.
  const folders = ['']
  const folderCount = Math.max(6, Math.floor(NOTES / 25))
  for (let i = 0; i < folderCount; i++) {
    const parent = pick(folders)
    if (parent.split('/').filter(Boolean).length >= 4) continue
    const name = `${pick(FOLDER_NAMES)} ${i}`
    folders.push(parent === '' ? name : `${parent}/${name}`)
  }
  await Promise.all(
    [...folders.filter((f) => f !== ''), '.yaseendraw', '.trash'].map((f) => mkdir(path.join(root, ...f.split('/')), { recursive: true })),
  )

  // The folder pages: a fixed handful, scaled gently with the vault and capped by the pool, so a
  // 1k vault has a believable number of topics rather than one per hundred notes.
  const topicPages = TOPIC_PAGES.slice(0, Math.min(TOPIC_PAGES.length, Math.max(4, Math.floor(NOTES / 150))))

  // Basenames first, so bodies can link to any other note (wiki links resolve by basename).
  const basenames = Array.from({ length: NOTES }, (_, i) => `${pick(TOPICS)} ${String(i).padStart(4, '0')}`)

  let belonging = 0
  const noteFile = (i) => {
    const basename = basenames[i]
    const lines = []
    // BELONGING (YAZ-814): most notes name a topic in their own frontmatter — a few name two,
    // because a page belongs to as many folder pages as it says it does — and the rest name none
    // and land in Uncategorized. A note that belongs always has a frontmatter block; the rest
    // keep their own roll, so the vault stays a mix of carded and bare notes.
    const entries = [...new Set(chance(0.82) ? [pick(topicPages), ...(chance(0.12) ? [pick(topicPages)] : [])] : [])]
    if (entries.length > 0) belonging++
    if (entries.length > 0 || chance(0.45)) {
      lines.push('---')
      if (entries.length > 0) lines.push(`folder_pages: [${entries.map((t) => `"[[${t}]]"`).join(', ')}]`)
      lines.push(`status: ${pick(STATUSES)}`)
      if (chance(0.6)) lines.push(`priority: ${int(1, 5)}`)
      if (chance(0.5)) lines.push(`pillar: ${pick(PILLARS)}`)
      if (chance(0.55)) lines.push(`tags: [${Array.from({ length: int(1, 4) }, () => pick(TAGS)).join(', ')}]`)
      if (chance(0.3)) lines.push(`published: ${chance(0.5)}`)
      if (chance(0.4)) lines.push(`date: 2026-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`)
      if (chance(0.15)) lines.push(`aliases: ["${basename} (alias)"]`)
      if (chance(0.15)) lines.push(`related: "[[${basenames[int(0, NOTES - 1)]}]]"`)
      lines.push('---', '')
    }
    lines.push(`# ${basename}`, '')
    const paragraphs = int(1, 6)
    for (let p = 0; p < paragraphs; p++) {
      const parts = Array.from({ length: int(1, 4) }, () => pick(SENTENCES))
      // Wiki links between notes: 0-2 per paragraph, sometimes with |alias or #heading forms.
      for (let l = int(0, 2); l > 0; l--) {
        const target = basenames[int(0, NOTES - 1)]
        parts.push(chance(0.2) ? `See [[${target}|the ${pick(TOPICS).toLowerCase()}]].` : chance(0.2) ? `See [[${target}#Notes]].` : `See [[${target}]].`)
      }
      if (chance(0.3)) parts.push(`#${pick(TAGS)}`)
      lines.push(parts.join(' '), '')
    }
    if (chance(0.1)) lines.push('```', '#not-a-tag inside a code fence', '```', '')
    if (chance(0.1)) lines.push(`![[chart-${int(0, 3)}.png]]`, '')
    return { file: path.join(root, ...pick(folders).split('/').filter(Boolean), `${basename}.md`), content: lines.join('\n') }
  }

  // Write with bounded concurrency, matching the scanner's own pattern.
  let next = 0
  let bytes = 0
  const worker = async () => {
    while (next < NOTES) {
      const { file, content } = noteFile(next++)
      bytes += content.length
      await writeFile(file, content)
    }
  }
  await Promise.all(Array.from({ length: 64 }, worker))

  // The folder pages themselves, at the root: the flag, a membership in Home, declared columns and
  // Q7's two skins. Their `folder` is a real generated bin, so "New" would park a member somewhere
  // that exists.
  const folderPage = (name, bin) =>
    [
      '---',
      'folder_page: true',
      `folder_pages: ["[[${HOME_PAGE}]]"]`,
      'folder_page_settings:',
      '  columns:',
      '    status:',
      '      kind: text',
      '    priority:',
      '      kind: number',
      '    pillar:',
      '      kind: text',
      ...(bin === undefined ? [] : [`  folder: ${bin}`]),
      '  views:',
      '    - type: outline',
      '      name: Outline',
      '    - type: table',
      '      name: Table',
      '      order:',
      '        - file.name',
      '        - note.status',
      '        - note.priority',
      '---',
      '',
      `# ${name}`,
      '',
      `Every page in this vault that says it belongs to ${name}. There is no list to maintain.`,
      '',
    ].join('\n')

  const home = [
    '---',
    'folder_page: true',
    'folder_page_settings:',
    '  views:',
    '    - type: outline',
    '      name: Outline',
    '      order:',
    ...topicPages.map((name) => `        - "[[${name}]]"`),
    '    - type: table',
    '      name: Table',
    '---',
    '',
    `# ${HOME_PAGE}`,
    '',
    'The root of the map: every folder page below belongs here, in this order.',
    '',
  ].join('\n')

  const bins = folders.filter((f) => f !== '')
  const pages = [
    [`${HOME_PAGE}.md`, home],
    ...topicPages.map((name, i) => [`${name}.md`, folderPage(name, bins[i % bins.length])]),
  ]
  for (const [, content] of pages) bytes += content.length
  await Promise.all(pages.map(([name, content]) => writeFile(path.join(root, name), content)))

  // Non-record files: png stubs, the vault's own config dir, a .trash note (mirrors viewsFixture).
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await Promise.all([
    ...Array.from({ length: 4 }, (_, i) => writeFile(path.join(root, `chart-${i}.png`), png)),
    writeFile(
      path.join(root, '.yaseendraw', 'properties.json'),
      '{"version":1,"properties":{"status":{"kind":"text"},"priority":{"kind":"number"}}}',
    ),
    writeFile(path.join(root, '.trash', 'Untitled.md'), 'trash'),
  ])

  console.log(`generated vault: ${root}`)
  console.log(`  notes: ${NOTES}, folders: ${folders.length - 1}, ~${(bytes / 1024 / 1024).toFixed(1)} MB of markdown, seed: ${SEED}`)
  console.log(
    `  folder pages: ${pages.length} (${HOME_PAGE} + ${topicPages.length}), belonging: ${belonging}, uncategorized: ${NOTES - belonging}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
