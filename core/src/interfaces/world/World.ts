import type { DiagnosticReporter } from "../diagnostic/Diagnostic.js";
import type { WorldBounds } from "./WorldBounds.js";
import type { RasterLayer } from "../../core/world/RasterLayer.js";

/**
 * Options controlling world coordinate conversion and diagnostic reporting.
 */
export interface WorldConfig {
  /**
   * Stable serializable document identity. Omission creates a new identifier.
   *
   * This belongs to the runtime document model rather than session state, so
   * future document hydration can preserve the envelope identity exactly.
   */
  id?: string;

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

  /**
   * Optional detached Layers used to establish a nonempty World without a
   * generated placeholder Layer. Their bounds and tile sizes must match this
   * World exactly.
   */
  initialLayers?: readonly RasterLayer[];

  /** Receives non-fatal diagnostics. Defaults to console reporting only in DEBUG builds. */
  reporter?: DiagnosticReporter;
}
