/** Options accepted by the WebP encoder. */
export interface WebPEncodeOptions {
  /**
   * Normalized quality in the inclusive `0..1` range, where `1` keeps the most
   * detail. Defaults to `0.92`.
   *
   * Only the lossy path uses this value, so it is ignored when `lossless` is
   * `true`.
   */
  quality?: number;

  /**
   * Whether to encode losslessly. Defaults to `true`.
   *
   * Lossless output preserves every RGBA channel exactly, including color in
   * transparent pixels. Both lossless and lossy output preserve alpha exactly.
   */
  lossless?: boolean;
}
