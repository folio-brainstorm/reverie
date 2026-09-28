import type { PaintMode } from "../../interfaces/paint/PaintMode.js";
import type { Raster } from "../../core/raster/Raster.js";

import { MAX_CHANNEL_VALUE } from "../../config/color/RgbaChannelConstants.js";
import {
  getExistingRasterTileForTrustedWrite,
  getOrCreateRasterTileForTrustedWrite,
  getTilePixelBufferForTrustedWrite,
  markTrustedTilePixelWritten,
} from "../../core/rendering/bridge/RasterRenderBridge.js";
import { isRasterPixelWritable } from "../paint-target/ActiveRasterPaintBounds.js";
import { blendSourceOverChannel } from "../color/BlendSourceOverChannel.js";
import { roundAndClampChannel } from "../color/RoundAndClampChannel.js";

/**
 * Applies one trusted Brush stamp pixel as Source Over paint or destructive erase.
 *
 * @param raster - Sparse raster receiving the operation.
 * @param pixelX - Safe-integer world pixel X coordinate.
 * @param pixelY - Safe-integer world pixel Y coordinate.
 * @param paintMode - Operation selected by the enclosing drawing command.
 * @param sourceRed - Validated source red byte, ignored by erase.
 * @param sourceGreen - Validated source green byte, ignored by erase.
 * @param sourceBlue - Validated source blue byte, ignored by erase.
 * @param sourceAlphaByte - Validated source alpha byte, ignored by erase.
 * @param sourceAlpha - Normalized source alpha, ignored by erase.
 * @param eraseAmount - Normalized alpha fraction removed by erase, ignored by paint.
 */
export function writeRasterStampPixel(
  raster: Raster,
  pixelX: number,
  pixelY: number,
  paintMode: PaintMode,
  sourceRed: number,
  sourceGreen: number,
  sourceBlue: number,
  sourceAlphaByte: number,
  sourceAlpha: number,
  eraseAmount: number,
): void {
  if (!isRasterPixelWritable(raster, pixelX, pixelY)) {
    return;
  }

  if (paintMode === "paint" && sourceAlphaByte === 0) {
    return;
  }
  if (paintMode === "erase" && eraseAmount === 0) {
    return;
  }

  const tileSize = raster.tileSize;
  const tileX = Math.floor(pixelX / tileSize);
  const tileY = Math.floor(pixelY / tileSize);
  const localX = pixelX - tileX * tileSize;
  const localY = pixelY - tileY * tileSize;
  const tile =
    paintMode === "paint"
      ? getOrCreateRasterTileForTrustedWrite(raster, tileX, tileY)
      : getExistingRasterTileForTrustedWrite(raster, tileX, tileY);
  if (tile === undefined) {
    return;
  }

  const pixels = getTilePixelBufferForTrustedWrite(tile);
  const offset = (localY * tileSize + localX) * 4;
  const destinationAlphaByte = pixels[offset + 3] ?? 0;

  if (paintMode === "erase") {
    if (destinationAlphaByte === 0) {
      return;
    }
    const remainingAlpha = roundAndClampChannel(
      destinationAlphaByte * (1 - eraseAmount),
    );
    if (remainingAlpha === destinationAlphaByte) {
      return;
    }
    pixels[offset + 3] = remainingAlpha;
    markTrustedTilePixelWritten(tile, localX, localY);
    return;
  }

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
  const outputAlpha = sourceAlpha + destinationAlpha * inverseSourceAlpha;
  const destinationWeight = destinationAlpha * inverseSourceAlpha;
  pixels[offset] = blendSourceOverChannel(
    sourceRed,
    pixels[offset] ?? 0,
    sourceAlpha,
    destinationWeight,
    outputAlpha,
  );
  pixels[offset + 1] = blendSourceOverChannel(
    sourceGreen,
    pixels[offset + 1] ?? 0,
    sourceAlpha,
    destinationWeight,
    outputAlpha,
  );
  pixels[offset + 2] = blendSourceOverChannel(
    sourceBlue,
    pixels[offset + 2] ?? 0,
    sourceAlpha,
    destinationWeight,
    outputAlpha,
  );
  pixels[offset + 3] = roundAndClampChannel(outputAlpha * MAX_CHANNEL_VALUE);
  markTrustedTilePixelWritten(tile, localX, localY);
}
