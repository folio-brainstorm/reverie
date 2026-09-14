/**
 * Describes the immutable, half-open pixel region owned by a finite World.
 *
 * The covered coordinates are `[x, x + width)` and `[y, y + height)`.
 */
export interface WorldBounds {
  /** Inclusive world-pixel X origin. */
  readonly x: number;

  /** Inclusive world-pixel Y origin. */
  readonly y: number;

  /** Positive width in world pixels. */
  readonly width: number;

  /** Positive height in world pixels. */
  readonly height: number;
}
