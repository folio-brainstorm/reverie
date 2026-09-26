import type { RenderRegion } from "./RenderRegion.js";

/** One reusable output variant and the source state that produced it. */
export interface RenderResultCacheEntry {
  readonly signature: string;
  readonly region: RenderRegion;
}
