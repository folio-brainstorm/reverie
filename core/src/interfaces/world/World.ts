import type { DiagnosticReporter } from "../diagnostic/Diagnostic.js";
import type { WorldBounds } from "./WorldBounds.js";

/**
 * Options controlling world coordinate conversion and diagnostic reporting.
 */
export interface WorldConfig {
  /**
   * Width and height, in pixels, of each square tile.
   *
   * The value must be a positive safe integer. When omitted, the current
   * `defaultWorldConfig.tileSize` is used.
   *
   * @default 256
   */
  tileSize?: number;

  /**
   * Optional finite document region. `null` or omission creates an unbounded
   * World. Every component must be a safe integer and dimensions are positive.
   */
  bounds?: WorldBounds | null;

  /** Receives non-fatal diagnostics. Defaults to the console reporter. */
  reporter?: DiagnosticReporter;
}
