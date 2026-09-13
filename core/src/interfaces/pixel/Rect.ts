/**
 * An axis-aligned rectangle represented by its top-left corner and dimensions.
 *
 * Covered coordinates use half-open bounds: `[x, x + width)` and
 * `[y, y + height)`.
 */
export interface Rect {
  /** Horizontal coordinate of the left edge. */
  x: number;

  /** Vertical coordinate of the top edge. */
  y: number;

  /** Horizontal extent in coordinate units. */
  width: number;

  /** Vertical extent in coordinate units. */
  height: number;
}
