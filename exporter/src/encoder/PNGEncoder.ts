import {
  PNG_EXTENSION,
  PNG_MIME_TYPE,
} from "../config/encoder/EncoderConstants.js";
import type { EncodedImage } from "../interfaces/encoder/EncodedImage.js";
import type { ImageEncoder } from "../interfaces/encoder/ImageEncoder.js";
import type { PNGEncodeOptions } from "../interfaces/encoder/PNGEncodeOptions.js";
import type { ExportResult } from "../interfaces/renderer/ExportResult.js";

import { createEncodingFailure } from "./internal/diagnostic/CreateEncodingFailure.js";
import { encodePngBytes } from "./internal/format/EncodePngBytes.js";
import { assertEncodableImage } from "./internal/image/AssertEncodableImage.js";
import { resolvePngCompressionLevel } from "./internal/option/ResolvePngCompressionLevel.js";

/**
 * Encodes dense RGBA8 bitmaps as lossless PNG files.
 *
 * The encoder is stateless and read-only. It keeps no reference to the previous
 * bitmap, result, or options, so one instance may encode unrelated images
 * concurrently. Output is always lossless, and transparent pixels keep the
 * color channels they were exported with.
 *
 * @example
 * const image = await new PNGEncoder().encode({
 *   width: 1,
 *   height: 1,
 *   pixels: new Uint8ClampedArray([100, 150, 200, 0]),
 * });
 * image.mimeType; // => "image/png"
 */
export class PNGEncoder implements ImageEncoder<PNGEncodeOptions> {
  /**
   * Encodes one bitmap as a lossless PNG file.
   *
   * The bitmap is only read, and the returned bytes are a fresh allocation, so
   * the caller may keep or discard either independently.
   *
   * @param image - Dense RGBA8 bitmap, normally produced by an export pass.
   * @param options - Optional deflate compression settings.
   * @returns The PNG bytes with the `image/png` media type and `png` extension.
   * @throws {ExporterTypeError} The bitmap is not an object with numeric
   * dimensions and a `Uint8ClampedArray` pixel buffer.
   * @throws {ExporterRangeError} A dimension, the pixel buffer length, or the
   * compression level is outside the supported range.
   * @throws {ExporterError} The PNG backend failed to produce a file.
   */
  async encode(
    image: ExportResult,
    options?: PNGEncodeOptions,
  ): Promise<EncodedImage> {
    assertEncodableImage(image);

    const compressionLevel = resolvePngCompressionLevel(
      options?.compressionLevel,
    );

    try {
      return {
        data: encodePngBytes(image, compressionLevel),
        mimeType: PNG_MIME_TYPE,
        extension: PNG_EXTENSION,
      };
    } catch (cause) {
      throw createEncodingFailure("png", cause);
    }
  }
}
