import type { WorldPoint } from "../camera/WorldPoint.js";

/** One timestamped world-space point in a raw or derived stroke path. */
export interface StrokeSample {
  /** Continuous world-space path position. */
  readonly position: WorldPoint;

  /** Finite path time used to preserve temporal ordering. */
  readonly timestamp: number;
}
