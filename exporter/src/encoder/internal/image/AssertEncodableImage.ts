import { ExporterErrorDefinitions } from "../../../errors/ExporterErrorDefinitions.js";
import {
  ExporterRangeError,
  ExporterTypeError,
} from "../../../errors/ExporterErrors.js";
import type { ExportResult } from "../../../interfaces/renderer/ExportResult.js";

import { describeCandidate } from "../diagnostic/DescribeCandidate.js";

/** Bytes occupied by one straight-alpha RGBA8 pixel. */
const RGBA_CHANNEL_COUNT = 4;

/**
 * Verifies that a value is a well-formed RGBA8 bitmap that every built-in
 * encoder can consume.
 *
 * The input is treated as untrusted, because an `ExportResult` may be
 * constructed by hand rather than produced by the export renderer. Every check
 * runs before a backend allocates or reads anything, so unusable input fails
 * with a stable coded error instead of a native one.
 *
 * @param image - Candidate bitmap to validate.
 * @throws {ExporterTypeError} `image` is not an object with `width`, `height`,
 * and `pixels`, a dimension is not a number, or `pixels` is not a
 * `Uint8ClampedArray`.
 * @throws {ExporterRangeError} A dimension is not a positive safe integer, the
 * derived byte length is not safely representable, or the pixel buffer length
 * does not match the declared dimensions.
 *
 * @example
 * assertEncodableImage({
 *   width: 2,
 *   height: 1,
 *   pixels: new Uint8ClampedArray(8),
 * });
 */
export function assertEncodableImage(
  image: unknown,
): asserts image is ExportResult {
  if (typeof image !== "object" || image === null) {
    throw ExporterTypeError.from(ExporterErrorDefinitions.INVALID_IMAGE_TYPE, {
      received: describeCandidate(image),
    });
  }

  if (!("width" in image) || !("height" in image) || !("pixels" in image)) {
    throw ExporterTypeError.from(ExporterErrorDefinitions.INVALID_IMAGE_TYPE, {
      received: "an object without `width`, `height`, or `pixels`",
    });
  }

  const width = resolveDimension(image.width, "width");
  const height = resolveDimension(image.height, "height");
  const pixels = resolvePixelBuffer(image.pixels);

  assertSizeWithinSafeRange(width, height);
  assertPixelBufferLength(pixels, width, height);
}

/**
 * Validates one bitmap dimension from an untrusted source.
 *
 * @param value - Candidate extent in pixels.
 * @param param - Field name used in the error message.
 * @returns The extent once it is a positive safe integer.
 * @throws {ExporterTypeError} `value` is not a number.
 * @throws {ExporterRangeError} `value` is not a positive safe integer.
 */
function resolveDimension(value: unknown, param: string): number {
  if (typeof value !== "number") {
    throw ExporterTypeError.from(
      ExporterErrorDefinitions.INVALID_IMAGE_FIELD_TYPE,
      { param, received: typeof value },
    );
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.INVALID_IMAGE_DIMENSION,
      { param, received: value },
    );
  }

  return value;
}

/**
 * Validates the pixel buffer from an untrusted source.
 *
 * @param value - Candidate pixel buffer.
 * @returns The buffer once it is a `Uint8ClampedArray`.
 * @throws {ExporterTypeError} `value` is not a `Uint8ClampedArray`.
 */
function resolvePixelBuffer(value: unknown): Uint8ClampedArray {
  if (!(value instanceof Uint8ClampedArray)) {
    throw ExporterTypeError.from(
      ExporterErrorDefinitions.INVALID_IMAGE_PIXELS_TYPE,
      { received: describeCandidate(value) },
    );
  }

  return value;
}

/**
 * Rejects dimensions whose derived pixel count or byte length is no longer a
 * safe integer.
 *
 * The check runs before the expected buffer length is computed, so an
 * unusable bitmap never produces a misleading length error.
 *
 * @param width - Validated horizontal extent.
 * @param height - Validated vertical extent.
 * @throws {ExporterRangeError} A derived value is not a safe integer.
 */
function assertSizeWithinSafeRange(width: number, height: number): void {
  const pixelCount = width * height;
  const byteLength = pixelCount * RGBA_CHANNEL_COUNT;

  if (!Number.isSafeInteger(pixelCount) || !Number.isSafeInteger(byteLength)) {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.IMAGE_EXCEEDS_SAFE_RANGE,
      { width, height },
    );
  }
}

/**
 * Rejects a pixel buffer whose length disagrees with the declared dimensions.
 *
 * Both undersized and oversized buffers are rejected, because either one means
 * the caller and the encoder disagree about the image layout.
 *
 * @param pixels - Validated pixel buffer.
 * @param width - Validated horizontal extent.
 * @param height - Validated vertical extent.
 * @throws {ExporterRangeError} The buffer length is not `width * height * 4`.
 */
function assertPixelBufferLength(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const expected = width * height * RGBA_CHANNEL_COUNT;

  if (pixels.length !== expected) {
    throw ExporterRangeError.from(
      ExporterErrorDefinitions.INVALID_IMAGE_PIXELS_LENGTH,
      { width, height, expected, received: pixels.length },
    );
  }
}
