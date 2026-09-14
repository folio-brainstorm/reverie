import type { Brush } from "../brush/Brush.js";

/** Dependencies captured for the lifetime of one continuous stroke. */
export interface StrokeConfig {
  /** Brush model whose immutable size and spacing define stamp placement. */
  brush: Brush;

  /** Position EMA factor in `(0, 1]`; defaults to `1` (no smoothing). */
  smoothing?: number;

  /** Fixed processed-path interval in world units; defaults to `1`. */
  resampleDistance?: number;
}
