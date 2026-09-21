/**
 * The folder-page body migration (YAZ-919): a folder page is title → outline now, and its body
 * editor is hidden, so any body text a page already carries has to MOVE — once — into the top of
 * its outline document. Each case pins a locked rule: only a flagged page migrates, an empty body
 * is nothing to move, the body's own bullets keep their nesting (`outlineDoc`'s parse is the only
 * reader of that grammar), prose becomes depth-0 text, blank lines drop, and the second run is a
 * no-op — the body is gone, so nothing can migrate twice. Pure: content in, content out.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { migrateFolderBody, restoreFolderBody } from './migrateFolderBody'

/** The migrated outline of the FIRST outline view, read back the way every surface reads it. */
const outlineOf = (content: string): string => {
  const { properties } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  const settings = properties.folder_page_settings as { views: { type: string; outline?: string }[] }
  return settings.views.find((v) => v.type === 'outline')?.outline ?? ''
}

const bodyOf = (content: string): string => splitFrontmatter(content).body

/** A folder page whose outline view already holds `outline`, plus whatever body text. */
const page = (outline: string | null, body: string): string =>
  [
    '---',
    'title: Growth',
    'folder_page: true',
    'folder_page_settings:',
    '  columns:',
    '    stage:',
    '      kind: text',
    '  views:',
    '    - type: outline',
    '      name: Outline',
    ...(outline === null ? [] : ['      outline: |-', ...outline.split('\n').map((l) => `        ${l}`)]),
    '    - type: table',
    '      name: Table',
    '---',
    body,
  ].join('\n')

describe('migrateFolderBody: who migrates at all', () => {
  it('leaves an ordinary note alone — no flag, no migration', () => {
    const note = '---\ntitle: Just a note\n---\nSome text.\n'
    expect(migrateFolderBody(note)).toEqual({ content: note, changed: false })
  })

  it('leaves a file with no frontmatter at all alone', () => {
    const note = 'Just a body.\n'
    expect(migrateFolderBody(note)).toEqual({ content: note, changed: false })
  })

  it('takes the flag strictly: `folder_page: "true"` is not a folder page', () => {
    const note = '---\nfolder_page: "true"\n---\nSome text.\n'
    expect(migrateFolderBody(note).changed).toBe(false)
  })

  it('leaves a flagged page whose body is empty', () => {
    const empty = page('- [[CAC]]', '')
    expect(migrateFolderBody(empty)).toEqual({ content: empty, changed: false })
  })

  it('leaves a flagged page whose body is only whitespace', () => {
    const blank = page('- [[CAC]]', '\n   \n\t\n')
    expect(migrateFolderBody(blank)).toEqual({ content: blank, changed: false })
  })

  it('leaves a flagged page whose views declare no outline view — conservative, nothing to prepend to', () => {
    const tableOnly = [
      '---',
      'folder_page: true',
      'folder_page_settings:',
      '  views:',
      '    - type: table',
      '      name: Table',
      '---',
      'Body text.\n',
    ].join('\n')
    expect(migrateFolderBody(tableOnly)).toEqual({ content: tableOnly, changed: false })
  })

  it('leaves a page whose settings key is not a map — that is the user\'s text, not ours to rewrite', () => {
    const odd = '---\nfolder_page: true\nfolder_page_settings: nonsense\n---\nBody text.\n'
    expect(migrateFolderBody(odd)).toEqual({ content: odd, changed: false })
  })

  it('migrates a flagged page with NO settings key: its views are the outline-first defaults', () => {
    const bare = '---\nfolder_page: true\n---\nOne line.\n'
    const out = migrateFolderBody(bare)
    expect(out.changed).toBe(true)
    expect(outlineOf(out.content)).toBe('- One line.')
    expect(bodyOf(out.content)).toBe('')
  })
})

