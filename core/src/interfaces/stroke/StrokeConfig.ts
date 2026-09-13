import type { Brush } from "../brush/Brush.js";
import type { Raster } from "../../core/raster/Raster.js";

/** Dependencies captured for the lifetime of one continuous stroke. */
export interface StrokeConfig {
  /** Raster that receives every placed brush stamp. */
  raster: Raster;

  /** Brush model used for stamp metrics and painting behavior. */
  brush: Brush;
}
