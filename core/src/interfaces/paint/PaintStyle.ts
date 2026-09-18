import type { RGBAColor } from "../color/Colors.js";
import type { PaintMode } from "./PaintMode.js";

/** Describes the color and operation-wide opacity used to paint a pixel. */
export interface PaintStyle {
  /** Operation applied to the destination; defaults to paint. */
  mode?: PaintMode;

  /** Straight-alpha RGBA8 source color. */
  color: RGBAColor;

  /** Operation opacity in the inclusive range from zero to one. Defaults to `1`. */
  opacity?: number;
}
