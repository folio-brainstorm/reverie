import type { WorldPoint } from "../camera/WorldPoint.js";

/** One fully normalized world-space point in a raw or derived stroke path. */
export interface StrokeSample {
  /** Continuous world-space path position. */
  readonly position: WorldPoint;

  /** Finite path time used to preserve temporal ordering. */
  readonly timestamp: number;

  /** Normalized pressure in the inclusive range `[0, 1]`. */
  readonly pressure: number;

  /** Pen tilt around the X axis in degrees in the inclusive range `[-90, 90]`. */
  readonly tiltX: number;

  /** Pen tilt around the Y axis in degrees in the inclusive range `[-90, 90]`. */
  readonly tiltY: number;
}
