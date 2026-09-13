/** An axis-aligned rectangle in continuous world space. */
export interface WorldRect {
  /** World-space X coordinate of the rectangle's left edge. */
  x: number;

  /** World-space Y coordinate of the rectangle's top edge. */
  y: number;

  /** Rectangle width in world units. */
  width: number;

  /** Rectangle height in world units. */
  height: number;
}
