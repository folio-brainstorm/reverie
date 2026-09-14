import { expect } from "vitest";

const RGBA_CHANNEL_COUNT = 4;

/**
 * Reads one decoded pixel as an ordered channel array.
 *
 * @param pixels - Decoded RGBA8 storage.
 * @param pixelIndex - Zero-based index of the pixel.
 * @returns The pixel's red, green, blue, and alpha channels.
 */
export function readPixel(pixels: Uint8Array, pixelIndex: number): number[] {
  const offset = pixelIndex * RGBA_CHANNEL_COUNT;

  return [
    pixels[offset] ?? 0,
    pixels[offset + 1] ?? 0,
    pixels[offset + 2] ?? 0,
    pixels[offset + 3] ?? 0,
  ];
}

/**
 * Asserts that one decoded pixel approximates an expected color.
 *
 * Lossy codecs cannot reproduce exact channel values, so each channel is
 * compared with an explicit tolerance instead of for equality.
 *
 * @param actual - Decoded channels.
 * @param expected - Expected channels.
 * @param tolerance - Maximum accepted difference per channel.
 */
export function expectPixelNear(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
): void {
  for (let channel = 0; channel < expected.length; channel += 1) {
    expect(
      Math.abs((actual[channel] ?? 0) - (expected[channel] ?? 0)),
    ).toBeLessThanOrEqual(tolerance);
  }
}
