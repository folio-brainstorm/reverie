/**
 * Reports whether a value is a plain object record rather than an array or
 * runtime instance with behavior outside a serialized-data contract.
 *
 * @param value - Unknown value to classify.
 * @returns `true` only for objects whose direct prototype is `Object.prototype`.
 */
export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
