import type { Raster } from "../../core/raster/Raster.js";

import { writeRasterStampPixel } from "./WriteRasterStampPixel.js";

/**
 * Reduces one existing pixel's straight alpha without changing its RGB channels.
 *
 * This trusted hot path skips absent tiles and fully transparent destinations so
 * erase stamps never allocate storage merely to affect empty space.
 *
 * @param raster - Sparse raster whose existing pixel may be erased.
 * @param pixelX - Safe-integer world pixel X coordinate.
 * @param pixelY - Safe-integer world pixel Y coordinate.
 * @param eraseAmount - Non-zero normalized fraction to remove from destination alpha.
 */
export function eraseRasterPixelAlpha(
  raster: Raster,
  pixelX: number,
  pixelY: number,
  eraseAmount: number,
): void {
  writeRasterStampPixel(
    raster,
    pixelX,
    pixelY,
    "erase",
    0,
    0,
    0,
    0,
    0,
    eraseAmount,
  );
}
