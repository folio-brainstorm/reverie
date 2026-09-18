import type { Raster } from "../../core/raster/Raster.js";

import { writeRasterStampPixel } from "./WriteRasterStampPixel.js";

/**
 * Blends a validated, non-transparent RGBA8 source into one safe world pixel.
 *
 * This trusted hot path performs no public-boundary validation or temporary
 * color allocation. Its arithmetic mirrors public straight-alpha Source Over.
 *
 * @param raster - Sparse raster receiving the source color.
 * @param pixelX - Safe-integer world pixel X coordinate.
 * @param pixelY - Safe-integer world pixel Y coordinate.
 * @param sourceRed - Validated source red channel.
 * @param sourceGreen - Validated source green channel.
 * @param sourceBlue - Validated source blue channel.
 * @param sourceAlphaByte - Validated non-zero source alpha byte.
 * @param sourceAlpha - Source alpha normalized to the inclusive `0..1` range.
 */
export function blendRasterPixelSourceOver(
  raster: Raster,
  pixelX: number,
  pixelY: number,
  sourceRed: number,
  sourceGreen: number,
  sourceBlue: number,
  sourceAlphaByte: number,
  sourceAlpha: number,
): void {
  writeRasterStampPixel(
    raster,
    pixelX,
    pixelY,
    "paint",
    sourceRed,
    sourceGreen,
    sourceBlue,
    sourceAlphaByte,
    sourceAlpha,
    0,
  );
}