describe('migrateFolderBody: the body becomes outline lines', () => {
  it('turns plain paragraphs into depth-0 bullets, ABOVE the existing outline', () => {
    const out = migrateFolderBody(page('- [[CAC]]\n- [[LTV]]', 'First thought.\nSecond thought.\n'))
    expect(out.changed).toBe(true)
    expect(outlineOf(out.content)).toBe('- First thought.\n- Second thought.\n- [[CAC]]\n- [[LTV]]')
  })

  it('keeps a body that is already a bullet list, nesting and all', () => {
    const out = migrateFolderBody(page('- [[CAC]]', '- a\n  - b\n\t\t- c\n- d\n'))
    expect(outlineOf(out.content)).toBe('- a\n    - b\n        - c\n- d\n- [[CAC]]')
  })

  it('mixes prose and bullets: prose lands at depth 0, the bullets keep their own levels', () => {
    const out = migrateFolderBody(page('- [[CAC]]', 'Intro line\n\n* a\n    * b\n\nOutro\n'))
    expect(outlineOf(out.content)).toBe('- Intro line\n- a\n    - b\n- Outro\n- [[CAC]]')
  })

  it('drops blank lines and strips a prose line\'s own indentation', () => {
    const out = migrateFolderBody(page('- [[CAC]]', '\n\nAlpha\n\n\n    Beta   \n\n'))
    expect(outlineOf(out.content)).toBe('- Alpha\n- Beta\n- [[CAC]]')
  })

  it('an outline view with no document yet gets one made of the body alone', () => {
    const out = migrateFolderBody(page(null, 'Only this.\n'))
    expect(outlineOf(out.content)).toBe('- Only this.')
  })

  it('empties the body and leaves the frontmatter block behind it', () => {
    const out = migrateFolderBody(page('- [[CAC]]', 'Something.\n'))
    expect(bodyOf(out.content)).toBe('')
    expect(out.content.endsWith('---\n')).toBe(true)
  })
})

describe('migrateFolderBody: what survives', () => {
  it('keeps every other frontmatter key and every other view', () => {
    const out = migrateFolderBody(page('- [[CAC]]', 'Something.\n'))
    const { properties } = parseFrontmatter(splitFrontmatter(out.content).frontmatter)
    expect(properties.title).toBe('Growth')
    expect(properties.folder_page).toBe(true)
    const settings = properties.folder_page_settings as { columns: unknown; views: { type: string; name: string }[] }
    expect(settings.columns).toEqual({ stage: { kind: 'text' } })
    expect(settings.views.map((v) => v.type)).toEqual(['outline', 'table'])
    expect(settings.views[1]).toEqual({ type: 'table', name: 'Table' })
  })

  it('touches no byte of a frontmatter key it does not own — comments and quoting included', () => {
    const note = [
      '---',
      '# a comment nobody may eat',
      "title: 'Growth'",
      'folder_page: true',
      'tags: [a, b]',
      'folder_page_settings:',
      '  views:',
      '    - type: outline',
      '      name: Outline',
      '---',
      'Body.\n',
    ].join('\n')
    const out = migrateFolderBody(note)
    expect(out.changed).toBe(true)
    const fm = splitFrontmatter(out.content).frontmatter
    expect(fm).toContain('# a comment nobody may eat')
    expect(fm).toContain("title: 'Growth'")
    expect(fm).toContain('tags: [a, b]')
  })
})

describe('migrateFolderBody: it happens ONCE', () => {
  it('a second run over migrated output changes nothing', () => {
    const once = migrateFolderBody(page('- [[CAC]]', 'Intro\n- a\n  - b\n'))
    expect(once.changed).toBe(true)
    const twice = migrateFolderBody(once.content)
    expect(twice).toEqual({ content: once.content, changed: false })
  })

  it('is deterministic: the same input migrates to the same bytes', () => {
    const input = page('- [[CAC]]', 'Intro\n- a\n')
    expect(migrateFolderBody(input).content).toBe(migrateFolderBody(input).content)
  })
})

