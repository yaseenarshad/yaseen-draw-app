/**
 * THE LIBRARY'S COMPONENT STORE (🔒 D5, YAZ-1819): `<library>/components/<slug>.excalidraw` +
 * `<slug>.png`, indexed by `<library>/components.json`, shared by every vault's windows. The rules
 * live in `@shared/savedComponents`; this module is the disk half — read lazily, write atomically,
 * trash through the OS, watch for the other writers.
 *
 * THE FOLDER IS THE TRUTH, THE INDEX IS A CACHE. Every read reconciles the index against what is
 * actually in `components/`: a fragment the index does not know is adopted (named after its own
 * slug, counted by reading it once), a row whose file has gone drops out, and an index that is
 * missing or is not a version-1 index at all is rebuilt from the folder — the corrupt one moved
 * aside as `components.json.corrupt-<epoch>`, the `store.ts` posture. This is what makes a
 * component that arrived through a synced folder show up without anything having to repair itself,
 * and what makes a file deleted in Finder stop being offered.
 *
 * A READ NEVER WRITES. The reconciliation happens in memory; the file is only ever written by a
 * mutation, which writes the reconciled index WITH its change. So listing a library on a read-only
 * disk works, and nothing churns a synced folder just by being looked at.
 *
 * Mutations serialise on one promise chain (two windows saving in the same tick are two
 * read-modify-writes and interleaving them would lose one), and a mutation that changes nothing
 * does not write.
 *
 * Watching: one chokidar on the library FOLDER at depth 1 — `components.json` beside
 * `components/`, and everything inside it — pushed to every window as `components:changed`. An own
 * write notifies this process's subscribers synchronously and its watcher echo is dropped by path
 * + mtime (`ownWrites`), which is `mediaStore`'s single-file echo suppression with one entry per
 * file, because one save touches three. `setFolder` re-points everything when
 * `settings.libraryFolder` changes.
 *
 * TRASH, NEVER `rm` (the app's rule for every delete): `shell.trashItem` comes in as an argument,
 * so this module stays Electron-free and its tests run on a temp folder with a spy.
 */
import { watch, type FSWatcher } from 'chokidar'
import { existsSync, type Stats } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  COMPONENTS_INDEX_FILE,
  LIBRARY_COMPONENTS_DIR,
  type ComponentItem,
  type ComponentRenameRequest,
  type ComponentSaveRequest,
  type ComponentSlugRequest,
  type ComponentsIndexFile,
} from '@shared/types'
import {
  EMPTY_COMPONENTS_INDEX,
  componentFileName,
  componentPreviewName,
  indexFromSlugs,
  isValidComponentSlug,
  normalizeComponentName,
  parseComponentFragment,
  putComponentItem,
  removeComponentItem,
  renameComponentItem,
  sanitizeComponentsIndex,
  slugForComponentName,
  slugOfComponentFile,
  slugOfComponentPreview,
  uniqueComponentSlug,
  type ComponentOnDisk,
} from '@shared/savedComponents'
import { parseDataUrl } from '@shared/drawingAssets'
import { BridgeFailure, atomicWrite, fsCall } from '../fs/fsUtils'

const NOTIFY_DEBOUNCE_MS = 50

/** The one preview format (🔒 D5): the renderer exports PNG, and nothing else is stored. */
const PREVIEW_MIME = 'image/png'

export interface ComponentStore {
  /** The reconciled index, newest-updated first. */
  list(): Promise<ComponentItem[]>
  /** Write both files and index them; answers the row it made. */
  save(req: ComponentSaveRequest): Promise<ComponentItem>
  /** The fragment's bytes, exactly as they are on disk. */
  read(req: ComponentSlugRequest): Promise<string>
  /** The label only — both files keep their names. */
  rename(req: ComponentRenameRequest): Promise<ComponentItem>
  /** Both files to the trash, and the row out of the index. */
  delete(req: ComponentSlugRequest): Promise<void>
  /** The stored preview as a `data:image/png;base64,…` dataURL. */
  preview(req: ComponentSlugRequest): Promise<string>
  /** Point at another library folder (the setting changed); the old one goes quiet. */
  setFolder(folder: string): void
  /** Fires after any change to the components library — an own write or an external one. */
  onChanged(listener: () => void): () => void
  close(): Promise<void>
}

