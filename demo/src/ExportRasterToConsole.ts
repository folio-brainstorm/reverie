import type { Raster } from "@reveriejs/core";
import { ExportRenderer } from "@reveriejs/exporter";
import type { ExportRegion, ExportResult } from "@reveriejs/exporter";

const RGBA_CHANNEL_COUNT = 4;

/**
 * Exports a world-pixel region of a Raster and logs the resulting RGBA buffer.
 *
 * The summary line reports the bitmap dimensions, byte length, and how many
 * pixels are not fully transparent. The complete `Uint8ClampedArray` is logged
 * separately so every RGBA channel can be inspected in the console.
 *
 * @param raster - Sparse raster to export without mutating it.
 * @param region - World-pixel region to export.
 * @returns The exported bitmap, which the caller may keep for further use.
 */
export function exportRasterToConsole(
  raster: Raster,
  region: ExportRegion,
): ExportResult {
  const result = new ExportRenderer({ raster }).render(region);
  const pixelCount = result.width * result.height;
  const visiblePixelCount = countNonTransparentPixels(result.pixels);

  console.log(
    `[exporter] ${result.width} × ${result.height} px · ` +
      `${result.pixels.length} bytes · ` +
      `${visiblePixelCount}/${pixelCount} non-transparent px`,
  );
  console.log("[exporter] RGBA buffer", result.pixels);

  return result;
}

/**
 * Counts pixels whose straight alpha channel is not fully transparent.
 *
 * @param pixels - Row-major RGBA8 buffer with four channels per pixel.
 * @returns The number of pixels with a non-zero alpha channel.
 */
function countNonTransparentPixels(pixels: Uint8ClampedArray): number {
  let visiblePixelCount = 0;

  for (
    let alphaIndex = RGBA_CHANNEL_COUNT - 1;
    alphaIndex < pixels.length;
    alphaIndex += RGBA_CHANNEL_COUNT
  ) {
    if (pixels[alphaIndex] !== 0) {
      visiblePixelCount += 1;
    }
  }

  return visiblePixelCount;
}
