import type { PressureDynamics } from "./PressureDynamics.js";
import type { VelocityDynamics } from "./VelocityDynamics.js";

/** Optional input mappings that scale one scalar brush parameter. */
export interface BrushParameterDynamics {
  /** Pressure mapping; its presence enables pressure for this parameter. */
  readonly pressure?: PressureDynamics;

  /** Velocity mapping; its presence enables velocity for this parameter. */
  readonly velocity?: VelocityDynamics;
}
