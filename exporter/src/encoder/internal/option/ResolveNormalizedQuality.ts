import { ExporterErrorDefinitions } from "../../../errors/ExporterErrorDefinitions.js";
import {
  ExporterRangeError,
  ExporterTypeError,
} from "../../../errors/ExporterErrors.js";

/**
 * Validates an optional normalized quality value and applies the default.
 *
 * Quality is never clamped: a value outside the supported range is rejected so
 * that a caller cannot silently receive output at a different fidelity than the
 * one that was requested.
 *
 * @param value - Candidate quality, or `undefined` to accept the default.
 * @param param - Option name used in the error message.
 * @param fallback - Quality used when `value` is `undefined`.
 * @returns The validated quality, or `fallback`.
 * @throws {ExporterTypeError} `value` is defined but not a number.
 * @throws {ExporterRangeError} `value` is not a finite number in the inclusive
 * range from `0` to `1`.
 *
 * @example
 * resolveNormalizedQuality(undefined, "quality", 0.92); // => 0.92
 * resolveNormalizedQuality(0.5, "quality", 0.92); // => 0.5
 */
export function resolveNormalizedQuality(
  value: unknown,
  param: string,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number") {
    throw ExporterTypeError.from(
      ExporterErrorDefinitions.INVALID_ENCODER_QUALITY,
      { param, received: typeof value },
    );
  }

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.INVALID_ENCODER_QUALITY,
      { param, received: value },
    );
  }

  return value;
}
