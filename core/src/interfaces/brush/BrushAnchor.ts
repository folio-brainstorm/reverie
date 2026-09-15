/** Normalized point on a brush image placed at each stamp position. */
export interface BrushAnchor {
  /** Horizontal position from the left edge in the inclusive range `[0, 1]`. */
  readonly x: number;

  /** Vertical position from the top edge in the inclusive range `[0, 1]`. */
  readonly y: number;
}
