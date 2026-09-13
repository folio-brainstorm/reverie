import type { WorldPoint } from "../camera/WorldPoint.js";
import type { Raster } from "../../core/raster/Raster.js";

/** Defines a brush model that can place one stamp in continuous world space. */
export interface Brush {
  /** Stamp diameter measured in world units. */
  readonly size: number;

  /** Distance between stamps expressed as a proportion of {@link size}. */
  readonly spacing: number;

  /**
   * Paints one stamp into a raster at a continuous world position.
   *
   * @param raster - Sparse raster that receives the stamp.
   * @param position - Center of the stamp in continuous world coordinates.
   */
  stamp(raster: Raster, position: WorldPoint): void;
}
