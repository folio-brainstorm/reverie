import type { RGBAColor } from "../color/Colors.js";
import type { BrushDynamics } from "./dynamics/BrushDynamics.js";
import type { BrushJitter } from "./jitter/BrushJitter.js";

/** Configuration for a circular brush model. */
export interface CircleBrushConfig {
  /** Stamp diameter measured in world units. */
  size: number;

  /** Straight-alpha RGBA8 color applied by each stamp. */
  color: RGBAColor;

  /** Stamp opacity in the inclusive range from zero to one. Defaults to `1`. */
  opacity?: number;

  /** Stamp-distance proportion relative to size. Defaults to `0.25`. */
  spacing?: number;

  /** Static rotation offset in radians. Defaults to `0`. */
  rotation?: number;

  /** Optional per-stamp input mappings owned by this brush. */
  dynamics?: BrushDynamics;

  /** Base unsigned 32-bit random seed. Defaults to `0`. */
  readonly seed?: number;

  /** Optional per-stamp variation applied after dynamics; disabled by default. */
  readonly jitter?: BrushJitter;
}
