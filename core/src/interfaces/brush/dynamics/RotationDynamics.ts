import type { TiltDynamics } from "./TiltDynamics.js";

/** Optional input mappings that affect stamp rotation. */
export interface RotationDynamics {
  /** Tilt mapping; its presence enables tilt-derived rotation. */
  readonly tilt?: TiltDynamics;
}
