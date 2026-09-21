import type { SerializedPixelPayloadV1 } from "./SerializedPixelPayloadV1.js";

/** One allocated sparse Raster tile in V1 serialized storage. */
export interface SerializedRasterTileV1 {
  /** Safe-integer horizontal coordinate in the Raster tile grid. */
  readonly x: number;

  /** Safe-integer vertical coordinate in the Raster tile grid. */
  readonly y: number;

  /** Exact raw pixel storage for this tile. */
  readonly payload: SerializedPixelPayloadV1;
}
