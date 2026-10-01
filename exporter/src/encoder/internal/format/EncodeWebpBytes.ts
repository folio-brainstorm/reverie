import encodeWebp from "@jsquash/webp/encode.js";

import type { ExportResult } from "../../../interfaces/renderer/ExportResult.js";

import { initializeWebpEncoder } from "../compat/InitializeWebpEncoder.js";

/** Converts normalized quality onto libwebp's 0..100 scale. */
const BACKEND_QUALITY_SCALE = 100;

/**
 * Encodes a dense RGBA8 bitmap using the libwebp WASM backend.
 *
 * Pixels and dimensions are captured before asynchronous initialization so the
 * caller may reuse its bitmap while encoding is pending. Lossless output keeps
 * RGB values even in fully transparent pixels; both modes preserve alpha.
 *
 * @param image - Validated straight-alpha RGBA8 bitmap.
 * @param quality - Normalized lossy quality in the inclusive 0..1 range.
 * @param lossless - Whether to preserve all source channels exactly.
 * @returns Owned bytes containing a complete WebP file.
 * @throws If WASM initialization or libwebp encoding fails.
 *
 * @example
 * const bytes = await encodeWebpBytes(image, 0.92, true);
 * String.fromCharCode(...bytes.subarray(0, 4)); // => "RIFF"
 */
export async function encodeWebpBytes(
  image: ExportResult,
  quality: number,
  lossless: boolean,
): Promise<Uint8Array> {
  const { width, height } = image;
  const pixels = new Uint8ClampedArray(image.pixels);

  await initializeWebpEncoder();
  const encoded = await encodeWebp(
    { data: pixels, width, height, colorSpace: "srgb" },
    {
      lossless: lossless ? 1 : 0,
      exact: 1,
      alpha_quality: 100,
      ...(!lossless ? { quality: quality * BACKEND_QUALITY_SCALE } : {}),
    },
  );
  return new Uint8Array(encoded);
}
