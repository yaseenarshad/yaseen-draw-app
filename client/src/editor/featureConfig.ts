/**
 * Crepe feature allowlist (GRO-2014, GRO-1805 D17). The ONE place that says which Crepe
 * features this editor loads; `createCrepe()` passes `features` through untouched and
 * `featureConfig.test.ts` checks the running editor against `ENABLED_FEATURES`.
 *
 * Every `CrepeFeature` must be classified here — the `Record<CrepeFeature, boolean>` type
 * makes a Crepe upgrade that adds a feature fail `typecheck` until it is put on a list, so
 * Crepe's own `defaultFeatures` can never leak in silently.
 */
import { CrepeFeature } from '@milkdown/crepe'

export const ENABLED_FEATURES = [
  CrepeFeature.BlockEdit,
  CrepeFeature.CodeMirror,
  CrepeFeature.Cursor,
  CrepeFeature.LinkTooltip,
  CrepeFeature.ListItem,
  CrepeFeature.Placeholder,
  CrepeFeature.Table,
  CrepeFeature.Toolbar,
] as const

export const DISABLED_FEATURES = [
  /** Its serializer overwrites image alt text with the ratio ("![1.00](src)") — GRO-1961. */
  CrepeFeature.ImageBlock,
  /** `$…$` is inline math to it, so `$500K–$1M` renders as a formula — this is a business
      wiki, and dollars are dollars (YAZ-977). */
  CrepeFeature.Latex,
  CrepeFeature.TopBar,
  CrepeFeature.AI,
] as const

type Enabled = (typeof ENABLED_FEATURES)[number]
type Disabled = (typeof DISABLED_FEATURES)[number]

/** Full on/off map handed to `new Crepe({ features })`. */
export const features: Record<CrepeFeature, boolean> = {
  ...(Object.fromEntries(ENABLED_FEATURES.map((f) => [f, true])) as Record<Enabled, true>),
  ...(Object.fromEntries(DISABLED_FEATURES.map((f) => [f, false])) as Record<Disabled, false>),
}
