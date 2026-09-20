import type { TileCoord } from "../tile/TileCoord.js";

/** Exact existence and RGBA8 contents of one sparse Raster tile coordinate. */
export interface RasterTileSnapshot {
  /** Coordinate in the Raster's sparse tile grid. */
  readonly coord: TileCoord;

  /** Independent RGBA8 bytes, or null when the Tile is absent. */
  readonly pixels: Uint8ClampedArray | null;
}
