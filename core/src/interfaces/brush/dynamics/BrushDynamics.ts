import type { BrushParameterDynamics } from "./BrushParameterDynamics.js";
import type { RotationDynamics } from "./RotationDynamics.js";

/** Per-brush mappings from stamp input to resolved execution parameters. */
export interface BrushDynamics {
  /** Mappings that scale the configured base brush size. */
  readonly size?: BrushParameterDynamics;

  /** Mappings that scale the configured base brush opacity. */
  readonly opacity?: BrushParameterDynamics;

  /** Mappings that offset the configured base brush rotation. */
  readonly rotation?: RotationDynamics;
}
