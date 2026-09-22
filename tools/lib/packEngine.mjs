/**
 * Pure helpers behind `tools/packEngine.mjs` — no filesystem, no git, no npm, so the fiddly
 * parts (tarball naming, the two shapes a lockfile records a `file:` dep in, and the
 * stale-hash assertion that catches the trap below) are unit-testable.
 *
 * The trap: npm keys `file:` dependencies on content integrity, not on the filename. A
 * package whose build is byte-identical across two fork commits keeps its old `resolved`
 * path in `package-lock.json` even after `client/package.json` moves on — and that path
 * points at a tarball the bump just deleted, so a clean `npm ci` dies. Every `resolved`
 * for the five engine packages therefore gets rewritten explicitly, and `findStaleTarballRefs`
 * fails the run if any reference to an older fork hash survives anywhere in the file.
 */

/** The five fork packages that ship as tarballs, in the order they are built and packed. */
export const ENGINE_PACKAGES = ['excalidraw', 'common', 'element', 'math', 'fractional-indexing']

/** npm scope the tarballs install under (`@excalidraw/common`, …). */
export const ENGINE_SCOPE = '@excalidraw'

const TARBALL_RE = /^yaseendraw-(.+)-([0-9][^-]*)-([0-9a-f]{7,40})\.tgz$/

/** `excalidraw` + `0.18.0` + `e72242f8` -> `yaseendraw-excalidraw-0.18.0-e72242f8.tgz`. */
export function tarballName(pkg, version, hash) {
  return `yaseendraw-${pkg}-${version}-${hash}.tgz`
}

/** What `npm pack` names the file inside the fork, before we rename it. */
export function packedName(pkg, version) {
  return `${ENGINE_SCOPE.slice(1)}-${pkg}-${version}.tgz`
}

/**
 * Inverse of `tarballName`. Returns `null` for anything that is not one of ours (the
 * unrelated tarball living in the same directory, for instance).
 */
export function parseTarballName(name) {
  const m = TARBALL_RE.exec(name)
  if (!m) return null
  const [, pkg, version, hash] = m
  return ENGINE_PACKAGES.includes(pkg) ? { pkg, version, hash } : null
}

/**
 * Builds the record the rewrites are driven from: package -> { name, version, hash,
 * integrity, clientSpec, lockResolved }. `clientSpec` is relative to `client/` (that is how
 * `client/package.json` and the lockfile's `packages.client.dependencies` spell it);
 * `lockResolved` is relative to the repo root (how `resolved` spells it).
 */
export function buildEngineMap(entries) {
  const map = {}
  for (const { pkg, version, hash, integrity } of entries) {
    const name = tarballName(pkg, version, hash)
    map[`${ENGINE_SCOPE}/${pkg}`] = {
      pkg,
      version,
      hash,
      integrity,
      name,
      clientSpec: `file:vendor/${name}`,
      lockResolved: `file:client/vendor/${name}`,
    }
  }
  return map
}

/**
 * Points the five `file:` dependencies in a parsed `client/package.json` at the new
 * tarballs. Mutates and returns the object; throws if a package is missing, because a
 * silent no-op here is exactly the failure mode this script exists to prevent.
 */
export function rewriteClientPackageJson(pkgJson, engineMap) {
  const deps = pkgJson.dependencies ?? {}
  for (const [name, info] of Object.entries(engineMap)) {
    if (!(name in deps)) throw new Error(`client/package.json has no "${name}" dependency`)
    deps[name] = info.clientSpec
  }
  return pkgJson
}

/**
 * Rewrites every trace of the five packages in a parsed `package-lock.json` (v3 — this script
 * only ever runs in THIS repo, whose lockfile is v3, so the v1/v2 parallel `dependencies` tree
 * is not handled):
 *
 *  - `packages["node_modules/@excalidraw/<p>"]` -> `resolved` + `integrity` + `version`
 *  - `packages["client"].dependencies` (and `devDependencies`) -> the `file:vendor/…` spec
 *
 * Returns the count of edits per package so the caller can assert nothing was skipped.
 */
export function rewriteLockfile(lock, engineMap) {
  const edits = Object.fromEntries(Object.keys(engineMap).map((n) => [n, 0]))
  const bump = (name) => { edits[name] += 1 }

  const rewriteSpecs = (specs) => {
    if (!specs || typeof specs !== 'object') return
    for (const [name, info] of Object.entries(engineMap)) {
      if (typeof specs[name] === 'string' && specs[name].startsWith('file:')) {
        specs[name] = info.clientSpec
        bump(name)
      }
    }
  }

  for (const [key, node] of Object.entries(lock.packages ?? {})) {
    if (!node || typeof node !== 'object') continue
    rewriteSpecs(node.dependencies)
    rewriteSpecs(node.devDependencies)
    const name = node.name ?? nameFromPackagesKey(key)
    const info = name && engineMap[name]
    if (info && typeof node.resolved === 'string') {
      node.resolved = info.lockResolved
      node.integrity = info.integrity
      node.version = info.version
      bump(name)
    }
  }

  return edits
}

/** `node_modules/a/node_modules/@excalidraw/common` -> `@excalidraw/common`. */
export function nameFromPackagesKey(key) {
  const i = key.lastIndexOf('node_modules/')
  return i === -1 ? null : key.slice(i + 'node_modules/'.length)
}

/**
 * Scans raw file text for any `yaseendraw-*.tgz` reference whose fork hash is not `hash`.
 * Returns the offending filenames (deduped). A non-empty result means the bump is broken
 * and `npm ci` would try to fetch a tarball that no longer exists.
 */
export function findStaleTarballRefs(text, hash) {
  const found = new Set()
  for (const m of text.matchAll(/yaseendraw-[A-Za-z0-9.-]+\.tgz/g)) {
    const parsed = parseTarballName(m[0])
    if (parsed && parsed.hash !== hash) found.add(m[0])
  }
  return [...found]
}

/**
 * Minimal flag parser for the CLI. Unknown flags throw rather than being ignored, so a typo
 * in `--commit` cannot silently pack whatever HEAD happens to be.
 */
export function parseArgs(argv) {
  const out = { fork: null, commit: null, use: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const key = arg.startsWith('--') ? arg.slice(2) : null
    if (!key || !(key in out)) throw new Error(`unknown argument: ${arg}`)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`)
    out[key] = value
    i += 1
  }
  return out
}

/**
 * Picks the prebuilt tarball for `pkg` out of a `--use` directory listing, proving by
 * filename that it came from `hash`. Anything else is a different fork commit and is
 * refused — copying one of those is how a "bump" ends up shipping the old engine.
 */
export function selectPrebuilt(names, pkg, hash) {
  const hits = names.map(parseTarballName).filter((p) => p && p.pkg === pkg)
  const match = hits.find((p) => p.hash === hash)
  if (match) return { ...match, name: tarballName(pkg, match.version, match.hash) }
  const seen = hits.map((p) => p.hash).join(', ') || 'none'
  throw new Error(`no prebuilt tarball for "${pkg}" at ${hash} (found: ${seen})`)
}

/**
 * Filters `git status --porcelain` output down to the lines that count. Worktree
 * directories the fork keeps in-tree are noise; anything else means the fork is dirty and
 * the build would not correspond to the commit being stamped into the filenames.
 */
export function significantStatusLines(porcelain, ignorePrefixes = ['.worktrees/', '.claude/worktrees/']) {
  return porcelain
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      const path = line.slice(3)
      return !ignorePrefixes.some((p) => path.startsWith(p))
    })
}
