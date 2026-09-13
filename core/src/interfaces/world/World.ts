import type { DiagnosticReporter } from "../diagnostic/Diagnostic.js";

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

  /** Receives non-fatal diagnostics. Defaults to the console reporter. */
  reporter?: DiagnosticReporter;
}
