import type { RenderRegion } from "@reverie/core/rendering";

import type { PresentationCacheContext } from "./PresentationCacheContext.js";

/** One renderer-owned final pixel result and its validity metadata. */
export interface CachedPresentationRegion {
  readonly region: RenderRegion;
  readonly sourceRevision: PresentationCacheContext["sourceRevision"];
  readonly outputTileSize: PresentationCacheContext["outputTileSize"];
}
