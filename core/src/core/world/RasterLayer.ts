import type { Brush } from "../../interfaces/brush/Brush.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";

import { RasterPaintTarget } from "../../internal/paint-target/RasterPaintTarget.js";
import { Raster } from "../raster/Raster.js";

/** Owns an unbounded Raster and applies its World's bounds while painting. */
export class RasterLayer {
  /** Sparse pixel storage owned by this layer. */
  readonly raster: Raster;

  private readonly paintTarget: RasterPaintTarget;
  private readonly internalBounds: WorldBounds | null;

  /** Returns a defensive copy of this layer's effective World bounds. */
  get bounds(): WorldBounds | null {
    return this.internalBounds === null ? null : { ...this.internalBounds };
  }

  /**
   * Creates a layer for a World-owned Raster and clipping region.
   *
   * Applications normally obtain layers through {@link World.createRasterLayer}.
   *
   * @param raster - Unbounded sparse storage owned by the layer.
   * @param bounds - Effective World bounds, or `null` when unbounded.
   */
  constructor(raster: Raster, bounds: WorldBounds | null) {
    this.raster = raster;
    this.internalBounds = bounds === null ? null : { ...bounds };
    this.paintTarget = new RasterPaintTarget(raster, this.internalBounds);
  }

  /**
   * Paints one stamp while clipping final pixel writes to effective bounds.
   *
   * @param brush - Brush used to produce the stamp.
   * @param position - Continuous world-space stamp center.
   * @param input - Optional per-stamp input forwarded without interpretation.
   */
  stamp(brush: Brush, position: WorldPoint, input?: StampCommand): void {
    this.paintTarget.stamp(brush, position, input);
  }
}
