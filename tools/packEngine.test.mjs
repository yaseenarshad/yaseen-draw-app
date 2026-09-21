import { describe, expect, it } from 'vitest'
import {
  ENGINE_PACKAGES,
  buildEngineMap,
  findStaleTarballRefs,
  nameFromPackagesKey,
  packedName,
  parseArgs,
  parseTarballName,
  rewriteClientPackageJson,
  rewriteLockfile,
  selectPrebuilt,
  significantStatusLines,
  tarballName,
} from './lib/packEngine.mjs'

const OLD = '9e63bdf2'
const NEW = 'e72242f8'

const entries = [
  { pkg: 'excalidraw', version: '0.18.0', hash: NEW, integrity: 'sha512-EXC' },
  { pkg: 'common', version: '0.18.0', hash: NEW, integrity: 'sha512-COM' },
  { pkg: 'element', version: '0.18.0', hash: NEW, integrity: 'sha512-ELE' },
  { pkg: 'math', version: '0.18.0', hash: NEW, integrity: 'sha512-MAT' },
  { pkg: 'fractional-indexing', version: '3.3.0', hash: NEW, integrity: 'sha512-FRA' },
]

describe('names', () => {
  it('stamps the fork hash into the tarball name', () => {
    expect(tarballName('excalidraw', '0.18.0', NEW)).toBe('yaseendraw-excalidraw-0.18.0-e72242f8.tgz')
    expect(tarballName('fractional-indexing', '3.3.0', NEW)).toBe('yaseendraw-fractional-indexing-3.3.0-e72242f8.tgz')
  })

  it('knows what npm pack calls the file before the rename', () => {
    expect(packedName('common', '0.18.0')).toBe('excalidraw-common-0.18.0.tgz')
  })

  it('round-trips every engine package, hyphenated names included', () => {
    for (const pkg of ENGINE_PACKAGES) {
      expect(parseTarballName(tarballName(pkg, '1.2.3', NEW))).toEqual({ pkg, version: '1.2.3', hash: NEW })
    }
  })

  it('ignores tarballs that are not ours', () => {
    expect(parseTarballName('milkdown-components-7.22.1-yaz1410.tgz')).toBeNull()
    expect(parseTarballName('yaseendraw-utils-0.1.0-e72242f8.tgz')).toBeNull()
    expect(parseTarballName('README.md')).toBeNull()
  })

  it('spells the two relative paths npm uses', () => {
    const map = buildEngineMap(entries)
    expect(map['@excalidraw/common'].clientSpec).toBe('file:vendor/yaseendraw-common-0.18.0-e72242f8.tgz')
    expect(map['@excalidraw/common'].lockResolved).toBe('file:client/vendor/yaseendraw-common-0.18.0-e72242f8.tgz')
  })
})

describe('rewriteClientPackageJson', () => {
  it('repoints all five file: deps and leaves the rest alone', () => {
    const pkg = {
      dependencies: {
        '@excalidraw/common': `file:vendor/yaseendraw-common-0.18.0-${OLD}.tgz`,
        '@excalidraw/element': `file:vendor/yaseendraw-element-0.18.0-${OLD}.tgz`,
        '@excalidraw/excalidraw': `file:vendor/yaseendraw-excalidraw-0.18.0-${OLD}.tgz`,
        '@excalidraw/fractional-indexing': `file:vendor/yaseendraw-fractional-indexing-3.3.0-${OLD}.tgz`,
        '@excalidraw/math': `file:vendor/yaseendraw-math-0.18.0-${OLD}.tgz`,
        react: '^19.2.8',
      },
    }
    rewriteClientPackageJson(pkg, buildEngineMap(entries))
    expect(Object.values(pkg.dependencies).filter((v) => v.includes(OLD))).toEqual([])
    expect(pkg.dependencies['@excalidraw/math']).toBe('file:vendor/yaseendraw-math-0.18.0-e72242f8.tgz')
    expect(pkg.dependencies.react).toBe('^19.2.8')
  })

  it('refuses to silently skip a dependency that is not there', () => {
    expect(() => rewriteClientPackageJson({ dependencies: {} }, buildEngineMap(entries))).toThrow(
      /@excalidraw\/\w+/,
    )
  })
})

