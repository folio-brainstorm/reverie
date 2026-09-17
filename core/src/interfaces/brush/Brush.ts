import type { WorldPoint } from "../camera/WorldPoint.js";
import type { StampCommand } from "../stroke/StampCommand.js";
import type { Raster } from "../../core/raster/Raster.js";

/** Defines a brush model that can place one stamp in continuous world space. */
export interface Brush {
  /** Brush-defined primary stamp size measured in world units. */
  readonly size: number;

  /** Distance between stamps expressed as a proportion of {@link size}. */
  readonly spacing: number;

  /** Optional uint32 base seed; legacy brush implementations default to `0`. */
  readonly seed?: number;

  /**
   * Resolves the positive world-space distance from this stamp to the next.
   * Strokes use it when available so brush-specific dynamics and variation can
   * determine distribution; legacy brushes fall back to {@link size} and
   * {@link spacing}.
   *
   * @param input - Identity and interpolated input for the stamp that owns the
   * outgoing interval.
   * @returns A finite positive world-space placement interval.
   */
  resolveStampDistance?(input: StampCommand): number;

  /**
   * Paints one stamp into a raster at a continuous world position.
   *
   * @param raster - Sparse raster that receives the stamp.
   * @param position - Brush-defined stamp anchor in continuous world coordinates.
   * @param input - Optional dynamics input and deterministic seed/index context.
   */
  stamp(raster: Raster, position: WorldPoint, input?: StampCommand): void;
}
