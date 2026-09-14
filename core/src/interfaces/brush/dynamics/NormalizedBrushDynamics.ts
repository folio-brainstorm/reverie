import type { DynamicsCurve } from "./DynamicsCurve.js";

/** Validated scalar mapping used by the per-stamp resolver. */
export interface NormalizedScalarDynamics {
  readonly min: number;
  readonly curve: DynamicsCurve;
}

/** Validated inverse-velocity mapping used by the per-stamp resolver. */
export interface NormalizedVelocityDynamics extends NormalizedScalarDynamics {
  readonly maxVelocity: number;
}

/** Validated optional mappings for one resolved scalar parameter. */
export interface NormalizedBrushParameterDynamics {
  readonly pressure: NormalizedScalarDynamics | null;
  readonly velocity: NormalizedVelocityDynamics | null;
}

/** Immutable, validated dynamics captured by one brush instance. */
export interface NormalizedBrushDynamics {
  readonly size: NormalizedBrushParameterDynamics;
  readonly opacity: NormalizedBrushParameterDynamics;
  readonly hasTiltRotation: boolean;
}
