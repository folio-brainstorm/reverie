import type { WorldPoint } from "../camera/WorldPoint.js";
import type { PaintMode } from "../paint/PaintMode.js";

/**
 * Describes one brush stamp waiting to be executed by an external consumer.
 *
 * {@link Stroke} resolves pressure, tilt, and velocity for every command, then
 * adds direction only when a preceding stamp provides real displacement. All
 * fields stay optional so hand-authored or legacy replay commands remain valid.
 */
export interface StampCommand {
  /** Stable world-space snapshot at which the current stroke brush should stamp. */
  readonly position: WorldPoint;

  /** Operation captured for this stamp; absent direct stamps default to paint. */
  readonly paintMode?: PaintMode;

  /** Final serializable uint32 seed shared by every command in this stroke. */
  readonly strokeSeed?: number;

  /** Stroke-local uint32 emission index, starting at `0`; unrelated to scheduling. */
  readonly stampIndex?: number;

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

  /**
   * World-space angle from the preceding actual stamp in radians.
   * The first stamp and zero-distance progression leave it unavailable.
   */
  readonly direction?: number;
}
