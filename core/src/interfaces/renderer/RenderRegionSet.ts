import type { RenderRegion } from "./RenderRegion.js";

/** Complete, ordered collection of final pixel regions for one render pass. */
export interface RenderRegionSet {
  /** Regions to present in order for the associated render request. */
  readonly regions: readonly RenderRegion[];
}
