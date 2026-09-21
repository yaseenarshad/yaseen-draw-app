import { describe, expect, it } from 'vitest'
import { fileLink, parseFileLink } from '@shared/links'

// Deep links (E1, GRO-2171; format locked in D7): `yaseendraw://` + percent-encoded absolute
// path, e.g. `yaseendraw:///Users/me/vault/My%20note.md`. Optional `?root=` override.

describe('fileLink', () => {
  it('builds the D7 shape: yaseendraw:// + encoded absolute path (three slashes)', () => {
    expect(fileLink('/Users/me/vault/My note.md')).toBe('yaseendraw:///Users/me/vault/My%20note.md')
  })

  it('percent-encodes # and ? too (encodeURI alone would leave them and truncate the path)', () => {
    expect(fileLink('/v/a#1.md')).toBe('yaseendraw:///v/a%231.md')
    expect(fileLink('/v/what?.md')).toBe('yaseendraw:///v/what%3F.md')
  })
})

describe('parseFileLink round-trips fileLink', () => {
  const roundTrip = (path: string) => parseFileLink(fileLink(path))
  it.each([
    ['spaces', '/Users/me/vault/My note.md'],
    ['unicode', '/v/émojis 🎉.md'],
    ['hash', '/v/notes#drafts/a#1.md'],
    ['question mark', '/v/really?.md'],
    ['percent', '/v/100% done.md'],
    ['ampersand and equals', '/v/a&b=c.md'],
  ])('%s: %s', (_name, path) => {
    expect(roundTrip(path)).toEqual({ path, root: null })
  })
})

describe('parseFileLink', () => {
  it('extracts an optional percent-encoded ?root= override', () => {
    expect(parseFileLink('yaseendraw:///v/sub/a.md?root=%2FUsers%2Fme%2Fv')).toEqual({ path: '/v/sub/a.md', root: '/Users/me/v' })
    expect(parseFileLink('yaseendraw:///v/My%20note.md?root=/my%20vault')).toEqual({ path: '/v/My note.md', root: '/my vault' })
  })

  it('ignores query params other than root', () => {
    expect(parseFileLink('yaseendraw:///v/a.md?x=1')).toEqual({ path: '/v/a.md', root: null })
  })

  it('rejects any other scheme', () => {
    expect(parseFileLink('https:///v/a.md')).toBeNull()
    expect(parseFileLink('file:///v/a.md')).toBeNull()
    expect(parseFileLink('yaseendrawx:///v/a.md')).toBeNull()
    expect(parseFileLink('/v/a.md')).toBeNull()
  })

  it('rejects a relative or empty path', () => {
    expect(parseFileLink('yaseendraw://')).toBeNull()
    expect(parseFileLink('yaseendraw:///')).toEqual({ path: '/', root: null }) // absolute but silly; routeToFile rejects it
    expect(parseFileLink('yaseendraw://rel/a.md')).toBeNull()
  })

  it('treats the double-slash form (no third slash) as malformed, never as a host', () => {
    expect(parseFileLink('yaseendraw://Users/me/vault/a.md')).toBeNull()
  })

  it('rejects malformed percent-encoding instead of throwing', () => {
    expect(parseFileLink('yaseendraw:///v/bad%GG.md')).toBeNull()
    expect(parseFileLink('yaseendraw:///v/a.md?root=%')).toBeNull()
  })

  it('ignores a non-absolute root override', () => {
    expect(parseFileLink('yaseendraw:///v/a.md?root=rel')).toEqual({ path: '/v/a.md', root: null })
    expect(parseFileLink('yaseendraw:///v/a.md?root=')).toEqual({ path: '/v/a.md', root: null })
  })
})
