import type { WorldRect } from "../camera/WorldRect.js";

/**
 * One bounded world-space area resolved by Rendering Core for presentation.
 */
export interface RenderRegion {
  /** Half-open world-space bounds represented by `pixels`. */
  readonly bounds: WorldRect;

  /** Final row-major RGBA8 pixels for `bounds`, independent of Raster storage. */
  readonly pixels: Uint8Array;
}
