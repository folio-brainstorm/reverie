import type { RenderRegion } from "@reveriejs/core/rendering";

import type { PresentationCacheContext } from "./PresentationCacheContext.js";

/** One renderer-owned final pixel result and its validity metadata. */
export interface CachedPresentationRegion {
  readonly region: RenderRegion;
  readonly sourceRevision: PresentationCacheContext["sourceRevision"];
  /** Actual square pixel-buffer edge, which may exceed a later request's size. */
  readonly outputTileSize: PresentationCacheContext["outputTileSize"];
}
