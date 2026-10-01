import type { ExportResult } from "../interfaces/renderer/ExportResult.js";

const RGBA_CHANNEL_COUNT = 4;

/**
 * Enlarges a composed bitmap by copying exact RGBA pixels without interpolation.
 *
 * @param image - Native-resolution bitmap, read without mutation.
 * @param scale - Validated integer multiplier in `1..16`, with safely sized output.
 * @returns The original bitmap at `1x`, otherwise a newly allocated bitmap.
 */
export function scaleExportResult(
  image: ExportResult,
  scale: number,
): ExportResult {
  if (scale === 1) {
    return image;
  }

  const width = image.width * scale;
  const height = image.height * scale;
  const pixels = new Uint8ClampedArray(width * height * RGBA_CHANNEL_COUNT);
  const rowByteLength = width * RGBA_CHANNEL_COUNT;

  for (let y = 0; y < image.height; y += 1) {
    const rowOffset = y * scale * rowByteLength;
    for (let x = 0; x < image.width; x += 1) {
      const sourceOffset = (y * image.width + x) * RGBA_CHANNEL_COUNT;
      const pixel = image.pixels.subarray(
        sourceOffset,
        sourceOffset + RGBA_CHANNEL_COUNT,
      );
      const destinationOffset = rowOffset + x * scale * RGBA_CHANNEL_COUNT;
      for (let repeat = 0; repeat < scale; repeat += 1) {
        pixels.set(pixel, destinationOffset + repeat * RGBA_CHANNEL_COUNT);
      }
    }

    // Repeat the completed scanline instead of expanding its pixels again.
    const row = pixels.subarray(rowOffset, rowOffset + rowByteLength);
    for (let repeat = 1; repeat < scale; repeat += 1) {
      pixels.set(row, rowOffset + repeat * rowByteLength);
    }
  }

  return { width, height, pixels };
}
