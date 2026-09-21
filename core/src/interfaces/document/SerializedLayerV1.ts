import type { LayerBlendMode } from "../world/LayerBlendMode.js";
import type { SerializedRasterV1 } from "./SerializedRasterV1.js";

/** V1 representation of one Raster layer and its sparse pixels. */
export interface SerializedLayerV1 {
  /** Stable document identity; array order remains separate from identity. */
  readonly id: string;

  /** User-visible Layer name. */
  readonly name: string;

  /** Whether this Layer participates in World composition. */
  readonly visible: boolean;

  /** Non-destructive composition opacity in the inclusive range [0, 1]. */
  readonly opacity: number;

  /** Supported composition operation. */
  readonly blendMode: LayerBlendMode;

  /** Sparse raw Raster contents owned by this Layer. */
  readonly raster: SerializedRasterV1;
}
