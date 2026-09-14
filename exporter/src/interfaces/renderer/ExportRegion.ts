/**
 * An axis-aligned region of world pixels selected for export.
 *
 * Covered coordinates use half-open bounds: `[x, x + width)` and
 * `[y, y + height)`. One world pixel maps to exactly one exported pixel, and
 * negative coordinates address world space to the left of or above the origin.
 */
export interface ExportRegion {
  /** Horizontal world-pixel coordinate of the left edge. */
  x: number;

  /** Vertical world-pixel coordinate of the top edge. */
  y: number;

  /** Horizontal extent in world pixels; must be a positive safe integer. */
  width: number;

  /** Vertical extent in world pixels; must be a positive safe integer. */
  height: number;
}
