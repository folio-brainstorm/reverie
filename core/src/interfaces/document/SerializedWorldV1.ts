import type { WorldBounds } from "../world/WorldBounds.js";
import type { SerializedLayerV1 } from "./SerializedLayerV1.js";

/** V1 representation of one ordered World document. */
export interface SerializedWorldV1 {
  /** Edge length in pixels of every Raster tile in this document. */
  readonly tileSize: number;

  /** Finite half-open document bounds, or null for an unbounded World. */
  readonly bounds: WorldBounds | null;

  /** Bottom-to-top Layer metadata in composition order. */
  readonly layers: readonly SerializedLayerV1[];
}
