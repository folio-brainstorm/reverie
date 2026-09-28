import type { RenderRegion } from "./RenderRegion.js";
import type { RenderContinuation } from "./RenderContinuation.js";
import type { RenderRequestIdentity } from "./RenderRequestIdentity.js";

/** Complete, ordered collection of final pixel regions for one render pass. */
export interface RenderRegionSet {
  /** Identity of the request that generated every region in this batch. */
  readonly identity: RenderRequestIdentity;

  /** Regions to present in order for the associated render request. */
  readonly regions: readonly RenderRegion[];

  /** Present only when more batches remain for the same render request. */
  readonly continuation?: RenderContinuation;
}
