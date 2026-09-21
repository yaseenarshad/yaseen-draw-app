/**
 * What every `tools/` script does to a vault before it does anything of its own (YAZ-1549): load
 * the app's `shared/` TypeScript through Node's own type stripping, ask git whether the tree is
 * clean, and walk the vault's files. One spelling, so the migration and the one-shot seed cannot
 * drift in how they refuse a dirty tree or which files they consider.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// `shared/` is TypeScript, and Node 22.18+ strips the types on import with no flag and no build
// step — so the scripts use the app's OWN frontmatter mechanics and property vocabulary rather than
// a second copy of them. The one cost is a `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr (the
// root package.json has no `"type"`), which is noise in a CLI's output and is muted here alone;
// every other warning still goes through.
const emitWarning = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const opts = rest[0]
  const code = typeof opts === 'object' && opts !== null ? opts.code : rest[1]
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return
  emitWarning.call(process, warning, ...rest)
}

const SHARED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../shared')

/** `shared/<file>` as a module, or a clear exit: TypeScript on `import` is Node 22.6+ (on by default from 22.18). */
export async function shared(file) {
  try {
    return await import(pathToFileURL(path.join(SHARED_DIR, file)).href)
  } catch (err) {
    console.error(
      `Could not load shared/${file} (node ${process.version}). This script reads the app's own` +
        ` TypeScript modules directly and needs Node 22.6 or newer.\n${err.message}`,
    )
    process.exit(1)
  }
}

export const posix = (p) => p.split(path.sep).join('/')
/** Dotfolders and node_modules are invisible to the tree, the index and every script alike. */
export const isSkipped = (name) => name.startsWith('.') || name === 'node_modules'
export const isMarkdown = (name) => /\.(md|markdown)$/i.test(name)

// ---------------------------------------------------------------------------
// Git preflight (🔒 D1 of YAZ-822, shared by every script that writes)
// ---------------------------------------------------------------------------

export function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * `null` when `root` is inside a git repo whose tree is clean, else the sentence explaining why not.
 * `forgive(porcelainPath)` names paths that never count as dirt — the migration's own report file,
 * which its dry run writes by ruling (🔒 D6) and which must not then block the `--apply` that
 * follows. Porcelain paths are REPO-root-relative, and the vault may be a subdirectory of the repo.
 */
export function gitDirtReason(root, { forgive = () => false } = {}) {
  try {
    if (git(root, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true') {
      return `${root} is not inside a git working tree`
    }
  } catch {
    return `${root} is not a git repository (or git is unavailable) — this script needs one to undo into`
  }
  let status
  try {
    status = git(root, ['status', '--porcelain', '--', '.'])
  } catch (err) {
    return `could not read git status: ${err.message}`
  }
  const dirty = status
    .split('\n')
    .filter((line) => line.trim() !== '')
    .filter((line) => !forgive(line.slice(3).replace(/^"|"$/g, '')))
  if (dirty.length === 0) return null
  return `the working tree has uncommitted changes:\n${dirty.map((l) => `    ${l}`).join('\n')}`
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/** Every FILE under `root` in a stable (name-sorted) order, dotfolders and node_modules skipped: `onFile(abs, name)`. */
export function walkVault(root, onFile) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (isSkipped(entry.name)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) onFile(abs, entry.name)
    }
  }
  walk(root)
}

/** The markdown files under `root`, absolute, in walk order. */
export function markdownFiles(root) {
  const out = []
  walkVault(root, (abs, name) => {
    if (isMarkdown(name)) out.push(abs)
  })
  return out
}
