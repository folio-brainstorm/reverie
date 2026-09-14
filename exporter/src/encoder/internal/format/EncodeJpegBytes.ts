import type { RGBAColor } from "@reverie/core";
import { encode as encodeJpeg } from "jpeg-js";

import {
  MAX_CHANNEL_VALUE,
  OPAQUE_ALPHA,
} from "../../../config/encoder/EncoderConstants.js";
import type { ExportResult } from "../../../interfaces/renderer/ExportResult.js";

/** Bytes occupied by one straight-alpha RGBA8 pixel. */
const RGBA_CHANNEL_COUNT = 4;

/** Divisor that converts normalized quality onto the backend's integer scale. */
const BACKEND_QUALITY_SCALE = 100;

/** Lowest quality the backend accepts. */
const MIN_BACKEND_QUALITY = 1;

/** Highest quality the backend accepts. */
const MAX_BACKEND_QUALITY = 100;

/**
 * Serializes a dense RGBA8 bitmap as a baseline JPEG file.
 *
 * JPEG has no alpha channel and the backend reads only the color channels, so
 * the bitmap is first composited over an opaque background into a private
 * buffer. The source bitmap is never modified.
 *
 * @param image - Validated RGBA8 bitmap to encode.
 * @param quality - Normalized quality in the inclusive `0..1` range.
 * @param background - Fully opaque color placed behind transparent pixels.
 * @returns A fresh JPEG file as bytes.
 *
 * @example
 * const bytes = encodeJpegBytes(image, 0.92, {
 *   r: 255,
 *   g: 255,
 *   b: 255,
 *   a: 255,
 * });
 * bytes[0]; // => 0xff, the JPEG start-of-image marker
 */
export function encodeJpegBytes(
  image: ExportResult,
  quality: number,
  background: RGBAColor,
): Uint8Array {
  const flattened = flattenOntoBackground(image, background);
  const encoded = encodeJpeg(
    { data: flattened, width: image.width, height: image.height },
    toBackendQuality(quality),
  );

  return new Uint8Array(encoded.data);
}

/**
 * Composites the bitmap over an opaque background into a private RGBA buffer.
 *
 * The backend reads the color channels with a four-byte stride, so the result
 * keeps the RGBA layout while forcing every alpha byte to fully opaque. Handing
 * the backend the source buffer directly would discard the background, because
 * it ignores alpha instead of compositing.
 *
 * @param image - Validated RGBA8 bitmap.
 * @param background - Fully opaque background color.
 * @returns A newly allocated opaque RGBA8 buffer owned by the caller.
 */
function flattenOntoBackground(
  image: ExportResult,
  background: RGBAColor,
): Uint8Array {
  const { pixels } = image;
  const flattened = new Uint8Array(pixels.length);

  for (let offset = 0; offset < pixels.length; offset += RGBA_CHANNEL_COUNT) {
    const alpha = pixels[offset + 3] ?? 0;

    if (alpha === OPAQUE_ALPHA) {
      flattened[offset] = pixels[offset] ?? 0;
      flattened[offset + 1] = pixels[offset + 1] ?? 0;
      flattened[offset + 2] = pixels[offset + 2] ?? 0;
    } else if (alpha === 0) {
      flattened[offset] = background.r;
      flattened[offset + 1] = background.g;
      flattened[offset + 2] = background.b;
    } else {
      const sourceAlpha = alpha / MAX_CHANNEL_VALUE;
      const inverseSourceAlpha = 1 - sourceAlpha;

      flattened[offset] = compositeChannel(
        pixels[offset] ?? 0,
        background.r,
        sourceAlpha,
        inverseSourceAlpha,
      );
      flattened[offset + 1] = compositeChannel(
        pixels[offset + 1] ?? 0,
        background.g,
        sourceAlpha,
        inverseSourceAlpha,
      );
      flattened[offset + 2] = compositeChannel(
        pixels[offset + 2] ?? 0,
        background.b,
        sourceAlpha,
        inverseSourceAlpha,
      );
    }

    flattened[offset + 3] = OPAQUE_ALPHA;
  }

  return flattened;
}

/**
 * Composites one color channel over an opaque background.
 *
 * @param source - Source channel value in the inclusive `0..255` range.
 * @param destination - Background channel value in the inclusive `0..255` range.
 * @param sourceAlpha - Source alpha normalized to the inclusive `0..1` range.
 * @param inverseSourceAlpha - `1 - sourceAlpha`.
 * @returns The composited channel value in the inclusive `0..255` range.
 */
function compositeChannel(
  source: number,
  destination: number,
  sourceAlpha: number,
  inverseSourceAlpha: number,
): number {
  const composited = source * sourceAlpha + destination * inverseSourceAlpha;

  return Math.min(MAX_CHANNEL_VALUE, Math.max(0, Math.round(composited)));
}

/**
 * Converts normalized quality onto the integer scale the backend expects.
 *
 * Quality `0` maps onto the lowest quality the backend can express, so the
 * public scale never has to expose the backend's own bounds.
 *
 * @param quality - Normalized quality in the inclusive `0..1` range.
 * @returns The backend quality in the inclusive `1..100` range.
 */
function toBackendQuality(quality: number): number {
  const scaled = Math.round(quality * BACKEND_QUALITY_SCALE);

  return Math.min(MAX_BACKEND_QUALITY, Math.max(MIN_BACKEND_QUALITY, scaled));
}
