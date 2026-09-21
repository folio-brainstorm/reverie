import type { BrushImageConfig } from "../../interfaces/brush/BrushImageConfig.js";
import type { RGBABrushImageSource } from "../../interfaces/brush/RGBABrushImageSource.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError, ReverieTypeError } from "../../utils/errors/ReverieErrors.js";

const OPAQUE_ALPHA = 255;
const RGBA_CHANNEL_COUNT = 4;

/** Immutable, runtime-neutral alpha mask shared by image brushes. */
export class BrushImage {
  /** Source width in pixels. */
  readonly width: number;

  /** Source height in pixels. */
  readonly height: number;

  /** Whether at least one source pixel can contribute paint. */
  readonly hasCoverage: boolean;

  /** Internally owned row-major alpha bytes. */
  private readonly alphaData: Uint8Array;

  /** Returns a defensive copy of the row-major alpha mask. */
  get alpha(): Uint8Array {
    return this.alphaData.slice();
  }

  /**
   * Creates an immutable alpha mask or an opaque fallback when alpha is absent.
   *
   * @param config - Positive dimensions and optional one-byte-per-pixel alpha.
   * @throws {ReverieTypeError} Invalid image dimensions config.
   * @throws {ReverieRangeError} Dimensions or alpha buffer length are invalid.
   */
  constructor(config: BrushImageConfig) {
    if (config === null || typeof config !== "object") {
      throw ReverieTypeError.from(
        ErrorDefinitions.BRUSH.INVALID_IMAGE_DIMENSIONS
      );
    }

    const pixelCount = resolvePixelCount(config.width, config.height);
    const suppliedAlpha = config.alpha;

    if (suppliedAlpha === undefined) {
      this.alphaData = new Uint8Array(pixelCount);
      this.alphaData.fill(OPAQUE_ALPHA);
    } else {
      if (
        !isByteArray(suppliedAlpha) ||
        suppliedAlpha.length !== pixelCount
      ) {
        throw ReverieRangeError.from(
          ErrorDefinitions.BRUSH.INVALID_IMAGE_ALPHA_BUFFER,
          {
            expected: pixelCount,
            received: getByteLength(suppliedAlpha),
          },
        );
      }

      this.alphaData = suppliedAlpha.slice();
    }

    this.width = config.width;
    this.height = config.height;
    this.hasCoverage = hasNonZeroAlpha(this.alphaData);
  }

  /**
   * Extracts alpha from raw RGBA8 pixels while discarding every RGB channel.
   *
   * @param source - Positive dimensions and exact row-major RGBA8 bytes.
   * @returns A new immutable alpha-only brush image.
   * @throws {ReverieRangeError} Dimensions or RGBA buffer length are invalid.
   */
  static fromRGBA(source: RGBABrushImageSource): BrushImage {
    const pixelCount = resolvePixelCount(source.width, source.height);
    const expectedLength = pixelCount * RGBA_CHANNEL_COUNT;

    if (
      !Number.isSafeInteger(expectedLength) ||
      !isByteArray(source.pixels) ||
      source.pixels.length !== expectedLength
    ) {
      throw ReverieRangeError.from(
        ErrorDefinitions.BRUSH.INVALID_IMAGE_RGBA_BUFFER,
        {
          expected: expectedLength,
          received: getByteLength(source.pixels),
        },
      );
    }

    const alpha = new Uint8Array(pixelCount);

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      alpha[pixelIndex] =
        source.pixels[pixelIndex * RGBA_CHANNEL_COUNT + 3] ?? 0;
    }

    return new BrushImage({
      width: source.width,
      height: source.height,
      alpha,
    });
  }

  /**
   * Samples normalized alpha using bilinear interpolation and transparent edges.
   *
   * Source coordinates address an image rectangle from `(0, 0)` to
   * `(width, height)`, with the first pixel center at `(0.5, 0.5)`.
   *
   * @param sourceX - Continuous horizontal source coordinate.
   * @param sourceY - Continuous vertical source coordinate.
   * @returns Normalized alpha, or `0` outside the image rectangle.
   */
  sampleAlpha(sourceX: number, sourceY: number): number {
    if (
      !Number.isFinite(sourceX) ||
      !Number.isFinite(sourceY) ||
      sourceX < 0 ||
      sourceX >= this.width ||
      sourceY < 0 ||
      sourceY >= this.height
    ) {
      return 0;
    }

    const centeredX = sourceX - 0.5;
    const centeredY = sourceY - 0.5;
    const left = Math.floor(centeredX);
    const top = Math.floor(centeredY);
    const horizontalAmount = centeredX - left;
    const verticalAmount = centeredY - top;
    const topAlpha =
      this.readAlpha(left, top) * (1 - horizontalAmount) +
      this.readAlpha(left + 1, top) * horizontalAmount;
    const bottomAlpha =
      this.readAlpha(left, top + 1) * (1 - horizontalAmount) +
      this.readAlpha(left + 1, top + 1) * horizontalAmount;

    return (
      (topAlpha * (1 - verticalAmount) + bottomAlpha * verticalAmount) /
      OPAQUE_ALPHA
    );
  }

  /** Returns one alpha byte or transparent coverage outside the source grid. */
  private readAlpha(pixelX: number, pixelY: number): number {
    if (
      pixelX < 0 ||
      pixelX >= this.width ||
      pixelY < 0 ||
      pixelY >= this.height
    ) {
      return 0;
    }

    return this.alphaData[pixelY * this.width + pixelX] ?? 0;
  }
}

/** Validates dimensions and returns their safe pixel count. */
function resolvePixelCount(width: unknown, height: unknown): number {
  if (
    typeof width !== "number" ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    typeof height !== "number" ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !Number.isSafeInteger(width * height)
  ) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_IMAGE_DIMENSIONS,
    );
  }

  return width * height;
}

/** Reports whether an unknown value is a supported RGBA byte array. */
function isByteArray(value: unknown): value is Uint8Array | Uint8ClampedArray {
  return value instanceof Uint8Array || value instanceof Uint8ClampedArray;
}

/** Reads a candidate byte length without trusting its runtime shape. */
function getByteLength(value: unknown): number {
  return isByteArray(value) ? value.length : Number.NaN;
}

/** Scans an owned alpha mask once so transparent brushes can skip stamping. */
function hasNonZeroAlpha(alpha: Uint8Array): boolean {
  for (const value of alpha) {
    if (value !== 0) {
      return true;
    }
  }

  return false;
}
