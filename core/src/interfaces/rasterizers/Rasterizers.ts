import type { WorldPoint } from "../camera/WorldPoint.js";
import type { PixelCoverage } from "../pixel/PixelCoverage.js";

/** A circle defined in continuous world space. */
export interface Circle {
  /** Continuous world-space position of the circle's center. */
  center: WorldPoint;

  /** Non-negative finite radius measured in world units. */
  radius: number;
}

/** Receives one coverage result for every pixel hit by a rasterized shape. */
export type PixelCoverageVisitor = (hit: PixelCoverage) => void;
