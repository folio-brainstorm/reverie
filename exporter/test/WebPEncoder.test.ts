import decodeWebp from "@jsquash/webp/decode.js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ExporterErrorDefinitions,
  ExporterTypeError,
  WebPEncoder,
} from "../index.js";
import type { ExportResult, WebPEncodeOptions } from "../index.js";

import { initializeWebpDecoder } from "./InitializeWebpDecoder.js";

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

/** Builds an opaque color whose chroma exposes incorrect VP8 transform strides. */
function createSolidBitmap(width: number, height: number): ExportResult {
  const pixels = new Uint8ClampedArray(width * height * RGBA_CHANNEL_COUNT);

  for (let offset = 0; offset < pixels.length; offset += RGBA_CHANNEL_COUNT) {
    pixels.set([220, 40, 90, 255], offset);
  }

  return { width, height, pixels };
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
 * @returns The decoded geometry and RGBA8 pixels.
 */
async function decodeToPixels(bytes: Uint8Array): Promise<ImageData> {
  return decodeWebp(new Uint8Array(bytes).buffer);
}

describe("WebPEncoder", () => {
  beforeAll(initializeWebpDecoder);

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

  it.each([
    [1, 1],
    [3, 5],
    [11, 7],
    [17, 19],
    [64, 48],
  ])(
    "round-trips %i × %i pixels and alpha exactly by default",
    async (width, height) => {
      const image = createBitmap(width, height);
      const encoded = await new WebPEncoder().encode(image);
      const decoded = await decodeToPixels(encoded.data);

      expect(readFourCc(encoded.data, CHUNK_FOUR_CC_OFFSET)).toBe(VP8L_FOUR_CC);
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(Array.from(decoded.data)).toEqual(Array.from(image.pixels));
    },
  );

  it.each([
    [8, 8, 0.92],
    [16, 16, 0.92],
    [17, 19, 0.92],
    [64, 48, 0.92],
    [127, 65, 0.92],
    [8, 8, 1],
    [16, 16, 1],
    [17, 19, 1],
    [64, 48, 1],
    [127, 65, 1],
  ])(
    "preserves solid color throughout a lossy %i × %i image at quality %s",
    async (width, height, quality) => {
      const image = createSolidBitmap(width, height);
      const encoded = await new WebPEncoder().encode(image, {
        lossless: false,
        quality,
      });
      const decoded = await decodeToPixels(encoded.data);

      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(decoded.data.length).toBe(image.pixels.length);
      for (
        let offset = 0;
        offset < image.pixels.length;
        offset += RGBA_CHANNEL_COUNT
      ) {
        // YUV conversion and quantization allow small RGB rounding differences.
        for (let channel = 0; channel < 3; channel += 1) {
          expect(
            Math.abs(
              (decoded.data[offset + channel] ?? 0) -
                (image.pixels[offset + channel] ?? 0),
            ),
          ).toBeLessThanOrEqual(3);
        }
        expect(decoded.data[offset + 3]).toBe(255);
      }
    },
  );

  it("preserves transparent pixels without flattening their color", async () => {
    const image = createBitmap(8, 8);
    const encoded = await new WebPEncoder().encode(image, { lossless: true });
    const decoded = await decodeToPixels(encoded.data);

    expect(Array.from(decoded.data.subarray(0, RGBA_CHANNEL_COUNT))).toEqual([
      0, 0, 0, 0,
    ]);
    expect(
      Array.from(
        decoded.data.subarray(RGBA_CHANNEL_COUNT * 4, RGBA_CHANNEL_COUNT * 5),
      ),
    ).toEqual(
      Array.from(
        image.pixels.subarray(RGBA_CHANNEL_COUNT * 4, RGBA_CHANNEL_COUNT * 5),
      ),
    );
  });

  it("emits a lossy VP8 bitstream for an opaque bitmap", async () => {
    const encoded = await new WebPEncoder().encode(createSolidBitmap(16, 16), {
      lossless: false,
    });
    const decoded = await decodeToPixels(encoded.data);

    expect(readFourCc(encoded.data, CHUNK_FOUR_CC_OFFSET)).toBe(VP8_FOUR_CC);
    expect(
      decoded.data
        .filter((_, index) => index % 4 === 3)
        .every((alpha) => alpha === 255),
    ).toBe(true);
  });

  it.each([
    [16, 16],
    [17, 19],
  ])(
    "preserves alpha exactly in a lossy %i × %i bitmap",
    async (width, height) => {
      const image = createBitmap(width, height);
      const encoded = await new WebPEncoder().encode(image, {
        lossless: false,
      });
      const decoded = await decodeToPixels(encoded.data);

      expect(readFourCc(encoded.data, CHUNK_FOUR_CC_OFFSET)).toBe("VP8X");
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(
        Array.from(decoded.data.filter((_, index) => index % 4 === 3)),
      ).toEqual(Array.from(image.pixels.filter((_, index) => index % 4 === 3)));
    },
  );

  it("captures pixels before the caller reuses the buffer during async encoding", async () => {
    const image = createBitmap(17, 19);
    const expected = Array.from(image.pixels);
    const pending = new WebPEncoder().encode(image);
    image.pixels.fill(255);
    const decoded = await decodeToPixels((await pending).data);

    expect(Array.from(decoded.data)).toEqual(expected);
  });

  it("encodes a pixel view with a nonzero byte offset", async () => {
    const image = createBitmap(17, 19);
    const backing = new Uint8ClampedArray(image.pixels.length + 16).fill(77);
    backing.set(image.pixels, 7);
    const pixels = backing.subarray(7, 7 + image.pixels.length);
    const before = Array.from(backing);
    const encoded = await new WebPEncoder().encode({ ...image, pixels });

    expect(Array.from((await decodeToPixels(encoded.data)).data)).toEqual(
      Array.from(image.pixels),
    );
    expect(Array.from(backing)).toEqual(before);
  });

  it("keeps concurrent exports independent", async () => {
    const images = [
      createBitmap(3, 5),
      createBitmap(17, 19),
      createSolidBitmap(16, 16),
    ];
    const encoder = new WebPEncoder();
    const encoded = await Promise.all(
      images.map((image) => encoder.encode(image)),
    );

    for (const [index, result] of encoded.entries()) {
      const decoded = await decodeToPixels(result.data);
      expect(Array.from(decoded.data)).toEqual(
        Array.from(images[index]?.pixels ?? []),
      );
    }
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
