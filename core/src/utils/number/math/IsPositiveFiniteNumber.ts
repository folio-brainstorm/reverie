/**
 * Determines whether a value is a finite number greater than zero.
 *
 * @param value - Candidate size, spacing, or other positive scalar.
 * @returns Whether the value satisfies the positive finite constraint.
 */
export function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
