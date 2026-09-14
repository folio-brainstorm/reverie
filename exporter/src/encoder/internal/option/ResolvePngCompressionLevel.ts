import {
  DEFAULT_PNG_COMPRESSION_LEVEL,
  MAX_PNG_COMPRESSION_LEVEL,
  MIN_PNG_COMPRESSION_LEVEL,
} from "../../../config/encoder/EncoderConstants.js";
import { ExporterErrorDefinitions } from "../../../errors/ExporterErrorDefinitions.js";
import {
  ExporterRangeError,
  ExporterTypeError,
} from "../../../errors/ExporterErrors.js";
import type { PNGCompressionLevel } from "../../../interfaces/encoder/PNGCompressionLevel.js";

/**
 * Validates an optional PNG compression level and applies the default.
 *
 * @param value - Candidate deflate level, or `undefined` to accept the default.
 * @returns The validated deflate level, or the encoder default.
 * @throws {ExporterTypeError} `value` is defined but not a number.
 * @throws {ExporterRangeError} `value` is not an integer in the inclusive range
 * from `0` to `9`.
 *
 * @example
 * resolvePngCompressionLevel(undefined); // => 6
 * resolvePngCompressionLevel(0); // => 0
 */
export function resolvePngCompressionLevel(
  value: unknown,
): PNGCompressionLevel {
  if (value === undefined) {
    return DEFAULT_PNG_COMPRESSION_LEVEL;
  }

  if (typeof value !== "number") {
    throw ExporterTypeError.from(
      ExporterErrorDefinitions.INVALID_ENCODER_COMPRESSION_LEVEL,
      { param: "compressionLevel", received: typeof value },
    );
  }

  if (!isCompressionLevel(value)) {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.INVALID_ENCODER_COMPRESSION_LEVEL,
      { param: "compressionLevel", received: value },
    );
  }

  return value;
}

/**
 * Narrows a number to the deflate levels accepted by the encoder.
 *
 * @param value - Candidate deflate level.
 * @returns Whether the value is an integer the backend understands.
 */
function isCompressionLevel(value: number): value is PNGCompressionLevel {
  return (
    Number.isInteger(value) &&
    value >= MIN_PNG_COMPRESSION_LEVEL &&
    value <= MAX_PNG_COMPRESSION_LEVEL
  );
}
