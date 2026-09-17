import type { DirectionDynamics } from "./DirectionDynamics.js";
import type { TiltDynamics } from "./TiltDynamics.js";

/** Optional input mappings that affect stamp rotation. */
export interface RotationDynamics {
  /** Direction mapping; its presence makes local +X follow the stamp path. */
  readonly direction?: DirectionDynamics;

  /** Tilt mapping; its presence enables tilt-derived rotation. */
  readonly tilt?: TiltDynamics;
}
