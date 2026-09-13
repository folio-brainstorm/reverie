import type { Brush } from "../brush/Brush.js";

/** Dependencies captured for the lifetime of one continuous stroke. */
export interface StrokeConfig {
  /** Brush model whose immutable size and spacing define stamp placement. */
  brush: Brush;
}
