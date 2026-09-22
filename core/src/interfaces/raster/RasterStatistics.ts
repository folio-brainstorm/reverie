import type { TileBounds } from "../tile/TileBounds.js";

/**
 * A snapshot of one Raster's allocated sparse-storage structure.
 *
 * Values describe raw RGBA8 Tile payloads only. They exclude JavaScript,
 * renderer, history, and runtime memory overhead.
 */
export interface RasterStatistics {
  /** Number of currently allocated Tiles, including all-zero payloads. */
  tileCount: number;

  /** Combined byte length of all allocated raw RGBA8 Tile payloads. */
  rawPixelBytes: number;

  /** Inclusive allocated Tile-coordinate extent, or `null` when empty. */
  tileBounds: TileBounds | null;
}
