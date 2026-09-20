/** Deterministic per-stamp variation supported by a PixelBrush. */
export interface PixelBrushJitter {
  /** Symmetric size multiplier amplitude; the final footprint is rounded. */
  readonly size?: number;

  /** Symmetric opacity multiplier amplitude, clamped to `[0, 1]` afterward. */
  readonly opacity?: number;

  /** Symmetric multiplier amplitude applied to the outgoing stamp interval. */
  readonly spacing?: number;
}
