#!/usr/bin/env node
/**
 * YAZ-1471 demo vault — the 13 edge-case folder pages Yasin stress-tested the editable view tabs
 * on (drag / right-click Rename · Duplicate · Delete / "+" / no-scrollbar strips), plus an ISOLATED
 * app profile seeded to open straight into it. Reference, not app code: the scenario list lives on
 * Linear YAZ-1487 and the closeout handoff on YAZ-1471.
 *
 *   node tools/prototypes/yaz-1471-demo-vault.mjs            # writes /tmp/yaz-1471-demo/{vault,profile}
 *   cd .claude/worktrees/<branch>   # or the main checkout
 *   YASEEN_DRAW_USER_DATA_DIR=/tmp/yaz-1471-demo/profile npm run dev -w desktop
 *
 * The profile is separate from the installed app's, so both run side by side (the single-instance
 * lock is per profile). Delete /tmp/yaz-1471-demo when done.
 */
import fs from 'node:fs'
import path from 'node:path'
const ROOT = '/tmp/yaz-1471-demo'
const V = path.join(ROOT, 'vault')
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(V, { recursive: true })
const w = (rel, text) => { const p = path.join(V, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text) }

const COLS = `  columns:
    status:
      kind: text
    owner:
      kind: text
    due:
      kind: text
`
const V3 = `  views:
    - type: outline
      name: Outline
    - type: table
      name: Table
      order: [file.name, note.status, note.owner, note.due]
    - type: board
      name: Board
      groupBy:
        - property: note.status
`
/** A folder page: `settings` is the YAML under folder_page_settings (already indented 2), or null for no key at all. */
const fp = (name, settings, blurb) =>
  w(`${name}.md`, `---\nfolder_page: true\n${settings === null ? '' : `folder_page_settings:\n${settings}`}---\n\n# ${name}\n\n${blurb}\n`)
const STATUS = ['open', 'done', 'blocked']
const OWNER = ['Ada', 'Grace', 'Linus']
let n = 0
const members = (dir, folders, count) => {
  for (let i = 0; i < count; i++) {
    n++
    const name = `${folders[0].replace(/^\d+ /, '').split(' ')[0]} task ${i + 1}`
    const props = { status: STATUS[n % 3], owner: OWNER[n % 3], due: `2026-09-${String(12 + (n % 15)).padStart(2, '0')}` }
    w(`${dir}/${name}.md`, `---\nfolder_pages: [${folders.map((f) => `"[[${f}]]"`).join(', ')}]\n${Object.entries(props).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n# ${name}\n\nDemo member of ${folders.join(' and ')}.\n`)
  }
}

fp('01 Basic three views', COLS + V3, 'The normal case: Outline, Table, Board. Drag, rename, duplicate, delete, add.')
members('members', ['01 Basic three views'], 4)

fp('02 Only one view', COLS + `  views:\n    - type: table\n      name: Table\n      order: [file.name, note.status]\n`, 'One view. Delete must be greyed out. "+" still works.')
members('members', ['02 Only one view'], 2)

fp('03 No Board on card', COLS + `  views:\n    - type: outline\n      name: Outline\n    - type: table\n      name: Table\n`, 'A card saved before Board existed. With the backfill retired (D3) no Board appears until you add one.')
members('members', ['03 No Board on card'], 2)

fp('04 Outline with document', COLS + `  views:
    - type: outline
      name: Outline
      outline: |-
        - Kickoff notes for this demo page
        - [[Outline task 1]]
            - a sub-point that only lives in the outline document
        - [[Outline task 2]]
        - closing thought
    - type: table
      name: Table
`, 'The Outline view carries a written document. Deleting it must say so, and Duplicate must be greyed.')
members('members', ['04 Outline with document'], 3)

fp('05 Default view Board', COLS + `  defaultView: Board\n` + V3, 'Opens on Board (defaultView). Rename Board → still opens on it. Delete Board → opens on the first view, key gone.')
members('members', ['05 Default view Board'], 3)

fp('06 Duplicate names', COLS + `  views:
    - type: table
      name: Table
      order: [file.name, note.status]
    - type: table
      name: Table
      order: [file.name, note.owner]
    - type: board
      name: Board
      groupBy:
        - property: note.status
`, 'Two views both hand-named "Table". Rename one to "Board" → rejected, snaps back. Rename it to "Owners" → fine.')
members('members', ['06 Duplicate names'], 2)

