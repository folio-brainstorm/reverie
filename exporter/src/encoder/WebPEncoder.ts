import {
  DEFAULT_WEBP_LOSSLESS,
  DEFAULT_WEBP_QUALITY,
  WEBP_EXTENSION,
  WEBP_MIME_TYPE,
} from "../config/encoder/EncoderConstants.js";
import type { EncodedImage } from "../interfaces/encoder/EncodedImage.js";
import type { ImageEncoder } from "../interfaces/encoder/ImageEncoder.js";
import type { WebPEncodeOptions } from "../interfaces/encoder/WebPEncodeOptions.js";
import type { ExportResult } from "../interfaces/renderer/ExportResult.js";

import { createEncodingFailure } from "./internal/diagnostic/CreateEncodingFailure.js";
import { encodeWebpBytes } from "./internal/format/EncodeWebpBytes.js";
import { assertEncodableImage } from "./internal/image/AssertEncodableImage.js";
import { resolveBooleanOption } from "./internal/option/ResolveBooleanOption.js";
import { resolveNormalizedQuality } from "./internal/option/ResolveNormalizedQuality.js";

/**
 * Encodes dense RGBA8 bitmaps as WebP files.
 *
 * The encoder is stateless and read-only. Encoding is lossless by default,
 * which reproduces the alpha channel exactly; requesting lossy output trades
 * that alpha channel for a smaller file, because the lossy WebP bitstream has
 * no way to carry it.
 *
 * @example
 * const image = await new WebPEncoder().encode(bitmap, {
 *   lossless: false,
 *   quality: 0.9,
 * });
 * image.extension; // => "webp"
 */
export class WebPEncoder implements ImageEncoder<WebPEncodeOptions> {
  /**
   * Encodes one bitmap as a WebP file.
   *
   * @param image - Dense RGBA8 bitmap, normally produced by an export pass.
   * @param options - Optional lossless mode and lossy quality.
   * @returns The WebP bytes with the `image/webp` media type and `webp`
   * extension.
   * @throws {ExporterTypeError} The bitmap is not an object with numeric
   * dimensions and a `Uint8ClampedArray` pixel buffer, or an option has the
   * wrong type.
   * @throws {ExporterRangeError} A dimension, the pixel buffer length, or the
   * quality is outside the supported range.
   * @throws {ExporterError} The WebP backend failed to produce a file.
   */
  async encode(
    image: ExportResult,
    options?: WebPEncodeOptions,
  ): Promise<EncodedImage> {
    assertEncodableImage(image);

    const lossless = resolveBooleanOption(
      options?.lossless,
      "lossless",
      DEFAULT_WEBP_LOSSLESS,
    );
    const quality = resolveNormalizedQuality(
      options?.quality,
      "quality",
      DEFAULT_WEBP_QUALITY,
    );

    try {
      return {
        data: encodeWebpBytes(image, quality, lossless),
        mimeType: WEBP_MIME_TYPE,
        extension: WEBP_EXTENSION,
      };
    } catch (cause) {
      throw createEncodingFailure("webp", cause);
    }
  }
}
