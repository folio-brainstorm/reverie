import type { RenderRegion } from "@reverie/core/rendering";
import type { RenderRequestIdentity } from "@reverie/core/rendering/internal";

import type { PresentationCacheContext } from "./PresentationCacheContext.js";

/** Mutable accumulation state for a single unfinished render request. */
export interface PendingFrame {
  /** Identity required for every batch merged into this frame. */
  readonly identity: RenderRequestIdentity;

  /** Regions accumulated under their stable world-bounds keys. */
  readonly regions: Map<string, RenderRegion>;

  /** Present only when the renderer supplied a cache-aware viewport request. */
  readonly cacheContext?: PresentationCacheContext;
}
