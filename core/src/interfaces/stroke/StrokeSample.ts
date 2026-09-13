import type { WorldPoint } from "../camera/WorldPoint.js";

/** One unmodified input fact supplied to a stroke. */
export interface StrokeSample {
  /** Continuous world-space input position. */
  readonly position: WorldPoint;

  /** Finite input time used to preserve temporal ordering. */
  readonly timestamp: number;
}
