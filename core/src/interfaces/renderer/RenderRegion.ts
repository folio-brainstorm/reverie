import type { WorldRect } from "../camera/WorldRect.js";
import type { RenderResultClass } from "./RenderResultClass.js";

/**
 * One bounded world-space area resolved by Rendering Core for presentation.
 */
export interface RenderRegion {
  /** Half-open world-space bounds represented by `pixels`. */
  readonly bounds: WorldRect;

  /**
   * Final row-major RGBA8 pixels for `bounds`, independent of Raster storage.
   * Once Core emits this result, callers must treat the buffer as immutable and
   * must not modify it in place. Core may return this exact buffer again from
   * its result cache without copying it. Caller mutation is unsupported and
   * may affect later cache hits.
   */
  readonly pixels: Uint8Array;

  /** Absent for canonical pixels; marks a World interaction preview. */
  readonly resultClass?: RenderResultClass;
}
