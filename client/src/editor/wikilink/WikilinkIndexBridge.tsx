/**
 * Owns the window's two deliberately separate wikilink feeds. Ready index snapshots replace the
 * stable semantic source's resolver/records and contribute Markdown picker rows. A Files-tree
 * catalog independently replaces the stable navigation-only source and contributes text/PDF rows;
 * it never enters the semantic source. A root switch synchronously retires the old catalog and the
 * composed picker rows before either new feed can resolve, preventing cross-vault composition while
 * every subscribed editor keeps the same source-object identities.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../../views/engine'
import { useIndex } from '../../views/useIndex'
import type { WatchSource } from '../../hooks/useWatch'
import { useViewOnlyCatalog } from '../../hooks/useViewOnlyCatalog'
import { linkCandidates, mergeLinkCandidates } from '../../links/completion'
import type { MutableWikilinkCandidateSource } from './wikilinkPicker'
import type { MutableWikilinkResolveSource } from './wikilinkPlugin'
import type { MutableViewOnlyLinkSource } from './viewOnlyLinkSource'

const EMPTY_RECORDS: IndexRecord[] = []

export interface WikilinkIndexBridgeProps {
  root: string
  watch: WatchSource
  source: MutableWikilinkResolveSource
  /** The `[[` picker's composed Markdown + view-only candidates (GRO-2191/YAZ-1310). */
  candidates?: MutableWikilinkCandidateSource
  /** Separate navigation-only catalog. Omitted mounts retain the semantic-only behavior. */
  viewOnly?: MutableViewOnlyLinkSource
  /**
   * Every READY snapshot, verbatim (Links E1c, GRO-2242): the external-rename detector diffs
   * consecutive snapshots — this component already sees them all, so no second `useIndex`
   * (which would double every fetch). Keep the identity stable (App's hook does).
   */
  onSnapshot?: (records: IndexRecord[]) => void
}

export function WikilinkIndexBridge({ root, watch, source, candidates, viewOnly, onSnapshot }: WikilinkIndexBridgeProps) {
  const { status, records } = useIndex(root, watch)
  const renderedRoot = useRef(root)
  const rootChanged = renderedRoot.current !== root
  useLayoutEffect(() => {
    renderedRoot.current = root
    if (viewOnly === undefined) return
    // Root identity changes synchronously retire the old vault's navigation catalog and every
    // merged row. New semantic/catalog snapshots may then arrive in either order without ever
    // composing across vaults; the stable source objects themselves are deliberately retained.
    viewOnly.reset()
    candidates?.update([])
  }, [root, candidates, viewOnly])
  useEffect(() => {
    // Only a READY snapshot feeds the sources: while the first fetch is pending (or a refetch
    // failed) links keep rendering with the previous resolver — or, before any index has ever
    // loaded, as resolved (source.resolve null) — never flashing everything unresolved.
    if (rootChanged || status !== 'ready') return
    const resolve = resolverFor(records, root)
    // The snapshot rides ALONG with the resolver (Links D, GRO-2193): the backlinks section
    // reads both off the same source, so N and the resolution behind it always agree.
    source.update((target) => resolve(target)?.record.path ?? null, records)
    candidates?.update(mergeLinkCandidates(linkCandidates(records), viewOnly?.catalog?.candidates ?? []))
    onSnapshot?.(records)
  }, [status, records, root, rootChanged, source, candidates, viewOnly, onSnapshot])
  return viewOnly === undefined ? null : (
    <ViewOnlyCatalogBridge
      root={root}
      watch={watch}
      semanticRecords={!rootChanged && status === 'ready' ? records : EMPTY_RECORDS}
      candidates={candidates}
      viewOnly={viewOnly}
    />
  )
}

function ViewOnlyCatalogBridge({ root, watch, semanticRecords, candidates, viewOnly }: {
  root: string
  watch: WatchSource
  semanticRecords: IndexRecord[]
  candidates?: MutableWikilinkCandidateSource
  viewOnly: MutableViewOnlyLinkSource
}): null {
  const state = useViewOnlyCatalog(root, watch)
  useEffect(() => {
    if (state.status !== 'ready' || state.catalog.root !== root) return
    viewOnly.update(state.catalog)
    candidates?.update(mergeLinkCandidates(linkCandidates(semanticRecords), state.catalog.candidates))
  }, [state.status, state.catalog, root, semanticRecords, candidates, viewOnly])
  return null
}