describe('migrateFolderBody: heading markers cannot survive a bullets-only document (YAZ-919)', () => {
  it('strips the marker, keeps the words: a # Title line arrives as a plain bullet', () => {
    // The outline schema is bullets-only (🔒 F3): a heading INSIDE a list item is rejected and
    // renders as nothing — which the next commit would then erase from disk. The words matter,
    // the marker is body formatting the outline cannot hold.
    const out = migrateFolderBody(page('- [[CAC]]', '# Home\n\nThe root of the map.\n'))
    expect(outlineOf(out.content)).toBe('- Home\n- The root of the map.\n- [[CAC]]')
  })

  it('strips markers at every level, and inside body bullets too', () => {
    const out = migrateFolderBody(page('- [[CAC]]', '## Two\n- ### Three nested\n#### Four\n'))
    expect(outlineOf(out.content)).toBe('- Two\n- Three nested\n- Four\n- [[CAC]]')
  })

  it('a lone # with no text, and a #hashtag word, are NOT headings — they stay verbatim', () => {
    const out = migrateFolderBody(page('- [[CAC]]', '#tag stays\n'))
    expect(outlineOf(out.content)).toBe('- #tag stays\n- [[CAC]]')
  })
})

describe('restoreFolderBody: the outline becomes the normal page body (YAZ-1022)', () => {
  it('removes the flag and active outline while preserving every other setting', () => {
    const out = restoreFolderBody(page('- Growth plan\n    - [[CAC]]', ''))
    const { properties } = parseFrontmatter(splitFrontmatter(out.content).frontmatter)
    const settings = properties.folder_page_settings as { columns: unknown; views: { type: string; outline?: string }[] }

    expect(out.changed).toBe(true)
    expect(properties.folder_page).toBeUndefined()
    expect(bodyOf(out.content)).toBe('- Growth plan\n    - [[CAC]]\n')
    expect(settings.columns).toEqual({ stage: { kind: 'text' } })
    expect(settings.views.map((view) => view.type)).toEqual(['outline', 'table'])
    expect(settings.views[0].outline).toBeUndefined()
  })

  it('keeps an existing body first and separates the restored outline with one blank line', () => {
    const out = restoreFolderBody(page('- Outline note', 'Existing body.\n'))

    expect(bodyOf(out.content)).toBe('Existing body.\n\n- Outline note\n')
  })

  it('round-trips back into a folder page without duplicating the document', () => {
    const first = migrateFolderBody(page(null, '# Growth\n\nDetails.\n'))
    const restored = restoreFolderBody(first.content)
    const enabledAgain = setFrontmatterProperty(restored.content, 'folder_page', true)
    const second = migrateFolderBody(enabledAgain)

    expect(outlineOf(second.content)).toBe(outlineOf(first.content))
    expect(bodyOf(second.content)).toBe('')
  })

  it('refuses malformed owned settings instead of removing the flag around hidden content', () => {
    const malformed = '---\nfolder_page: true\nfolder_page_settings: not-a-map\n---\n'

    expect(() => restoreFolderBody(malformed)).toThrow('folder_page_settings is not a map')
  })
})

describe('restoreFolderBody: real AI Curriculum regression (YAZ-1034)', () => {
  it('restores the checked-in 123-line outline exactly and re-enables without duplication', () => {
    const fixture = readFileSync(
      resolve('desktop/e2e/fixtures/curriculum-vault/AI Curriculum.md'),
      'utf8',
    )
    const originalOutline = outlineOf(fixture)
    const before = parseFrontmatter(splitFrontmatter(fixture).frontmatter).properties

    expect(originalOutline.split('\n')).toHaveLength(123)

    const restored = restoreFolderBody(fixture)
    const after = parseFrontmatter(splitFrontmatter(restored.content).frontmatter).properties
    const afterSettings = after.folder_page_settings as { views: { type: string; name: string; outline?: string }[] }

    expect(restored.changed).toBe(true)
    expect(bodyOf(restored.content)).toBe(`${originalOutline}\n`)
    expect(after.folder_page).toBeUndefined()
    expect(after.folder_pages).toEqual(before.folder_pages)
    expect(afterSettings.views.map(({ type, name }) => ({ type, name }))).toEqual([
      { type: 'outline', name: 'Outline' },
      { type: 'table', name: 'Table' },
    ])
    expect(afterSettings.views[0].outline).toBeUndefined()

    const enabledAgain = setFrontmatterProperty(restored.content, 'folder_page', true)
    const migratedAgain = migrateFolderBody(enabledAgain)
    expect(outlineOf(migratedAgain.content)).toBe(originalOutline)
    expect(bodyOf(migratedAgain.content)).toBe('')
  })
})
