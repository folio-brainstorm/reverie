/** Raw straight-alpha RGBA8 pixels accepted by {@link BrushImage.fromRGBA}. */
export interface RGBABrushImageSource {
  /** Positive safe-integer source width in pixels. */
  readonly width: number;

  /** Positive safe-integer source height in pixels. */
  readonly height: number;

  /** Row-major RGBA8 bytes; RGB is ignored and only every alpha byte is retained. */
  readonly pixels: Uint8Array | Uint8ClampedArray;
}
