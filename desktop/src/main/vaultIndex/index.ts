/**
 * Bases property index (GRO-2127 / GRO-2128). Transport-agnostic: no Hono, no Electron — the
 * Desktop bridge (`ipc/fs.ts`, GRO-2129) and tests invoke `getIndex` directly.
 * The persistent cache (GRO-2223) is Electron-free too: `main/index.ts` injects the dir.
 */
export { flushIndexCache, initIndexCache } from './cache'
export type { ColdStartDiff } from './reconcile'
export { _evictAll, _setIdleMs, getColdStartDiff, getIndex } from './live'
export { extractAliases, extractEmbeds, extractLinks, extractTags, scanFile } from './scan'
