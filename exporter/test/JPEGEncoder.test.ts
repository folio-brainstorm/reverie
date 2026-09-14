import type { RGBAColor } from "@reverie/core";
import { decode as decodeJpeg } from "jpeg-js";
import { describe, expect, it } from "vitest";

import {
  ExporterErrorDefinitions,
  ExporterRangeError,
  ExporterTypeError,
  JPEGEncoder,
} from "../index.js";
import type { ExportResult, JPEGEncodeOptions } from "../index.js";

import { expectPixelNear, readPixel } from "./PixelAssertions.js";

const RGBA_CHANNEL_COUNT = 4;

const START_OF_IMAGE_MARKER = 0xff;

const START_OF_IMAGE_CODE = 0xd8;

const END_OF_IMAGE_CODE = 0xd9;

/** Side length of the uniform images used to keep JPEG artifacts predictable. */
const UNIFORM_SIZE = 16;

const OPAQUE_WHITE: RGBAColor = { r: 255, g: 255, b: 255, a: 255 };

const OPAQUE_BLACK: RGBAColor = { r: 0, g: 0, b: 0, a: 255 };

/** Channel tolerance that accommodates lossy JPEG compression. */
const CHANNEL_TOLERANCE = 24;

/**
 * Builds a uniform RGBA8 bitmap filled with one color.
 *
 * @param size - Side length in pixels.
 * @param color - Color replicated into every pixel.
 * @returns A freshly allocated bitmap.
 */
function createSolidBitmap(size: number, color: RGBAColor): ExportResult {
  const pixels = new Uint8ClampedArray(size * size * RGBA_CHANNEL_COUNT);

  for (let offset = 0; offset < pixels.length; offset += RGBA_CHANNEL_COUNT) {
    pixels[offset] = color.r;
    pixels[offset + 1] = color.g;
    pixels[offset + 2] = color.b;
    pixels[offset + 3] = color.a;
  }

  return { width: size, height: size, pixels };
}

/**
 * Builds a bitmap with high-frequency detail.
 *
 * Detail is what makes JPEG quality visible, so this pattern separates a
 * high-quality encode from a low-quality one.
 *
 * @param size - Side length in pixels.
 * @returns A freshly allocated bitmap.
 */
function createDetailedBitmap(size: number): ExportResult {
  const pixels = new Uint8ClampedArray(size * size * RGBA_CHANNEL_COUNT);

  for (let index = 0; index < size * size; index += 1) {
    const offset = index * RGBA_CHANNEL_COUNT;
    const isLight = (index + Math.floor(index / size)) % 2 === 0;

    pixels[offset] = isLight ? 255 : 0;
    pixels[offset + 1] = isLight ? 0 : 255;
    pixels[offset + 2] = (index * 31) % 256;
    pixels[offset + 3] = 255;
  }

  return { width: size, height: size, pixels };
}

/**
 * Decodes a JPEG file back into RGBA8 pixels.
 *
 * @param bytes - Complete JPEG file.
 * @returns The decoded geometry and pixels.
 */
function decodeToPixels(bytes: Uint8Array): {
  width: number;
  height: number;
  pixels: Uint8Array;
} {
  const decoded = decodeJpeg(bytes, {
    useTArray: true,
    formatAsRGBA: true,
  });

  return {
    width: decoded.width,
    height: decoded.height,
    pixels: decoded.data,
  };
}