describe('rewriteLockfile', () => {
  const lockV3 = () => ({
    lockfileVersion: 3,
    packages: {
      '': { name: 'yaseen-draw' },
      client: {
        dependencies: {
          '@excalidraw/common': `file:vendor/yaseendraw-common-0.18.0-${OLD}.tgz`,
          '@excalidraw/element': `file:vendor/yaseendraw-element-0.18.0-${OLD}.tgz`,
          '@excalidraw/excalidraw': `file:vendor/yaseendraw-excalidraw-0.18.0-${OLD}.tgz`,
          '@excalidraw/fractional-indexing': `file:vendor/yaseendraw-fractional-indexing-3.3.0-${OLD}.tgz`,
          '@excalidraw/math': `file:vendor/yaseendraw-math-0.18.0-${OLD}.tgz`,
          react: '^19.2.8',
        },
      },
      'node_modules/@excalidraw/common': {
        version: '0.18.0',
        resolved: `file:client/vendor/yaseendraw-common-0.18.0-${OLD}.tgz`,
        integrity: 'sha512-STALE',
      },
      'node_modules/@excalidraw/element': {
        version: '0.18.0',
        resolved: `file:client/vendor/yaseendraw-element-0.18.0-${OLD}.tgz`,
        integrity: 'sha512-STALE',
        // Sibling specs are plain versions, not file: — they must not be touched.
        dependencies: { '@excalidraw/common': '0.18.0' },
      },
      'node_modules/@excalidraw/excalidraw': {
        version: '0.18.0',
        resolved: `file:client/vendor/yaseendraw-excalidraw-0.18.0-${OLD}.tgz`,
        integrity: 'sha512-STALE',
      },
      'node_modules/@excalidraw/fractional-indexing': {
        version: '3.3.0',
        resolved: `file:client/vendor/yaseendraw-fractional-indexing-3.3.0-${OLD}.tgz`,
        integrity: 'sha512-STALE',
      },
      'node_modules/@excalidraw/math': {
        version: '0.18.0',
        resolved: `file:client/vendor/yaseendraw-math-0.18.0-${OLD}.tgz`,
        integrity: 'sha512-STALE',
      },
      // Untouched by the fork: resolves from the registry and must stay there.
      'node_modules/@excalidraw/laser-pointer': {
        version: '1.3.1',
        resolved: 'https://registry.npmjs.org/@excalidraw/laser-pointer/-/laser-pointer-1.3.1.tgz',
        integrity: 'sha512-LASER',
      },
    },
  })

  it('rewrites resolved, integrity and the client specs, and nothing else', () => {
    const lock = lockV3()
    rewriteLockfile(lock, buildEngineMap(entries))
    expect(findStaleTarballRefs(JSON.stringify(lock), NEW)).toEqual([])
    expect(lock.packages['node_modules/@excalidraw/math'].resolved).toBe(
      'file:client/vendor/yaseendraw-math-0.18.0-e72242f8.tgz',
    )
    expect(lock.packages['node_modules/@excalidraw/math'].integrity).toBe('sha512-MAT')
    expect(lock.packages['node_modules/@excalidraw/element'].dependencies['@excalidraw/common']).toBe('0.18.0')
    expect(lock.packages['node_modules/@excalidraw/laser-pointer'].resolved).toBe(
      'https://registry.npmjs.org/@excalidraw/laser-pointer/-/laser-pointer-1.3.1.tgz',
    )
    expect(lock.packages.client.dependencies.react).toBe('^19.2.8')
  })

  it('counts two edits per package — the spec and the resolved entry', () => {
    const edits = rewriteLockfile(lockV3(), buildEngineMap(entries))
    expect(edits).toEqual({
      '@excalidraw/excalidraw': 2,
      '@excalidraw/common': 2,
      '@excalidraw/element': 2,
      '@excalidraw/math': 2,
      '@excalidraw/fractional-indexing': 2,
    })
  })

  it('rewrites a byte-identical package too — the trap that breaks npm ci', () => {
    // fractional-indexing packs identically across commits, so npm leaves its `resolved`
    // pointing at a tarball the bump deletes. Rewriting must not depend on content changing.
    const lock = lockV3()
    rewriteLockfile(lock, buildEngineMap(entries))
    expect(lock.packages['node_modules/@excalidraw/fractional-indexing'].resolved).toContain(NEW)
    expect(lock.packages['node_modules/@excalidraw/fractional-indexing'].resolved).not.toContain(OLD)
  })

  it('also walks the legacy dependencies tree of a v1/v2 lockfile', () => {
    const lock = {
      lockfileVersion: 2,
      packages: {},
      dependencies: {
        '@excalidraw/math': {
          version: '0.18.0',
          resolved: `file:client/vendor/yaseendraw-math-0.18.0-${OLD}.tgz`,
          integrity: 'sha512-STALE',
          requires: { '@excalidraw/common': `file:vendor/yaseendraw-common-0.18.0-${OLD}.tgz` },
          dependencies: {
            '@excalidraw/common': {
              version: '0.18.0',
              resolved: `file:client/vendor/yaseendraw-common-0.18.0-${OLD}.tgz`,
              integrity: 'sha512-STALE',
            },
          },
        },
      },
    }
    rewriteLockfile(lock, buildEngineMap(entries))
    expect(findStaleTarballRefs(JSON.stringify(lock), NEW)).toEqual([])
    expect(lock.dependencies['@excalidraw/math'].integrity).toBe('sha512-MAT')
    expect(lock.dependencies['@excalidraw/math'].dependencies['@excalidraw/common'].integrity).toBe('sha512-COM')
  })

  it('reports zero edits for a package the lockfile never mentions', () => {
    const edits = rewriteLockfile({ packages: {} }, buildEngineMap(entries))
    expect(edits['@excalidraw/common']).toBe(0)
  })
})

