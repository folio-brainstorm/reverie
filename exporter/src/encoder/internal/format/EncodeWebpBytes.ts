import { encode as encodeWebp } from "@stacksjs/ts-webp";

import type { ExportResult } from "../../../interfaces/renderer/ExportResult.js";

/** Divisor that converts normalized quality onto the backend's integer scale. */
const BACKEND_QUALITY_SCALE = 100;

/** Forces the backend onto its pure-TypeScript codec instead of a CLI process. */
const PURE_TYPESCRIPT_BACKEND = "pure-ts";

/**
 * Serializes a dense RGBA8 bitmap as a WebP file.
 *
 * The bitmap is handed to the backend as a zero-copy byte view because the
 * backend only ever reads it, and its alpha channel is declared so that
 * lossless output reproduces transparency exactly. Lossy output cannot carry
 * alpha and therefore flattens transparent pixels onto their stored color.
 *
 * @param image - Validated RGBA8 bitmap to encode.
 * @param quality - Normalized quality used by the lossy path.
 * @param lossless - Whether to request lossless output.
 * @returns A fresh WebP file as bytes.
 *
 * @example
 * const bytes = encodeWebpBytes(image, 0.92, true);
 * String.fromCharCode(...bytes.subarray(0, 4)); // => "RIFF"
 */
export function encodeWebpBytes(
  image: ExportResult,
  quality: number,
  lossless: boolean,
): Uint8Array {
  return encodeWebp(
    {
      data: createReadOnlyByteView(image.pixels),
      width: image.width,
      height: image.height,
      hasAlpha: true,
    },
    {
      lossless,
      quality: Math.round(quality * BACKEND_QUALITY_SCALE),
      backend: PURE_TYPESCRIPT_BACKEND,
    },
  );
}

/**
 * Views the pixel buffer as bytes without copying it.
 *
 * RGBA8 pixels occupy one byte per channel in both array types, and the backend
 * treats the view as read-only, so the source bitmap is neither copied nor
 * modified. Writing through the view is deliberately not part of the contract.
 *
 * @param pixels - Source pixels owned by the caller.
 * @returns A byte view over the same memory.
 */
function createReadOnlyByteView(pixels: Uint8ClampedArray): Uint8Array {
  return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length);
}
