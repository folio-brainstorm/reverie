import decodeWebp from "@jsquash/webp/decode.js";
import { decode as decodeJpeg } from "jpeg-js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ExporterErrorDefinitions,
  ExporterRangeError,
  ExporterTypeError,
  JPEGEncoder,
  PNGEncoder,
  WebPEncoder,
} from "../index.js";
import type { ExportResult } from "../index.js";

import { initializeWebpDecoder } from "./InitializeWebpDecoder.js";

beforeAll(initializeWebpDecoder);

const RGBA_CHANNEL_COUNT = 4;

/** Offset of the `IHDR` width field: signature, chunk length, and chunk type. */
const PNG_WIDTH_OFFSET = 16;

/** Offset of the `IHDR` height field, immediately after the width. */
const PNG_HEIGHT_OFFSET = 20;

/** Dimensions large enough to expose runaway copies without a performance SLA. */
const LARGE_SIZES: readonly { width: number; height: number }[] = [
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
];

/**
 * Every built-in encoder, exposed through one signature for shared contract
 * tests. Options are omitted, so each encoder applies its documented defaults.
 */
const encoders = [
  {
    name: "PNG",
    encode: (image: ExportResult) => new PNGEncoder().encode(image),
  },
  {
    name: "JPEG",
    encode: (image: ExportResult) => new JPEGEncoder().encode(image),
  },
  {
    name: "WebP",
    encode: (image: ExportResult) => new WebPEncoder().encode(image),
  },
];

/** Builds a valid opaque bitmap. */
function createValidBitmap(width = 4, height = 4): ExportResult {
  const pixels = new Uint8ClampedArray(width * height * RGBA_CHANNEL_COUNT);

  for (let offset = 0; offset < pixels.length; offset += RGBA_CHANNEL_COUNT) {
    pixels[offset] = 32;
    pixels[offset + 1] = 64;
    pixels[offset + 2] = 96;
    pixels[offset + 3] = 255;
  }

  return { width, height, pixels };
}

/**
 * Builds a synthetic bitmap with a painted quadrant and a transparent rest.
 *
 * The transparent majority keeps compression fast while still exercising the
 * full resolution of the encoder, so a large encode stays a scale check rather
 * than a performance test.
 *
 * @param width - Horizontal extent in pixels.
 * @param height - Vertical extent in pixels.
 * @returns A freshly allocated bitmap.
 */
function createLargeBitmap(width: number, height: number): ExportResult {
  const pixels = new Uint8ClampedArray(width * height * RGBA_CHANNEL_COUNT);
  const paintedWidth = Math.floor(width / 2);
  const paintedHeight = Math.floor(height / 2);

  for (let y = 0; y < paintedHeight; y += 1) {
    for (let x = 0; x < paintedWidth; x += 1) {
      const offset = (y * width + x) * RGBA_CHANNEL_COUNT;

      pixels[offset] = (x * 7) % 256;
      pixels[offset + 1] = (y * 5) % 256;
      pixels[offset + 2] = (x + y) % 256;
      pixels[offset + 3] = 255;
    }
  }

  return { width, height, pixels };
}

/**
 * Presents a deliberately malformed bitmap to an encoder.
 *
 * The public signature only accepts a well-formed `ExportResult`, so invalid
 * values are supplied through this single documented escape hatch; proving that
 * the runtime validators reject them is the point of the shared contract tests.
 *
 * @param value - Deliberately invalid bitmap candidate.
 * @returns The same value, typed as a bitmap.
 */
function asImage(value: unknown): ExportResult {
  return value as ExportResult;
}

/**
 * Reads the geometry recorded in a PNG `IHDR` chunk.
 *
 * @param bytes - Complete PNG file.
 * @returns The width and height declared by the file.
 */
function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    width: view.getUint32(PNG_WIDTH_OFFSET),
    height: view.getUint32(PNG_HEIGHT_OFFSET),
  };
}

