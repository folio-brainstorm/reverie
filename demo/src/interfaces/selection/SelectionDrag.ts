import type { WorldPoint } from "@reverie/core";

/** Pointer identity and immutable anchor for one rectangle-selection gesture. */
export interface SelectionDrag {
  readonly pointerId: number;
  readonly anchor: WorldPoint;
}
