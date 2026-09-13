/**
 * Determines whether a value can be used as a circle radius.
 *
 * A radius is valid when it is finite and not negative, so `0` is accepted as
 * a degenerate circle while negative values, `NaN`, and both infinities are
 * rejected. Fractional radii are allowed; this check does not require an
 * integer.
 *
 * @param radius - The runtime value to validate.
 * @returns Whether `radius` is a finite, non-negative number.
 * @example
 * isValidCircleRadius(12.5); // true
 * isValidCircleRadius(0); // true
 * isValidCircleRadius(-1); // false
 * isValidCircleRadius(Number.POSITIVE_INFINITY); // false
 */
export function isValidCircleRadius(radius: unknown): radius is number {
  return typeof radius === "number" && Number.isFinite(radius) && radius >= 0;
}
