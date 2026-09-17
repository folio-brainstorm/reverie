/**
 * Resolves an optional nonnegative finite amplitude with a caller-specific error.
 *
 * @param value - Optional configuration value to normalize.
 * @param parameterName - Context identifying the configured amplitude.
 * @param createInvalidValueError - Creates the stable error for an invalid value.
 * @returns Zero for an omitted value, otherwise the validated configured value.
 * @throws {ReverieRangeError} The supplied value is negative, nonnumeric, or non-finite.
 */
export function resolveNonnegativeFiniteAmplitude(
  value: unknown,
  parameterName: string,
  createInvalidValueError: (parameterName: string) => RangeError,
): number {
  if (value === undefined) {
    return 0;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw createInvalidValueError(parameterName);
  }

  return value;
}
