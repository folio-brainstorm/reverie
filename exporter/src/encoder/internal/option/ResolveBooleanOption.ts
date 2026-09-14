import { ExporterErrorDefinitions } from "../../../errors/ExporterErrorDefinitions.js";
import { ExporterTypeError } from "../../../errors/ExporterErrors.js";

/**
 * Validates an optional boolean option and applies the default.
 *
 * @param value - Candidate option value, or `undefined` to accept the default.
 * @param param - Option name used in the error message.
 * @param fallback - Value used when `value` is `undefined`.
 * @returns The validated boolean, or `fallback`.
 * @throws {ExporterTypeError} `value` is defined but not a boolean.
 *
 * @example
 * resolveBooleanOption(undefined, "lossless", true); // => true
 * resolveBooleanOption(false, "lossless", true); // => false
 */
export function resolveBooleanOption(
  value: unknown,
  param: string,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw ExporterTypeError.from(
      ExporterErrorDefinitions.INVALID_ENCODER_BOOLEAN_OPTION,
      { param, received: typeof value },
    );
  }

  return value;
}
