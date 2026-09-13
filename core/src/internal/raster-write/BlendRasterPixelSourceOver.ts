import type { Raster } from "../../core/raster/Raster.js";

import {
  getOrCreateRasterTileForTrustedWrite,
  getTilePixelBufferForTrustedWrite,
  markTrustedTilePixelWritten,
} from "../../core/renderer/RasterRenderBridge.js";

const MAX_CHANNEL_VALUE = 255;

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
  const tileSize = raster.tileSize;
  const tileX = Math.floor(pixelX / tileSize);
  const tileY = Math.floor(pixelY / tileSize);
  const localX = pixelX - tileX * tileSize;
  const localY = pixelY - tileY * tileSize;
  const tile = getOrCreateRasterTileForTrustedWrite(raster, tileX, tileY);
  const pixels = getTilePixelBufferForTrustedWrite(tile);
  const offset = (localY * tileSize + localX) * 4;
  const destinationAlphaByte = pixels[offset + 3] ?? 0;

  if (sourceAlphaByte === MAX_CHANNEL_VALUE || destinationAlphaByte === 0) {
    pixels[offset] = sourceRed;
    pixels[offset + 1] = sourceGreen;
    pixels[offset + 2] = sourceBlue;
    pixels[offset + 3] = sourceAlphaByte;
    markTrustedTilePixelWritten(tile, localX, localY);
    return;
  }

  const destinationAlpha = destinationAlphaByte / MAX_CHANNEL_VALUE;
  const inverseSourceAlpha = 1 - sourceAlpha;
  const outputAlpha =
    sourceAlpha + destinationAlpha * inverseSourceAlpha;
  const destinationWeight = destinationAlpha * inverseSourceAlpha;

  pixels[offset] = roundAndClampChannel(
    (sourceRed * sourceAlpha +
      (pixels[offset] ?? 0) * destinationWeight) /
      outputAlpha,
  );
  pixels[offset + 1] = roundAndClampChannel(
    (sourceGreen * sourceAlpha +
      (pixels[offset + 1] ?? 0) * destinationWeight) /
      outputAlpha,
  );
  pixels[offset + 2] = roundAndClampChannel(
    (sourceBlue * sourceAlpha +
      (pixels[offset + 2] ?? 0) * destinationWeight) /
      outputAlpha,
  );
  pixels[offset + 3] = roundAndClampChannel(
    outputAlpha * MAX_CHANNEL_VALUE,
  );
  markTrustedTilePixelWritten(tile, localX, localY);
}

/** Converts a computed channel to the same RGBA8 result as the public path. */
function roundAndClampChannel(channel: number): number {
  return Math.min(MAX_CHANNEL_VALUE, Math.max(0, Math.round(channel)));
}