describe('findStaleTarballRefs', () => {
  it('finds an old hash anywhere in the text', () => {
    const text = `"file:client/vendor/yaseendraw-fractional-indexing-3.3.0-${OLD}.tgz"`
    expect(findStaleTarballRefs(text, NEW)).toEqual([`yaseendraw-fractional-indexing-3.3.0-${OLD}.tgz`])
  })

  it('dedupes and ignores the current hash and foreign tarballs', () => {
    const text = [
      `yaseendraw-math-0.18.0-${OLD}.tgz`,
      `yaseendraw-math-0.18.0-${OLD}.tgz`,
      `yaseendraw-common-0.18.0-${NEW}.tgz`,
      'milkdown-components-7.22.1-yaz1410.tgz',
    ].join(' ')
    expect(findStaleTarballRefs(text, NEW)).toEqual([`yaseendraw-math-0.18.0-${OLD}.tgz`])
  })
})

describe('nameFromPackagesKey', () => {
  it('reads the package name out of a lockfile path, nesting included', () => {
    expect(nameFromPackagesKey('node_modules/@excalidraw/common')).toBe('@excalidraw/common')
    expect(nameFromPackagesKey('node_modules/a/node_modules/@excalidraw/math')).toBe('@excalidraw/math')
    expect(nameFromPackagesKey('client')).toBeNull()
  })
})

describe('selectPrebuilt', () => {
  const names = [
    `yaseendraw-common-0.18.0-${NEW}.tgz`,
    `yaseendraw-math-0.18.0-${OLD}.tgz`,
    'milkdown-components-7.22.1-yaz1410.tgz',
  ]

  it('takes the tarball whose name carries the commit', () => {
    expect(selectPrebuilt(names, 'common', NEW)).toEqual({
      pkg: 'common',
      version: '0.18.0',
      hash: NEW,
      name: `yaseendraw-common-0.18.0-${NEW}.tgz`,
    })
  })

  it('refuses a tarball built from a different commit', () => {
    expect(() => selectPrebuilt(names, 'math', NEW)).toThrow(/no prebuilt tarball for "math"/)
  })

  it('refuses when the package is absent entirely', () => {
    expect(() => selectPrebuilt(names, 'element', NEW)).toThrow(/found: none/)
  })
})

describe('significantStatusLines', () => {
  it('ignores worktree directories but nothing else', () => {
    const porcelain = [
      ' M .worktrees/foo/package.json',
      '?? .claude/worktrees/bar',
      ' M yarn.lock',
      '',
    ].join('\n')
    expect(significantStatusLines(porcelain)).toEqual([' M yarn.lock'])
  })

  it('treats a clean tree as clean', () => {
    expect(significantStatusLines('')).toEqual([])
    expect(significantStatusLines('\n\n')).toEqual([])
  })
})

describe('parseArgs', () => {
  it('parses the three flags', () => {
    expect(parseArgs(['--fork', '/f', '--commit', NEW, '--use', '/d'])).toEqual({
      fork: '/f',
      commit: NEW,
      use: '/d',
    })
  })

  it('defaults everything to null', () => {
    expect(parseArgs([])).toEqual({ fork: null, commit: null, use: null })
  })

  it('rejects typos and missing values rather than packing the wrong commit', () => {
    expect(() => parseArgs(['--comit', NEW])).toThrow(/unknown argument/)
    expect(() => parseArgs(['--commit'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--commit', '--fork'])).toThrow(/needs a value/)
  })
})
