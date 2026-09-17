import type { BrushImage } from "../../core/brush/BrushImage.js";
import type { RGBAColor } from "../color/Colors.js";
import type { BrushAnchor } from "./BrushAnchor.js";
import type { BrushDynamics } from "./dynamics/BrushDynamics.js";
import type { BrushJitter } from "./jitter/BrushJitter.js";

/** Configuration for an alpha-mask image brush. */
export interface ImageBrushConfig {
  /** Immutable alpha mask reused by every stamp. */
  readonly image: BrushImage;

  /** World-space length of the image's longest side. */
  readonly size: number;

  /** Straight-alpha RGBA8 paint color; source image RGB is ignored. */
  readonly color: RGBAColor;

  /** Stamp opacity in the inclusive range `[0, 1]`. Defaults to `1`. */
  readonly opacity?: number;

  /** Stamp-distance proportion relative to size. Defaults to `0.25`. */
  readonly spacing?: number;

  /** Normalized image point placed at the stamp position. Defaults to center. */
  readonly anchor?: BrushAnchor;

  /** Static rotation offset in radians. Defaults to `0`. */
  readonly rotation?: number;

  /** Optional per-stamp size, opacity, and rotation mappings. */
  readonly dynamics?: BrushDynamics;

  /** Base unsigned 32-bit random seed. Defaults to `0`. */
  readonly seed?: number;

  /** Optional per-stamp variation applied after dynamics; disabled by default. */
  readonly jitter?: BrushJitter;
}
