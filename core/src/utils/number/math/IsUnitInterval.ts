/**
 * Determines whether a value is a finite number in the inclusive unit interval.
 *
 * @param value - Candidate opacity, coverage, or other normalized scalar.
 * @returns Whether the value lies in the inclusive range from zero to one.
 */
export function isUnitInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
