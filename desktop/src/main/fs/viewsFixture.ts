import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Temp vault mirroring a real Obsidian vault (synthetic content), shared by every view/index
 * test: 8 markdown notes (one with invalid frontmatter, two with none), png stubs, a `.trash`
 * note, and the two dotfolders that must stay invisible to tree/index/watcher — `.obsidian`
 * (a foreign app's, now EMPTY: ⚡ YAZ-815 deleted the `types.json` it used to carry along with
 * every read of it) and `.yaseendocs` (ours). Caller removes it via `cleanup`.
 *
 * Named `basesFixture` / `makeBasesFixture` until YAZ-861 renamed it for the surface it actually
 * feeds — the folder-page views and the vault index — rather than the retired `.base` format.
 */
export async function makeViewsFixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'mdapp-views-'))
  const pillars = path.join(root, 'Content Pillars')
  const agentic = path.join(pillars, '1. Agentic Agency')
  const creator = path.join(pillars, '2. Creator Economy')
  const trust = path.join(pillars, '3. Trust Economy & Paid Ads')
  const tech = path.join(pillars, '4. Tech & Silicon Valley')
  await Promise.all(
    [agentic, creator, trust, tech, path.join(root, '.obsidian'), path.join(root, '.yaseendocs'), path.join(root, '.trash')].map((d) =>
      mkdir(d, { recursive: true }),
    ),
  )
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await Promise.all([
    writeFile(path.join(pillars, 'List of Topics.md'), 'Pillars #pillars\n\n* [[Agentic Agency]]\n* [[Creator Economy]]\n'),
    writeFile(
      path.join(agentic, 'Agentic Agency.md'),
      '---\npillar: Agentic Agency\nstatus: idea\npriority: 2\ntags: [agentic, pillar]\npublished: false\ndate: 2026-08-01\n---\n\nWhat an agentic agency is and why it wins.\n',
    ),
    writeFile(
      path.join(agentic, 'The Levels of an Agency.md'),
      '---\npillar: Agentic Agency\nstatus: drafting\npriority: 1\ntags: [agentic/levels]\ncover: "[[levels.png]]"\nrelated: "[[Agentic Agency]]"\n---\n\nFrom freelancer to agentic agency, level by level.\n',
    ),
    writeFile(
      path.join(creator, 'Creator Economy.md'),
      '---\npillar: Creator Economy\nstatus: published\npriority: 3\npublished: true\ndate: 2026-07-15\nviews: 12000\n---\n\nThe creator economy pillar.\n',
    ),
    writeFile(
      path.join(creator, 'The Gold In Your Archive.md'),
      '---\npillar: Creator Economy\nstatus: idea\ntags: creator\n---\n\nYour archive is an asset.\n',
    ),
    writeFile(
      path.join(trust, 'Attribution.md'),
      'Attribution is hard.\n\n```\n#ads is not a tag inside a code block\n```\n\nReal tag: #attribution\n\n![[chart.png]]\n',
    ),
    writeFile(path.join(tech, 'Tech & Silicon Valley.md'), '---\nstatus: [unclosed\n---\nBody after broken frontmatter.\n'),
    writeFile(path.join(pillars, 'levels.png'), png),
    writeFile(path.join(pillars, 'chart.png'), png),
    writeFile(path.join(root, 'VSL-v1.md'), '---\nstatus: published\npillar: null\n---\n\nVideo sales letter, version one.\n'),
    writeFile(path.join(root, '.trash', 'Untitled.md'), 'trash'),
  ])
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}