describe.each(encoders)("$name input validation", ({ encode }) => {
  const invalidImages: {
    label: string;
    image: unknown;
    code: string;
    errorClass: typeof ExporterTypeError | typeof ExporterRangeError;
  }[] = [
    {
      label: "a zero width",
      image: { width: 0, height: 1, pixels: new Uint8ClampedArray(0) },
      code: ExporterErrorDefinitions.INVALID_IMAGE_DIMENSION.code,
      errorClass: ExporterRangeError,
    },
    {
      label: "a zero height",
      image: { width: 1, height: 0, pixels: new Uint8ClampedArray(0) },
      code: ExporterErrorDefinitions.INVALID_IMAGE_DIMENSION.code,
      errorClass: ExporterRangeError,
    },
    {
      label: "a negative width",
      image: { width: -4, height: 2, pixels: new Uint8ClampedArray(0) },
      code: ExporterErrorDefinitions.INVALID_IMAGE_DIMENSION.code,
      errorClass: ExporterRangeError,
    },
    {
      label: "a fractional height",
      image: { width: 2, height: 2.5, pixels: new Uint8ClampedArray(0) },
      code: ExporterErrorDefinitions.INVALID_IMAGE_DIMENSION.code,
      errorClass: ExporterRangeError,
    },
    {
      label: "a NaN width",
      image: { width: Number.NaN, height: 2, pixels: new Uint8ClampedArray(0) },
      code: ExporterErrorDefinitions.INVALID_IMAGE_DIMENSION.code,
      errorClass: ExporterRangeError,
    },
    {
      label: "an infinite height",
      image: {
        width: 2,
        height: Number.POSITIVE_INFINITY,
        pixels: new Uint8ClampedArray(0),
      },
      code: ExporterErrorDefinitions.INVALID_IMAGE_DIMENSION.code,
      errorClass: ExporterRangeError,
    },
    {
      label: "a string width",
      image: { width: "4", height: 4, pixels: new Uint8ClampedArray(64) },
      code: ExporterErrorDefinitions.INVALID_IMAGE_FIELD_TYPE.code,
      errorClass: ExporterTypeError,
    },
    {
      label: "a missing pixel buffer",
      image: { width: 2, height: 2 },
      code: ExporterErrorDefinitions.INVALID_IMAGE_TYPE.code,
      errorClass: ExporterTypeError,
    },
    {
      label: "null instead of a bitmap",
      image: null,
      code: ExporterErrorDefinitions.INVALID_IMAGE_TYPE.code,
      errorClass: ExporterTypeError,
    },
    {
      label: "a Uint8Array instead of Uint8ClampedArray",
      image: { width: 2, height: 2, pixels: new Uint8Array(16) },
      code: ExporterErrorDefinitions.INVALID_IMAGE_PIXELS_TYPE.code,
      errorClass: ExporterTypeError,
    },
    {
      label: "an undersized pixel buffer",
      image: { width: 4, height: 4, pixels: new Uint8ClampedArray(60) },
      code: ExporterErrorDefinitions.INVALID_IMAGE_PIXELS_LENGTH.code,
      errorClass: ExporterRangeError,
    },
    {
      label: "an oversized pixel buffer",
      image: { width: 4, height: 4, pixels: new Uint8ClampedArray(68) },
      code: ExporterErrorDefinitions.INVALID_IMAGE_PIXELS_LENGTH.code,
      errorClass: ExporterRangeError,
    },
    {
      label: "a pixel count that overflows",
      image: {
        width: 2 ** 30,
        height: 2 ** 30,
        pixels: new Uint8ClampedArray(4),
      },
      code: ExporterErrorDefinitions.IMAGE_EXCEEDS_SAFE_RANGE.code,
      errorClass: ExporterRangeError,
    },
    {
      label: "a byte length that overflows",
      image: { width: 2 ** 51, height: 1, pixels: new Uint8ClampedArray(4) },
      code: ExporterErrorDefinitions.IMAGE_EXCEEDS_SAFE_RANGE.code,
      errorClass: ExporterRangeError,
    },
  ];

  it.each(invalidImages)(
    "rejects $label with $code",
    async ({ image, code, errorClass }) => {
      const rejection = encode(asImage(image));

      await expect(rejection).rejects.toMatchObject({ code });
      await expect(rejection).rejects.toBeInstanceOf(errorClass);
    },
  );

  it("accepts a valid bitmap", async () => {
    const encoded = await encode(createValidBitmap());

    expect(encoded.data.length).toBeGreaterThan(0);
    expect(encoded.mimeType).toMatch(/^image\//);
  });
});

describe.each(encoders)("$name large image sanity", ({ encode }) => {
  it.each(LARGE_SIZES)(
    "encodes a $width x $height bitmap without runaway copying",
    async ({ width, height }) => {
      const image = createLargeBitmap(width, height);
      const encoded = await encode(image);

      expect(image.pixels.length).toBe(width * height * RGBA_CHANNEL_COUNT);
      expect(encoded.data.length).toBeGreaterThan(0);
      expect(encoded.data.length).toBeLessThan(image.pixels.length);
    },
    120_000,
  );
});

describe("large image geometry", () => {
  it("records the requested size in every format", async () => {
    const image = createLargeBitmap(1920, 1080);

    const png = await new PNGEncoder().encode(image);
    const jpeg = await new JPEGEncoder().encode(image);
    const webp = await new WebPEncoder().encode(image);

    expect(readPngSize(png.data)).toEqual({ width: 1920, height: 1080 });

    const decodedJpeg = decodeJpeg(jpeg.data, {
      useTArray: true,
      formatAsRGBA: true,
    });
    expect({ width: decodedJpeg.width, height: decodedJpeg.height }).toEqual({
      width: 1920,
      height: 1080,
    });

    const decodedWebp = await decodeWebp(new Uint8Array(webp.data).buffer);
    expect({ width: decodedWebp.width, height: decodedWebp.height }).toEqual({
      width: 1920,
      height: 1080,
    });
  }, 120_000);
});
