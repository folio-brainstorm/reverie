import { ENCODER_FORMAT_LABELS } from "../../../config/encoder/EncoderConstants.js";
import { ExporterErrorDefinitions } from "../../../errors/ExporterErrorDefinitions.js";
import { ExporterError } from "../../../errors/ExporterErrors.js";
import type { ExportFormat } from "../../../interfaces/encoder/ExportFormat.js";

/**
 * Builds the coded failure reported when a format backend cannot encode.
 *
 * The original backend failure is attached as the error's `cause`, so callers
 * can inspect the codec-specific failure while still branching on the stable
 * Exporter code.
 *
 * @param format - Format identifier used in the diagnostic message.
 * @param cause - Value thrown by the backend.
 * @returns A coded Exporter error carrying the backend failure as its cause.
 *
 * @example
 * try {
 *   return encodePngBytes(image, level);
 * } catch (cause) {
 *   throw createEncodingFailure("png", cause);
 * }
 */
export function createEncodingFailure(
  format: ExportFormat,
  cause: unknown,
): ExporterError {
  const error = ExporterError.from(ExporterErrorDefinitions.ENCODING_FAILED, {
    format: ENCODER_FORMAT_LABELS[format],
  });

  error.cause = cause;

  return error;
}
