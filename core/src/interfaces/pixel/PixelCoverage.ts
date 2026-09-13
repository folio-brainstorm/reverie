import type { PixelCoord } from "./PixelCoords.js";

/** Describes how strongly a rasterized geometry covers one discrete pixel. */
export interface PixelCoverage {
  /** Discrete world-space pixel coordinate. */
  pixel: PixelCoord;

  /** Coverage in the inclusive range from zero to one. */
  coverage: number;
}
