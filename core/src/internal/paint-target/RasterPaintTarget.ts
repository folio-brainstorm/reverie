import type { Brush } from "../../interfaces/brush/Brush.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";
import type { Raster } from "../../core/raster/Raster.js";

import { withRasterPaintBounds } from "./ActiveRasterPaintBounds.js";

/** Applies an optional document clip while keeping Raster storage unbounded. */
export class RasterPaintTarget {
  private readonly bounds: WorldBounds | null;

  /**
   * Creates a paint target over an existing unbounded Raster.
   *
   * @param raster - Raster receiving permitted brush writes.
   * @param bounds - Effective half-open write region, or `null` when infinite.
   */
  constructor(
    private readonly raster: Raster,
    bounds: WorldBounds | null,
  ) {
    this.bounds = bounds === null ? null : { ...bounds };
  }

  /**
   * Executes one Brush stamp under this target's clipping policy.
   *
   * @param brush - Brush implementation producing final pixel writes.
   * @param position - Continuous world-space stamp center.
   * @param input - Optional per-stamp input forwarded without interpretation.
   */
  stamp(brush: Brush, position: WorldPoint, input?: StampCommand): void {
    withRasterPaintBounds(this.raster, this.bounds, () => {
      brush.stamp(this.raster, position, input);
    });
  }
}
