import type { BrushParameterDynamics } from "./BrushParameterDynamics.js";

/** Per-stamp size and opacity mappings supported by a PixelBrush. */
export interface PixelBrushDynamics {
  /** Mappings that scale the configured integer footprint size. */
  readonly size?: BrushParameterDynamics;

  /** Mappings that scale the configured base opacity. */
  readonly opacity?: BrushParameterDynamics;
}
