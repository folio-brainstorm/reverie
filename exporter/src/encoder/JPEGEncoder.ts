import {
  DEFAULT_JPEG_QUALITY,
  JPEG_EXTENSION,
  JPEG_MIME_TYPE,
  OPAQUE_WHITE_RGBA,
} from "../config/encoder/EncoderConstants.js";
import type { EncodedImage } from "../interfaces/encoder/EncodedImage.js";
import type { ImageEncoder } from "../interfaces/encoder/ImageEncoder.js";
import type { JPEGEncodeOptions } from "../interfaces/encoder/JPEGEncodeOptions.js";
import type { ExportResult } from "../interfaces/renderer/ExportResult.js";

import { assertJpegJsBufferAvailable } from "./internal/compat/AssertJpegJsBufferAvailable.js";
import { installJpegJsBufferShim as installJpegJsBufferGlobal } from "./internal/compat/InstallJpegJsBufferShim.js";
import { createEncodingFailure } from "./internal/diagnostic/CreateEncodingFailure.js";
import { encodeJpegBytes } from "./internal/format/EncodeJpegBytes.js";
import { assertEncodableImage } from "./internal/image/AssertEncodableImage.js";
import { resolveNormalizedQuality } from "./internal/option/ResolveNormalizedQuality.js";
import { resolveOpaqueBackground } from "./internal/option/ResolveOpaqueBackground.js";

/**
 * Encodes dense RGBA8 bitmaps as baseline JPEG files.
 *
 * The encoder is stateless and read-only. JPEG carries no alpha channel, so
 * transparent pixels are composited over an opaque background before encoding;
 * the default background is opaque white and the bitmap itself is never
 * modified.
 *
 * The bundled `jpeg-js` backend needs a global `Buffer`. Runtimes that provide
 * one, such as Node.js, work out of the box; every other runtime must call
 * `JPEGEncoder.installJpegJsBufferShim()` once, otherwise `encode()` throws a
 * coded error.
 *
 * @example
 * JPEGEncoder.installJpegJsBufferShim();
 * const image = await new JPEGEncoder().encode(bitmap, {
 *   quality: 0.9,
 *   background: { r: 0, g: 0, b: 0, a: 255 },
 * });
 * image.extension; // => "jpg"
 */
export class JPEGEncoder implements ImageEncoder<JPEGEncodeOptions> {
  /**
   * Installs the global `Buffer` the bundled `jpeg-js` encoder requires.
   *
   * `jpeg-js` is published as CommonJS and finishes by calling the bare global
   * `Buffer`, which a bundler resolves to the Node branch even in a browser.
   * Runtimes that already provide `Buffer`, such as Node.js and Electron, need
   * no call; everywhere else JPEG encoding throws a coded error until this
   * method runs.
   *
   * The call is idempotent and never replaces an existing `Buffer`.
   *
   * @example
   * JPEGEncoder.installJpegJsBufferShim();
   * const image = await new JPEGEncoder().encode(bitmap);
   */
  static installJpegJsBufferShim(): void {
    installJpegJsBufferGlobal();
  }

  /**
   * Encodes one bitmap as a JPEG file.
   *
   * @param image - Dense RGBA8 bitmap, normally produced by an export pass.
   * @param options - Optional quality and compositing background.
   * @returns The JPEG bytes with the `image/jpeg` media type and `jpg`
   * extension.
   * @throws {ExporterTypeError} The bitmap is not an object with numeric
   * dimensions and a `Uint8ClampedArray` pixel buffer, or the quality or
   * background has the wrong type.
   * @throws {ExporterRangeError} A dimension, the pixel buffer length, or the
   * quality is outside the supported range, or the background is not fully
   * opaque.
   * @throws {ExporterError} The runtime provides no global `Buffer` and
   * `JPEGEncoder.installJpegJsBufferShim()` was never called, or the JPEG
   * backend failed to produce a file.
   */
  async encode(
    image: ExportResult,
    options?: JPEGEncodeOptions,
  ): Promise<EncodedImage> {
    assertEncodableImage(image);

    const quality = resolveNormalizedQuality(
      options?.quality,
      "quality",
      DEFAULT_JPEG_QUALITY,
    );
    const background = resolveOpaqueBackground(
      options?.background,
      "background",
      OPAQUE_WHITE_RGBA,
    );

    // Checked before the `try`, so the environment precondition surfaces with
    // its own code instead of being rewrapped as a generic encoding failure.
    assertJpegJsBufferAvailable();

    try {
      return {
        data: encodeJpegBytes(image, quality, background),
        mimeType: JPEG_MIME_TYPE,
        extension: JPEG_EXTENSION,
      };
    } catch (cause) {
      throw createEncodingFailure("jpeg", cause);
    }
  }
}
