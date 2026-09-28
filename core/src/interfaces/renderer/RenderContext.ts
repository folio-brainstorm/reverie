import type { RenderQualityMode } from "./RenderQualityMode.js";

/**
 * Runtime context that affects final-pixel resolution without owning document state.
 */
export interface RenderContext {
  /**
   * Final output pixels per world pixel. Values below one permit Core to emit
   * a filtered lower-resolution region while preserving its world bounds.
   */
  readonly scale?: number;

  /** Interactive passes may select one cheaper level from the existing LOD policy. */
  readonly quality?: RenderQualityMode;
}