describe("JPEGEncoder", () => {
  it("reports the JPEG media type and extension", async () => {
    const encoded = await new JPEGEncoder().encode(
      createSolidBitmap(UNIFORM_SIZE, OPAQUE_WHITE),
    );

    expect(encoded.mimeType).toBe("image/jpeg");
    expect(encoded.extension).toBe("jpg");
    expect(encoded.data).toBeInstanceOf(Uint8Array);
    expect(encoded.data.length).toBeGreaterThan(0);
  });

  it("wraps the file in JPEG start and end markers", async () => {
    const encoded = await new JPEGEncoder().encode(
      createSolidBitmap(UNIFORM_SIZE, OPAQUE_WHITE),
    );

    expect(encoded.data[0]).toBe(START_OF_IMAGE_MARKER);
    expect(encoded.data[1]).toBe(START_OF_IMAGE_CODE);
    expect(encoded.data.at(-2)).toBe(START_OF_IMAGE_MARKER);
    expect(encoded.data.at(-1)).toBe(END_OF_IMAGE_CODE);
  });

  it("preserves the dimensions of the source bitmap", async () => {
    const encoded = await new JPEGEncoder().encode(createDetailedBitmap(24));
    const decoded = decodeToPixels(encoded.data);

    expect(decoded.width).toBe(24);
    expect(decoded.height).toBe(24);
  });

  it("composites transparent pixels onto white by default", async () => {
    const encoded = await new JPEGEncoder().encode(
      createSolidBitmap(UNIFORM_SIZE, { r: 0, g: 0, b: 0, a: 0 }),
    );
    const decoded = decodeToPixels(encoded.data);

    expectPixelNear(
      readPixel(decoded.pixels, 0),
      [255, 255, 255, 255],
      CHANNEL_TOLERANCE,
    );
  });

  it("composites transparent pixels onto a custom opaque background", async () => {
    const encoded = await new JPEGEncoder().encode(
      createSolidBitmap(UNIFORM_SIZE, { r: 255, g: 0, b: 0, a: 0 }),
      { background: OPAQUE_BLACK },
    );
    const decoded = decodeToPixels(encoded.data);

    expectPixelNear(
      readPixel(decoded.pixels, 0),
      [0, 0, 0, 255],
      CHANNEL_TOLERANCE,
    );
  });

  it("composites semi-transparent pixels over the background", async () => {
    const encoded = await new JPEGEncoder().encode(
      createSolidBitmap(UNIFORM_SIZE, { r: 255, g: 0, b: 0, a: 128 }),
    );
    const decoded = decodeToPixels(encoded.data);

    expectPixelNear(
      readPixel(decoded.pixels, 0),
      [255, 127, 127, 255],
      CHANNEL_TOLERANCE,
    );
  });

  it("does not mutate the source bitmap while compositing", async () => {
    const image = createSolidBitmap(UNIFORM_SIZE, {
      r: 255,
      g: 0,
      b: 0,
      a: 128,
    });
    const before = Array.from(image.pixels);

    await new JPEGEncoder().encode(image, { background: OPAQUE_BLACK });

    expect(Array.from(image.pixels)).toEqual(before);
  });

  it("accepts the boundary qualities zero and one", async () => {
    const image = createDetailedBitmap(UNIFORM_SIZE);
    const lowest = await new JPEGEncoder().encode(image, { quality: 0 });
    const highest = await new JPEGEncoder().encode(image, { quality: 1 });

    expect(lowest.data.length).toBeGreaterThan(0);
    expect(highest.data.length).toBeGreaterThan(lowest.data.length);
  });

  it.each([-0.1, 1.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the invalid quality %s",
    async (quality) => {
      await expect(
        new JPEGEncoder().encode(
          createSolidBitmap(UNIFORM_SIZE, OPAQUE_WHITE),
          {
            quality,
          },
        ),
      ).rejects.toMatchObject({
        code: ExporterErrorDefinitions.INVALID_ENCODER_QUALITY.code,
      });
    },
  );

  it("reports a type error for a non-numeric quality", async () => {
    await expect(
      new JPEGEncoder().encode(createSolidBitmap(UNIFORM_SIZE, OPAQUE_WHITE), {
        quality: "high",
      } as unknown as JPEGEncodeOptions),
    ).rejects.toBeInstanceOf(ExporterTypeError);
  });

  it("rejects a background that is not fully opaque", async () => {
    await expect(
      new JPEGEncoder().encode(createSolidBitmap(UNIFORM_SIZE, OPAQUE_WHITE), {
        background: { r: 0, g: 0, b: 0, a: 128 },
      }),
    ).rejects.toMatchObject({
      code: ExporterErrorDefinitions.NON_OPAQUE_ENCODER_BACKGROUND.code,
    });
  });

  it("reports a range error for a translucent background", async () => {
    await expect(
      new JPEGEncoder().encode(createSolidBitmap(UNIFORM_SIZE, OPAQUE_WHITE), {
        background: { r: 0, g: 0, b: 0, a: 0 },
      }),
    ).rejects.toBeInstanceOf(ExporterRangeError);
  });

  const invalidBackgrounds: { label: string; value: unknown }[] = [
    { label: "a channel above 255", value: { r: 256, g: 0, b: 0, a: 255 } },
    { label: "a fractional channel", value: { r: 1.5, g: 0, b: 0, a: 255 } },
    { label: "a missing channel", value: { r: 0, g: 0, b: 0 } },
    { label: "null", value: null },
    { label: "a string", value: "white" },
  ];

  it.each(invalidBackgrounds)(
    "rejects $label as a background",
    async ({ value }) => {
      // The public option is limited to `RGBAColor`; invalid values are
      // supplied on purpose so the runtime validator is under test.
      const options = { background: value } as JPEGEncodeOptions;

      await expect(
        new JPEGEncoder().encode(
          createSolidBitmap(UNIFORM_SIZE, OPAQUE_WHITE),
          options,
        ),
      ).rejects.toMatchObject({
        code: ExporterErrorDefinitions.INVALID_ENCODER_BACKGROUND.code,
      });
    },
  );
});
