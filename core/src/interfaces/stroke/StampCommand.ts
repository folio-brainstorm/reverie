import type { WorldPoint } from "../camera/WorldPoint.js";

/**
 * Describes one brush stamp waiting to be executed by an external consumer.
 *
 * {@link Stroke} always resolves and populates every input attribute. They stay
 * optional so commands assembled by hand, such as in tests or custom replay
 * code, remain valid without supplying dynamics they do not model.
 */
export interface StampCommand {
  /** Stable world-space snapshot at which the current stroke brush should stamp. */
  readonly position: WorldPoint;

  /** Path time interpolated at this stamp; populated by {@link Stroke}. */
  readonly timestamp?: number;

  /** Normalized pressure interpolated at this stamp; populated by {@link Stroke}. */
  readonly pressure?: number;

  /** Pen tilt around the X axis in degrees; populated by {@link Stroke}. */
  readonly tiltX?: number;

  /** Pen tilt around the Y axis in degrees; populated by {@link Stroke}. */
  readonly tiltY?: number;

  /**
   * Speed from the preceding actual stamp in world units per millisecond.
   * The first stamp and a non-positive time delta resolve to `0`.
   */
  readonly velocity?: number;
}
