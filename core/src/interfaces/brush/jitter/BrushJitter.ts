/** Independent per-stamp variation applied after brush dynamics. */
export interface BrushJitter {
  /** Maximum additive angular offset in radians. Defaults to `0`. */
  readonly rotation?: number;

  /** Symmetric size multiplier amplitude; ratios above `1` may yield zero. */
  readonly size?: number;

  /** Symmetric opacity multiplier amplitude, clamped to `[0, 1]` afterward. */
  readonly opacity?: number;

  /** Symmetric multiplier amplitude applied to the outgoing stamp interval. */
  readonly spacing?: number;
}
