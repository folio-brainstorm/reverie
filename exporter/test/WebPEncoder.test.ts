import { decode as decodeWebp } from "@stacksjs/ts-webp";
import { describe, expect, it } from "vitest";

import {
  ExporterErrorDefinitions,
  ExporterTypeError,
  WebPEncoder,
} from "../index.js";
import type { ExportResult, WebPEncodeOptions } from "../index.js";

const RGBA_CHANNEL_COUNT = 4;

const RIFF_TAG = "RIFF";

const WEBP_FORM_TAG = "WEBP";

/** FourCC of a lossless VP8L bitstream. */
const VP8L_FOUR_CC = "VP8L";

/** FourCC of a lossy VP8 bitstream. */
const VP8_FOUR_CC = "VP8 ";

/** Offset of the chunk fourCC that follows the image header. */
const CHUNK_FOUR_CC_OFFSET = 12;

/**
 * Builds a deterministic RGBA8 bitmap with mixed alpha.
 *
 * Every fourth pixel is fully transparent but keeps non-zero color channels, so
 * flattening alpha instead of preserving it is detectable.
 *
 * @param width - Horizontal extent in pixels.
 * @param height - Vertical extent in pixels.
 * @returns A freshly allocated bitmap.
 */
function createBitmap(width: number, height: number): ExportResult {
  const pixels = new Uint8ClampedArray(width * height * RGBA_CHANNEL_COUNT);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * RGBA_CHANNEL_COUNT;

    pixels[offset] = (index * 7) % 256;
    pixels[offset + 1] = (index * 13) % 256;
    pixels[offset + 2] = (index * 29) % 256;
    pixels[offset + 3] = index % 4 === 0 ? 0 : 128;
  }

  return { width, height, pixels };
}

/**
 * Builds a bitmap with high-frequency detail.
 *
 * Detail keeps a lossy encode from collapsing to a trivial bitstream, which is
 * what makes a quality difference observable.
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
    pixels[offset + 1] = (index * 17) % 256;
    pixels[offset + 2] = (index * 31) % 256;
    pixels[offset + 3] = 255;
  }

  return { width: size, height: size, pixels };
}

/**
 * Reads a four-character code out of a WebP file.
 *
 * @param bytes - Complete WebP file.
 * @param offset - Offset of the code.
 * @returns The code as ASCII.
 */
function readFourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/**
 * Decodes a WebP file back into RGBA8 pixels.
 *
 * @param bytes - Complete WebP file.
 * @returns The decoded geometry, pixels, and alpha presence.
 */
function decodeToPixels(bytes: Uint8Array): {
  width: number;
  height: number;
  pixels: Uint8Array;
  hasAlpha: boolean;
} {
  const decoded = decodeWebp(bytes);

  return {
    width: decoded.width,
    height: decoded.height,
    pixels: decoded.data,
    hasAlpha: decoded.hasAlpha,
  };
}

describe("WebPEncoder", () => {
  it("reports the WebP media type and extension", async () => {
    const encoded = await new WebPEncoder().encode(createBitmap(8, 8));

    expect(encoded.mimeType).toBe("image/webp");
    expect(encoded.extension).toBe("webp");
    expect(encoded.data).toBeInstanceOf(Uint8Array);
    expect(encoded.data.length).toBeGreaterThan(0);
  });

  it("wraps the payload in a RIFF container tagged WEBP", async () => {
    const encoded = await new WebPEncoder().encode(createBitmap(8, 8));

    expect(readFourCc(encoded.data, 0)).toBe(RIFF_TAG);
    expect(readFourCc(encoded.data, 8)).toBe(WEBP_FORM_TAG);
  });

  it("round-trips pixels and alpha exactly by default", async () => {
    const image = createBitmap(11, 7);
    const encoded = await new WebPEncoder().encode(image);
    const decoded = decodeToPixels(encoded.data);

    expect(readFourCc(encoded.data, CHUNK_FOUR_CC_OFFSET)).toBe(VP8L_FOUR_CC);
    expect(decoded.hasAlpha).toBe(true);
    expect(decoded.width).toBe(11);
    expect(decoded.height).toBe(7);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(image.pixels));
  });

  it("preserves transparent pixels without flattening their color", async () => {
    const image = createBitmap(8, 8);
    const encoded = await new WebPEncoder().encode(image, { lossless: true });
    const decoded = decodeToPixels(encoded.data);

    expect(Array.from(decoded.pixels.subarray(0, RGBA_CHANNEL_COUNT))).toEqual([
      0, 0, 0, 0,
    ]);
    expect(
      Array.from(
        decoded.pixels.subarray(RGBA_CHANNEL_COUNT * 4, RGBA_CHANNEL_COUNT * 5),
      ),
    ).toEqual(
      Array.from(
        image.pixels.subarray(RGBA_CHANNEL_COUNT * 4, RGBA_CHANNEL_COUNT * 5),
      ),
    );
  });

  it("emits a lossy VP8 bitstream without alpha when requested", async () => {
    const encoded = await new WebPEncoder().encode(createBitmap(16, 16), {
      lossless: false,
    });
    const decoded = decodeToPixels(encoded.data);

    expect(readFourCc(encoded.data, CHUNK_FOUR_CC_OFFSET)).toBe(VP8_FOUR_CC);
    expect(decoded.hasAlpha).toBe(false);
  });

  it("applies the lossy quality option", async () => {
    const image = createDetailedBitmap(16);
    const lowest = await new WebPEncoder().encode(image, {
      lossless: false,
      quality: 0,
    });
    const highest = await new WebPEncoder().encode(image, {
      lossless: false,
      quality: 1,
    });

    expect(highest.data.length).toBeGreaterThan(lowest.data.length);
  });

  it("does not mutate the source bitmap", async () => {
    const image = createBitmap(9, 9);
    const before = Array.from(image.pixels);

    await new WebPEncoder().encode(image, { lossless: false, quality: 0.5 });

    expect(Array.from(image.pixels)).toEqual(before);
  });

  it.each([-0.1, 1.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the invalid quality %s",
    async (quality) => {
      await expect(
        new WebPEncoder().encode(createBitmap(8, 8), { quality }),
      ).rejects.toMatchObject({
        code: ExporterErrorDefinitions.INVALID_ENCODER_QUALITY.code,
      });
    },
  );

  it("validates the quality even in lossless mode", async () => {
    await expect(
      new WebPEncoder().encode(createBitmap(8, 8), {
        lossless: true,
        quality: 4,
      }),
    ).rejects.toMatchObject({
      code: ExporterErrorDefinitions.INVALID_ENCODER_QUALITY.code,
    });
  });

  it("reports a type error for a non-numeric quality", async () => {
    await expect(
      new WebPEncoder().encode(createBitmap(8, 8), {
        quality: "high",
      } as unknown as WebPEncodeOptions),
    ).rejects.toBeInstanceOf(ExporterTypeError);
  });

  const invalidLosslessValues: { label: string; value: unknown }[] = [
    { label: "a string", value: "yes" },
    { label: "a number", value: 1 },
    { label: "null", value: null },
  ];

  it.each(invalidLosslessValues)(
    "rejects $label as a lossless flag",
    async ({ value }) => {
      // The public option is a boolean; invalid values are supplied on purpose
      // so the runtime validator is the thing under test.
      const options = { lossless: value } as WebPEncodeOptions;

      await expect(
        new WebPEncoder().encode(createBitmap(8, 8), options),
      ).rejects.toMatchObject({
        code: ExporterErrorDefinitions.INVALID_ENCODER_BOOLEAN_OPTION.code,
      });
    },
  );
});
