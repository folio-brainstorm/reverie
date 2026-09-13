import type { WorldPoint } from "../camera/WorldPoint.js";

/** Describes one brush stamp waiting to be executed by an external consumer. */
export interface StampCommand {
  /** Stable world-space snapshot at which the current stroke brush should stamp. */
  readonly position: WorldPoint;
}
