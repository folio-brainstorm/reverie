import type { RGBAColor } from "../color/Colors.js";

/** Describes the color and operation-wide opacity used to paint a pixel. */
export interface PaintStyle {
  /** Straight-alpha RGBA8 source color. */
  color: RGBAColor;

  /** Operation opacity in the inclusive range from zero to one. Defaults to `1`. */
  opacity?: number;
}
