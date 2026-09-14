/** Normalized stroke input resolved from one browser PointerEvent. */
export interface PointerStrokeInput {
  /** Normalized pressure in the inclusive range `[0, 1]`. */
  readonly pressure: number;

  /** Pen tilt around the X axis in degrees in the inclusive range `[-90, 90]`. */
  readonly tiltX: number;

  /** Pen tilt around the Y axis in degrees in the inclusive range `[-90, 90]`. */
  readonly tiltY: number;
}
