import type { SerializedRasterTileV1 } from "./SerializedRasterTileV1.js";

/** Sparse RGBA8 Raster representation used by the V1 document schema. */
export interface SerializedRasterV1 {
  /** Edge length in pixels of each serialized tile. */
  readonly tileSize: number;

  /** Fixed straight-alpha, four-channel pixel format. */
  readonly pixelFormat: "rgba8";

  /** Allocated tiles in deterministic tile-Y then tile-X order. */
  readonly tiles: readonly SerializedRasterTileV1[];
}
