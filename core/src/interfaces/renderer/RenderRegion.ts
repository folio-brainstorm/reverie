import type { WorldRect } from "../camera/WorldRect.js";

/**
 * One bounded world-space area resolved by Rendering Core for presentation.
 */
export interface RenderRegion {
  /** Half-open world-space bounds represented by `pixels`. */
  readonly bounds: WorldRect;

  /**
   * Final row-major RGBA8 pixels for `bounds`, independent of Raster storage.
   * Once Core emits this result, the buffer must never be modified in place.
   * Consumers may retain its identity to avoid redundant Canvas uploads.
   */
  readonly pixels: Uint8Array;
}
