import { ExporterErrorDefinitions } from "../../../errors/ExporterErrorDefinitions.js";
import { ExporterError } from "../../../errors/ExporterErrors.js";
import type { BufferShim } from "../../../interfaces/encoder/BufferShim.js";

/**
 * Throws unless the runtime exposes the global `Buffer` the JPEG backend needs.
 *
 * The check runs before any encoding work, so callers learn about the missing
 * global from a stable Exporter code instead of a backend `ReferenceError`.
 *
 * @throws {ExporterError} The global `Buffer` is `undefined`, which means
 * `JPEGEncoder.installJpegJsBufferShim()` was never called in a runtime that
 * does not provide one.
 *
 * @example
 * assertJpegJsBufferAvailable();
 * const bytes = encodeJpegBytes(image, 0.92, background);
 */
export function assertJpegJsBufferAvailable(): void {
  const host = globalThis as { Buffer?: BufferShim };

  if (host.Buffer === undefined) {
    throw ExporterError.from(
      ExporterErrorDefinitions.MISSING_JPEG_BACKEND_BUFFER,
    );
  }
}
