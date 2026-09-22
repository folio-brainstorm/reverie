import type { RasterStatistics } from "../raster/RasterStatistics.js";

/** Statistics for one Layer-owned Raster within a World snapshot. */
export interface RasterLayerStatistics {
  /** Stable identity of the Layer that owns the Raster. */
  id: string;

  /** Independent sparse-storage statistics for the Layer's Raster. */
  statistics: RasterStatistics;
}
