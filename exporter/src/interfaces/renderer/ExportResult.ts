/**
 * The dense RGBA8 bitmap produced by one export pass.
 *
 * Pixels are stored in row-major order with four channels per pixel and straight
 * (non-premultiplied) alpha. The buffer is owned by the caller and is never
 * shared with, or backed by, the exported Raster.
 */
export interface ExportResult {
  /** Width of the exported bitmap in pixels. */
  readonly width: number;

  /** Height of the exported bitmap in pixels. */
  readonly height: number;

  /** Row-major RGBA8 pixel storage; length is `width * height * 4`. */
  readonly pixels: Uint8ClampedArray;
}
