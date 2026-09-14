import type { DynamicsCurve } from "./DynamicsCurve.js";

/** Configures inverse world-space velocity scaling for one brush parameter. */
export interface VelocityDynamics {
  /** Minimum resolved ratio at or above {@link maxVelocity}. Defaults to `0`. */
  readonly min?: number;

  /** Positive world-units-per-millisecond speed that reaches the minimum side. */
  readonly maxVelocity: number;

  /** Curve applied after velocity normalization and inversion. */
  readonly curve?: DynamicsCurve;
}