export function createComponentStore(initialFolder: string, deps: { now?: () => number; trash: (p: string) => Promise<void> }): ComponentStore {
  const now = deps.now ?? Date.now
  const trash = deps.trash
  const listeners = new Set<() => void>()
  let folder = initialFolder
  let watcher: FSWatcher
  /** Path → the mtime this process last wrote it with (null = an unlink it caused), so the echo drops. */
  let ownWrites = new Map<string, number | null>()
  /** True once the folder existed when the watcher anchored to it (polling loses a path that appears mid-init). */
  let anchored = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Mutations chain so two read-modify-writes never interleave. */
  let chain: Promise<unknown> = Promise.resolve()

  const indexFile = (): string => path.join(folder, COMPONENTS_INDEX_FILE)
  const componentsDir = (): string => path.join(folder, LIBRARY_COMPONENTS_DIR)
  const fragmentPath = (slug: string): string => path.join(componentsDir(), componentFileName(slug))
  const previewPath = (slug: string): string => path.join(componentsDir(), componentPreviewName(slug))
  const notify = (): void => listeners.forEach((l) => l())

  /** The index file alone, with a file that is not one moved aside. Never creates anything. */
  async function readIndexFile(): Promise<ComponentsIndexFile> {
    const p = indexFile()
    let raw: string
    try {
      raw = await readFile(p, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_COMPONENTS_INDEX
      throw err
    }
    let index: ComponentsIndexFile | null = null
    try {
      index = sanitizeComponentsIndex(JSON.parse(raw))
    } catch {
      index = null
    }
    if (index !== null) return index
    const backup = `${p}.corrupt-${Date.now()}`
    await rename(p, backup).then(
      () => console.error(`[components] ${p} is not a valid components index; moved to ${backup} and rebuilding from the folder`),
      (err: unknown) => console.error(`[components] ${p} is not a valid components index and could not be moved aside: ${String(err)}`),
    )
    return EMPTY_COMPONENTS_INDEX
  }

  /** What the folder holds: one entry per readable `<slug>.excalidraw`, counted only when it is new. */
  async function scanFolder(known: ComponentsIndexFile): Promise<ComponentOnDisk[]> {
    const dir = componentsDir()
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const bySlug = new Map(known.items.map((item) => [item.slug, item]))
    const seen: ComponentOnDisk[] = []
    for (const name of names) {
      const slug = slugOfComponentFile(name)
      if (slug === null) continue
      const p = path.join(dir, name)
      const st = await stat(p).catch(() => null)
      if (st === null || !st.isFile()) continue
      const row = bySlug.get(slug)
      if (row !== undefined) {
        seen.push({ slug, elementCount: row.elementCount, createdAt: row.createdAt, updatedAt: row.updatedAt })
        continue
      }
      // Unknown to the index: count it once, by reading it. A fragment that is not a component —
      // corrupt, truncated, someone else's JSON — is SKIPPED rather than offered as a tile that
      // cannot be inserted.
      const count = await readFile(p, 'utf8')
        .then((text) => parseComponentFragment(text).elements.length)
        .catch(() => null)
      if (count === null) {
        console.warn(`[components] ${p} is not a readable component; skipped`)
        continue
      }
      const birth = Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs
      seen.push({ slug, elementCount: count, createdAt: birth, updatedAt: st.mtimeMs })
    }
    return seen
  }

  /** The index as the folder and the file together imply it. Pure reads — nothing is written. */
  async function readIndex(): Promise<ComponentsIndexFile> {
    const known = await readIndexFile()
    return indexFromSlugs(await scanFolder(known), known)
  }

  async function writeBytes(p: string, content: string | Uint8Array): Promise<void> {
    const { mtime } = await fsCall(p, async () => {
      await mkdir(path.dirname(p), { recursive: true })
      return atomicWrite(p, content)
    })
    ownWrites.set(p, mtime)
    if (!anchored) {
      // The watcher attached while the folder was missing; this write made it. Re-anchor once.
      watcher.add(folder)
      anchored = true
    }
  }

  async function writeIndex(index: ComponentsIndexFile): Promise<void> {
    await writeBytes(indexFile(), `${JSON.stringify(index, null, 2)}\n`)
  }

  /** One read-modify-write on the chain; `fn` does the file work and answers the index to store. */
  function mutate<T>(fn: (index: ComponentsIndexFile) => Promise<{ index: ComponentsIndexFile; value: T }>): Promise<T> {
    const run = chain.then(async () => {
      const before = await readIndex()
      const { index, value } = await fn(before)
      if (index !== before) {
        await writeIndex(index)
        notify()
      }
      return value
    })
    chain = run.catch(() => undefined)
    return run
  }

  function requireSlug(slug: string): string {
    if (!isValidComponentSlug(slug)) throw new BridgeFailure('BAD_REQUEST', "'slug' is not a component slug")
    return slug
  }

  function startWatching(): FSWatcher {
    const dir = folder
    anchored = existsSync(dir)
    ownWrites = new Map()
    // Depth 1: `components.json` sits beside `components/`, and what is INSIDE that folder is the
    // library itself — a synced fragment arrives there without the index ever being touched.
    const w = watch(dir, { depth: 1, ignoreInitial: true, alwaysStat: true, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } })
    const components = path.join(dir, LIBRARY_COMPONENTS_DIR)
    /**
     * The index, and the two files a component IS. Anything else under `components/` — an
     * `atomicWrite` tmp file above all, which is added and unlinked on every single save — is
     * silence, the way `mediaStore`'s depth-0 filter names `media.json` and nothing else.
     */
    const relevant = (p: string): boolean => {
      if (p === path.join(dir, COMPONENTS_INDEX_FILE)) return true
      if (path.dirname(p) !== components) return false
      const name = path.basename(p)
      return slugOfComponentFile(name) !== null || slugOfComponentPreview(name) !== null
    }
    const schedule = (p: string, stats?: Stats) => {
      if (!relevant(p)) return
      const own = ownWrites.get(p)
      if (own !== undefined && (stats === undefined ? own === null : own === stats.mtimeMs)) {
        ownWrites.delete(p)
        return // echo of this process's own write or trash
      }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        notify()
      }, NOTIFY_DEBOUNCE_MS)
    }
    w.on('add', schedule)
      .on('change', schedule)
      .on('unlink', (p) => schedule(p))
      .on('error', (err) => console.warn(`[components] watcher error under ${dir}: ${String(err)}`))
      // `components/` may have come into existence DURING chokidar's own initialisation, which
      // polling loses (the `mediaStore` note, one level down). Re-adding it once at `ready` is the
      // recovery; on a path that still does not exist it does nothing, and the parent watch picks
      // that folder up when it is finally made.
      .on('ready', () => void w.add(components))
    return w
  }

  watcher = startWatching()

  return {
    async list() {
      const run = chain.then(readIndex)
      chain = run.catch(() => undefined)
      return run.then((index) => index.items)
    },

    async save(req) {
      const name = normalizeComponentName(req.name)
      if (name === null) throw new BridgeFailure('BAD_REQUEST', "'name' must be a non-empty string")
      let elementCount: number
      try {
        elementCount = parseComponentFragment(req.fragmentJson).elements.length
      } catch (err) {
        throw new BridgeFailure('BAD_REQUEST', `'fragmentJson' is not a component: ${err instanceof Error ? err.message : String(err)}`)
      }
      const preview = parseDataUrl(req.previewPng)
      if (preview === null || preview.mimeType !== PREVIEW_MIME) throw new BridgeFailure('BAD_REQUEST', "'previewPng' must be a base64 image/png dataURL")
      const bytes = Buffer.from(preview.base64, 'base64')
      return mutate(async (index) => {
        const taken = new Set(index.items.map((item) => item.slug))
        const slug = uniqueComponentSlug(slugForComponentName(name), taken)
        const at = now()
        // The fragment's own bytes, as the renderer serialised them: a component IS an Excalidraw
        // document, and re-spelling it here would only make the two disagree.
        await writeBytes(fragmentPath(slug), req.fragmentJson.endsWith('\n') ? req.fragmentJson : `${req.fragmentJson}\n`)
        await writeBytes(previewPath(slug), bytes)
        const item: ComponentItem = { slug, name, elementCount, createdAt: at, updatedAt: at }
        return { index: putComponentItem(index, item), value: item }
      })
    },

    async read(req) {
      const slug = requireSlug(req.slug)
      const p = fragmentPath(slug)
      return fsCall(p, () => readFile(p, 'utf8'))
    },

    async rename(req) {
      const slug = requireSlug(req.slug)
      const name = normalizeComponentName(req.name)
      if (name === null) throw new BridgeFailure('BAD_REQUEST', "'name' must be a non-empty string")
      return mutate(async (index) => {
        const next = renameComponentItem(index, slug, name, now())
        if (next === index) throw new BridgeFailure('NOT_FOUND', 'no such component', { path: fragmentPath(slug) })
        return { index: next, value: next.items.find((item) => item.slug === slug) as ComponentItem }
      })
    },

    async delete(req) {
      const slug = requireSlug(req.slug)
      return mutate(async (index) => {
        const next = removeComponentItem(index, slug)
        if (next === index) throw new BridgeFailure('NOT_FOUND', 'no such component', { path: fragmentPath(slug) })
        // Both files, and a preview that is already gone is not a failure — the fragment is the
        // component, the picture is a convenience.
        const fragment = fragmentPath(slug)
        await fsCall(fragment, async () => {
          await trash(fragment)
          ownWrites.set(fragment, null)
        })
        const preview = previewPath(slug)
        await trash(preview).then(
          () => ownWrites.set(preview, null),
          () => undefined,
        )
        return { index: next, value: undefined }
      })
    },

    async preview(req) {
      const slug = requireSlug(req.slug)
      const p = previewPath(slug)
      const bytes = await fsCall(p, () => readFile(p))
      return `data:${PREVIEW_MIME};base64,${bytes.toString('base64')}`
    },

    setFolder(next) {
      if (next === folder) return
      void watcher.close()
      if (timer !== null) clearTimeout(timer)
      timer = null
      folder = next
      watcher = startWatching()
    },

    onChanged(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    close() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      listeners.clear()
      return watcher.close()
    },
  }
}
