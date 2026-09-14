import type { RGBAColor } from "@reverie/core";

/** Options accepted by the JPEG encoder. */
export interface JPEGEncodeOptions {
  /**
   * Normalized quality in the inclusive `0..1` range, where `1` keeps the most
   * detail and `0` keeps the least. Defaults to `0.92`.
   *
   * JPEG is lossy, so this value never affects the encoded dimensions or the
   * delivery metadata.
   */
  quality?: number;

  /**
   * Fully opaque color composited behind transparent source pixels before
   * encoding. Defaults to opaque white.
   *
   * JPEG has no alpha channel, so a background is the only way to describe what
   * a partially transparent pixel becomes.
   */
  background?: RGBAColor;
}
