import type { WorldPoint } from "../camera/WorldPoint.js";
import type { StampCommand } from "../stroke/StampCommand.js";
import type { Raster } from "../../core/raster/Raster.js";

/** Defines a brush model that can place one stamp in continuous world space. */
export interface Brush {
  /** Brush-defined primary stamp size measured in world units. */
  readonly size: number;

  /** Distance between stamps expressed as a proportion of {@link size}. */
  readonly spacing: number;

  /**
   * Paints one stamp into a raster at a continuous world position.
   *
   * @param raster - Sparse raster that receives the stamp.
   * @param position - Brush-defined stamp anchor in continuous world coordinates.
   * @param input - Optional per-stamp input used by brushes with dynamics.
   */
  stamp(raster: Raster, position: WorldPoint, input?: StampCommand): void;
}
