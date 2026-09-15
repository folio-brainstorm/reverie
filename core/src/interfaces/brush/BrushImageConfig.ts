/** Runtime-neutral alpha-mask data used to construct a brush image. */
export interface BrushImageConfig {
  /** Positive safe-integer source width in pixels. */
  readonly width: number;

  /** Positive safe-integer source height in pixels. */
  readonly height: number;

  /**
   * Row-major alpha bytes with one value per source pixel.
   * Omission creates a fully opaque mask for sources without alpha.
   */
  readonly alpha?: Uint8Array;
}
