import type { Brush } from "../../interfaces/brush/Brush.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";
import type { LayerBlendMode } from "../../interfaces/world/LayerBlendMode.js";
import type { SelectionMask } from "../selection/SelectionMask.js";

import { RasterPaintTarget } from "../../internal/paint-target/RasterPaintTarget.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { Raster } from "../raster/Raster.js";
import { isLayerBlendMode } from "./IsLayerBlendMode.js";

/** Owns an unbounded Raster and applies its World's bounds while painting. */
export class RasterLayer {
  /** Descriptive metadata, independent of rendering. */
  private assignedName: string | undefined;

  /** Returns descriptive metadata, or the detached unnamed default. */
  get name(): string {
    return this.assignedName ?? "Layer";
  }

  /** Assigns a name explicitly, including the literal default or an empty name. */
  set name(value: string) {
    this.assignedName = value;
  }

  /** Whether a caller or World has assigned a name, independent of its text. */
  get hasAssignedName(): boolean {
    return this.assignedName !== undefined;
  }
  /** Whether this layer participates in composition. */
  visible: boolean = true;
  private currentOpacity = 1;
  private currentBlendMode: LayerBlendMode = "normal";

  /** Non-destructive composition opacity in the inclusive range [0, 1]. */
  get opacity(): number {
    return this.currentOpacity;
  }

  /**
   * Changes composition opacity without rewriting Raster pixels.
   * @throws {ReverieRangeError} The value is not finite or lies outside [0, 1].
   */
  set opacity(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw ReverieRangeError.from(
        ErrorDefinitions.WORLD.INVALID_LAYER_OPACITY,
      );
    }
    this.currentOpacity = value;
  }

  /** Blend operation used when this layer is composed into its World. */
  get blendMode(): LayerBlendMode {
    return this.currentBlendMode;
  }

  /**
   * Changes composition mode without rewriting Raster pixels.
   * @throws {ReverieTypeError} The value is not a supported blend mode.
   */
  set blendMode(value: LayerBlendMode) {
    if (!isLayerBlendMode(value)) {
      throw ReverieTypeError.from(
        ErrorDefinitions.WORLD.INVALID_LAYER_BLEND_MODE,
      );
    }
    this.currentBlendMode = value;
  }
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
   * @param selection - Optional transient coverage mask independent of this Layer.
   */
  stamp(
    brush: Brush,
    position: WorldPoint,
    input?: StampCommand,
    selection: SelectionMask | null = null,
  ): void {
    this.paintTarget.stamp(brush, position, input, selection);
  }
}