fp('07 Many views', COLS + `  views:
    - type: outline
      name: Outline
    - type: table
      name: Table
    - type: board
      name: Board
      groupBy:
        - property: note.status
    - type: cards
      name: Cards
    - type: list
      name: List
    - type: table
      name: Table 2
    - type: table
      name: Table 3
    - type: table
      name: Table 4
    - type: table
      name: A very long view name that goes on and on
    - type: table
      name: Last
`, 'Ten views: the strip scrolls. Drag to the very end, drag from the end to the front, "+" past the overflow.')
members('members', ['07 Many views'], 3)

fp('08 No settings key', null, 'No folder_page_settings at all → the three defaults. The first view gesture writes the key for the first time.')
members('members', ['08 No settings key'], 2)

fp('09 Broken view entry', COLS + `  views:
    - type: table
      name: Table
    - type: table
    - name: No type here
    - type: board
      name: Board
`, 'Two unusable entries (no name / no type). They are skipped with a note line; the rest still work. What does a write do to them?')
members('members', ['09 Broken view entry'], 2)

fp('10 Unknown view type', COLS + `  views:
    - type: table
      name: Table
    - type: map
      name: Map
    - type: board
      name: Board
`, 'A "map" view: placeholder rows, fallback glyph. Delete, rename, drag it like any other.')
members('members', ['10 Unknown view type'], 2)

fp('11 Configured table', COLS + `  views:
    - type: table
      name: Open work
      order: [file.name, note.status, note.owner, note.due]
      sort:
        - property: note.due
          direction: ASC
      groupBy:
        - property: note.owner
      filters: 'status != "done"'
      columnSize:
        file.name: 220
      preview: true
    - type: board
      name: By status
      groupBy:
        - property: note.status
      cardStyle:
        owner:
          bold: true
    - type: cards
      name: Cards
    - type: list
      name: List
`, 'Heavily configured views. Duplicate must clone sort/group/filter/widths. Delete copy names what goes.')
members('members', ['11 Configured table'], 5)

fp('12 Formulas folder columns', COLS + `  folder: twelve
  defaultView: Table
  formulas:
    late: 'if(status == "done", "no", "yes")'
  views:
    - type: outline
      name: Outline
    - type: table
      name: Table
      order: [file.name, note.status, formula.late]
    - type: board
      name: Board
      groupBy:
        - property: note.status
`, 'folder, formulas, columns and defaultView all on the card. After any view gesture, open the card: they must all still be there, untouched.')
members('twelve', ['12 Formulas folder columns'], 2)

fp('13 Empty folder page', COLS + V3, 'No members. Everything should still work on an empty body.')

w('_SCENARIOS.md', `# YAZ-1471 stress test

Folder pages are numbered. Each one is one situation. Open the card (properties panel) after a gesture to see the YAML it wrote.
`)
// The isolated profile: one window on the vault, landing on page 01, 21 tabs so the window tab
// strip overflows too (D6). Schema: shared/types.ts AppState v1 (defaults copied, not imported —
// this tool must run without a build).
const P = path.join(ROOT, 'profile')
fs.mkdirSync(P, { recursive: true })
const pages = fs.readdirSync(V).filter((f) => f.endsWith('.md') && f !== '_SCENARIOS.md').sort().map((f) => path.join(V, f))
const first8 = fs.readdirSync(path.join(V, 'members')).sort().slice(0, 8).map((f) => path.join(V, 'members', f))
const file = path.join(V, '01 Basic three views.md')
const state = {
  version: 1,
  settings: { lineSpacing: 1.5, blockGap: 4, bulletThreading: true, threadWidth: 2, threadColor: null, theme: 'system', contentWidth: 'narrow', newNoteLocation: 'root', newNoteFolder: '', confirmDelete: true },
  sidebarWidth: 260,
  sidebarLens: 'topics',
  recents: [{ path: V, lastOpened: Date.now() }],
  windows: [{ id: 'w1', root: V, file, tabs: [...pages, ...first8], rightPanel: { open: false, width: 440, items: [], expanded: null }, sidebarCollapsed: false, bounds: { x: 80, y: 60, width: 1200, height: 800 } }],
  folders: { [V]: { expanded: [], lastFile: file, folds: {}, baseGroups: {}, topicsExpanded: [] } },
}
fs.writeFileSync(path.join(P, 'yaseendraw.json'), JSON.stringify(state, null, 2))
console.log(`vault: ${V} (${fs.readdirSync(V).length} root entries, ${n} members) · profile: ${P}`)
console.log(`launch: YASEEN_DRAW_USER_DATA_DIR=${P} npm run dev -w desktop`)
