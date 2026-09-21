/**
 * `imageSrc` (YAZ-1656): the src as written → the URL the `<img>` loads. Pinned: schemed srcs pass
 * through untouched, a leading `/` is root-relative, the vault URL's shape and encoding (spaces,
 * unicode, `?`/`#` inside a path segment, the note's directory in `from`), and the `alt|width`
 * pair's round trips.
 */
import { describe, expect, it } from 'vitest'
import { formatAlt, hasScheme, imageSrc, noteDirRel, parseAlt } from './imageSrc'

const ROOT = '/Users/me/My Vault'
const ENC_ROOT = encodeURIComponent(ROOT)

describe('imageSrc', () => {
  it('passes any schemed src through untouched', () => {
    for (const src of ['https://x/y.png', 'http://x/y.png', 'data:image/png;base64,AAAA', 'blob:app://x/uuid', 'app://fs/foreign.png', 'file:///tmp/a.png', 'HTTPS://X/Y.PNG']) {
      expect(imageSrc(ROOT, 'notes', src)).toBe(src)
      expect(hasScheme(src)).toBe(true)
    }
  })

  it('a relative src becomes the vault URL with the note directory as `from`', () => {
    expect(imageSrc(ROOT, 'notes/sub', 'images/a.png')).toBe(`app://vault/${ENC_ROOT}/images/a.png?from=notes%2Fsub`)
    expect(imageSrc(ROOT, '', 'a.png')).toBe(`app://vault/${ENC_ROOT}/a.png?from=`)
  })

  it('a leading slash is root-relative, not an OS path', () => {
    expect(imageSrc(ROOT, 'notes', '/assets/a.png')).toBe(`app://vault/${ENC_ROOT}/assets/a.png?from=notes`)
    expect(hasScheme('/assets/a.png')).toBe(false)
  })

  it('encodes each segment on its own: spaces, unicode, `?`, `#` survive and `/` stays a separator', () => {
    expect(imageSrc(ROOT, '', 'Pasted image 1.png')).toBe(`app://vault/${ENC_ROOT}/Pasted%20image%201.png?from=`)
    expect(imageSrc(ROOT, '', 'img/日本語.png')).toBe(`app://vault/${ENC_ROOT}/img/%E6%97%A5%E6%9C%AC%E8%AA%9E.png?from=`)
    expect(imageSrc(ROOT, '', 'a?b#c.png')).toBe(`app://vault/${ENC_ROOT}/a%3Fb%23c.png?from=`)
    expect(imageSrc(ROOT, 'dir with space/ünï', 'a.png')).toBe(`app://vault/${ENC_ROOT}/a.png?from=dir%20with%20space%2F%C3%BCn%C3%AF`)
  })

  it('decodes a percent-encoded src once, so `%20` written by Obsidian/CommonMark is never double-encoded', () => {
    expect(imageSrc(ROOT, '', 'images/case%20a.png')).toBe(imageSrc(ROOT, '', 'images/case a.png'))
    expect(imageSrc(ROOT, '', 'images/case%20a.png')).toBe(`app://vault/${ENC_ROOT}/images/case%20a.png?from=`)
    // A malformed escape is kept verbatim (encoded) instead of throwing.
    expect(imageSrc(ROOT, '', '100%.png')).toBe(`app://vault/${ENC_ROOT}/100%25.png?from=`)
  })

  it('a Windows-style drive letter is NOT a scheme we care about, but the regex says it is — documented', () => {
    // `c:` matches RFC 3986's scheme grammar; the app is mac-only so this never comes up in a vault.
    expect(hasScheme('c:/x.png')).toBe(true)
  })
})

describe('noteDirRel', () => {
  it('is the root-relative directory of the note, posix, empty at the root', () => {
    expect(noteDirRel(ROOT, `${ROOT}/a.md`)).toBe('')
    expect(noteDirRel(ROOT, `${ROOT}/notes/a.md`)).toBe('notes')
    expect(noteDirRel(ROOT, `${ROOT}/notes/sub dir/a.md`)).toBe('notes/sub dir')
    expect(noteDirRel(`${ROOT}/`, `${ROOT}/notes/a.md`)).toBe('notes')
  })
  it('is empty for a note outside the root (never a `..`)', () => {
    expect(noteDirRel(ROOT, '/elsewhere/notes/a.md')).toBe('')
    expect(noteDirRel(ROOT, `${ROOT}2/a.md`)).toBe('')
  })
})

describe('parseAlt / formatAlt', () => {
  it.each([
    ['x|400', 'x', 400],
    ['|400', '', 400],
    ['x', 'x', null],
    ['a|b', 'a|b', null],
    ['', '', null],
    ['a|b|300', 'a|b', 300],
    ['x|40 ', 'x|40 ', null],
  ] as const)('%j → text %j width %j, and back', (alt, text, width) => {
    expect(parseAlt(alt)).toEqual({ text, width })
    expect(formatAlt(text, width)).toBe(alt)
  })
})
