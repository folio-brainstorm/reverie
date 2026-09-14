import type { WorldPoint } from "../camera/WorldPoint.js";

/** One stroke sample supplied at the public stroke input boundary. */
export interface StrokeSampleInput {
  /** Continuous world-space path position. */
  readonly position: WorldPoint;

  /** Finite path time used to preserve temporal ordering. */
  readonly timestamp: number;

  /**
   * Normalized pressure in the inclusive range `[0, 1]`.
   *
   * Defaults to `1` when omitted, matching input sources without a reliable
   * pressure measurement.
   */
  readonly pressure?: number;

  /**
   * Pen tilt around the X axis in degrees in the inclusive range `[-90, 90]`.
   *
   * Defaults to `0` when omitted.
   */
  readonly tiltX?: number;

  /**
   * Pen tilt around the Y axis in degrees in the inclusive range `[-90, 90]`.
   *
   * Defaults to `0` when omitted.
   */
  readonly tiltY?: number;
}
