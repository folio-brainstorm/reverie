/** Exact binary value used only when a polygon boundary comparison is ambiguous. */
export interface PolygonExactNumber {
  readonly coefficient: bigint;
  readonly exponent: number;
}
