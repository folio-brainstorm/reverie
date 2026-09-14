/** Per-stamp values derived from immutable brush settings and input context. */
export interface ResolvedBrushParameters {
  /** Resolved non-negative stamp diameter in world units. */
  readonly size: number;

  /** Resolved stamp opacity in the inclusive range `[0, 1]`. */
  readonly opacity: number;

  /** Resolved stamp rotation in radians. */
  readonly rotation: number;
}
