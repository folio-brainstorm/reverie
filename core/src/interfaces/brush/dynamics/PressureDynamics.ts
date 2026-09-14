import type { DynamicsCurve } from "./DynamicsCurve.js";

/** Configures how normalized pen pressure scales one brush parameter. */
export interface PressureDynamics {
  /** Minimum resolved ratio at a zero curve response. Defaults to `0`. */
  readonly min?: number;

  /** Normalized response curve. Defaults to a linear curve. */
  readonly curve?: DynamicsCurve;
}
