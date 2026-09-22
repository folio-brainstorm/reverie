import type { RasterLayerStatistics } from "./RasterLayerStatistics.js";

/** Aggregated sparse Raster-storage statistics for a World and its Layers. */
export interface WorldRasterStatistics {
  /** Sum of allocated Tiles across the World's current Layers. */
  tileCount: number;

  /** Sum of raw RGBA8 Tile payload bytes across the World's current Layers. */
  rawPixelBytes: number;

  /** Per-Layer statistics in the World's bottom-to-top layer order. */
  layers: RasterLayerStatistics[];
}
