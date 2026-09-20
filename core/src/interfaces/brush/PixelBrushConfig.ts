import type { RGBAColor } from "../color/Colors.js";
import type { PixelBrushDynamics } from "./dynamics/PixelBrushDynamics.js";
import type { PixelBrushJitter } from "./jitter/PixelBrushJitter.js";
import type { BrushScatter } from "./scatter/BrushScatter.js";

/** Configuration for an axis-aligned, hard-edged pixel brush. */
export interface PixelBrushConfig {
  /** Positive safe-integer width and height of the square pixel footprint. */
  readonly size: number;

  /** Straight-alpha RGBA8 color applied by each stamp. */
  readonly color: RGBAColor;

  /** Stamp opacity in the inclusive range from zero to one. Defaults to `1`. */
  readonly opacity?: number;

  /** Stamp-distance proportion relative to size. Defaults to `0.25`. */
  readonly spacing?: number;

  /** Optional size and opacity mappings owned by this brush. */
  readonly dynamics?: PixelBrushDynamics;

  /** Base unsigned 32-bit random seed. Defaults to `0`. */
  readonly seed?: number;

  /** Optional size, opacity, and spacing variation. */
  readonly jitter?: PixelBrushJitter;

  /** Optional final-position variation applied before pixel-grid snapping. */
  readonly scatter?: BrushScatter;
}
