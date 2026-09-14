import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  ExporterErrorDefinitions,
  ExporterRangeError,
  ExporterTypeError,
  PNGEncoder,
} from "../index.js";
import type { ExportResult, PNGEncodeOptions } from "../index.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const RGBA_CHANNEL_COUNT = 4;

const UINT32_BYTES = 4;

const CHUNK_HEADER_BYTES = 8;

const CHUNK_CRC_BYTES = 4;

const IHDR_DATA_BYTES = 13;

const FILTER_NONE = 0;

const CRC32_POLYNOMIAL = 0xedb88320;

const CRC32_INITIAL = 0xffffffff;

const CRC32_FINAL_XOR = 0xffffffff;

/** CRC-32 of an empty `IEND` chunk, fixed by the PNG specification. */
const IEND_CHUNK_CRC = 0xae426082;

/**
 * Builds a deterministic RGBA8 bitmap with mixed alpha.
 *
 * Every other pixel is fully transparent but keeps non-zero color channels, so
 * a lossless encoder has to preserve values that a naive normalizer would drop.
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
    pixels[offset + 3] = index % 2 === 0 ? 255 : 128;
  }

  return { width, height, pixels };
}

/**
 * Builds a bitmap whose pixels hold the exact RGBA8 values supplied.
 *
 * @param values - Row-major RGBA8 channels, four per pixel.
 * @returns A bitmap with one row, as wide as the supplied pixel count.
 */
function createBitmapFromChannels(values: readonly number[]): ExportResult {
  return {
    width: values.length / RGBA_CHANNEL_COUNT,
    height: 1,
    pixels: Uint8ClampedArray.from(values),
  };
}

/**
 * Reads one four-character chunk type out of a PNG file.
 *
 * @param bytes - Complete PNG file.
 * @param typeOffset - Offset of the chunk's type field.
 * @returns The chunk type as ASCII.
 */
function readChunkType(bytes: Uint8Array, typeOffset: number): string {
  return String.fromCharCode(
    bytes[typeOffset] ?? 0,
    bytes[typeOffset + 1] ?? 0,
    bytes[typeOffset + 2] ?? 0,
    bytes[typeOffset + 3] ?? 0,
  );
}

/**
 * Computes CRC-32 with an independent bitwise loop.
 *
 * This deliberately shares no code with the encoder, so a broken lookup table
 * or byte order in the encoder cannot hide behind an equivalent test helper.
 *
 * @param bytes - Bytes covered by the checksum.
 * @returns The unsigned CRC-32 value.
 */
function computeCrc32(bytes: Uint8Array): number {
  let crc = CRC32_INITIAL;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? CRC32_POLYNOMIAL ^ (crc >>> 1) : crc >>> 1;
    }
  }

  return (crc ^ CRC32_FINAL_XOR) >>> 0;
}

/**
 * Walks every chunk in a PNG file.
 *
 * @param bytes - Complete PNG file.
 * @returns One entry per chunk, with its type, payload, and stored CRC.
 */
function readChunks(bytes: Uint8Array): {
  type: string;
  data: Uint8Array;
  storedCrc: number;
  coveredBytes: Uint8Array;
}[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: {
    type: string;
    data: Uint8Array;
    storedCrc: number;
    coveredBytes: Uint8Array;
  }[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + CHUNK_HEADER_BYTES <= bytes.length) {
    const length = view.getUint32(offset);
    const dataStart = offset + CHUNK_HEADER_BYTES;
    const dataEnd = dataStart + length;

    chunks.push({
      type: readChunkType(bytes, offset + UINT32_BYTES),
      data: bytes.subarray(dataStart, dataEnd),
      storedCrc: view.getUint32(dataEnd),
      coveredBytes: bytes.subarray(offset + UINT32_BYTES, dataEnd),
    });

    offset = dataEnd + CHUNK_CRC_BYTES;
  }

  return chunks;
}

/**
 * Decodes a PNG produced by the encoder back into RGBA8 pixels.
 *
 * Only the `None` scanline filter is supported, because the encoder never emits
 * another one; a different filter fails loudly instead of decoding incorrectly.
 *
 * @param bytes - Complete PNG file.
 * @returns The image geometry and its unfiltered RGBA8 pixels.
 */
function decodePng(bytes: Uint8Array): {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
} {
  const chunks = readChunks(bytes);
  const header = chunks.find((chunk) => chunk.type === "IHDR");
  const headerData = header?.data.subarray(0, IHDR_DATA_BYTES);

  if (headerData === undefined || headerData.length !== IHDR_DATA_BYTES) {
    throw new Error("Encoded PNG is missing a complete IHDR chunk.");
  }

  const headerView = new DataView(
    headerData.buffer,
    headerData.byteOffset,
    headerData.byteLength,
  );
  const width = headerView.getUint32(0);
  const height = headerView.getUint32(UINT32_BYTES);
  const imageData = chunks
    .filter((chunk) => chunk.type === "IDAT")
    .map((chunk) => chunk.data);
  const raw = unzlibSync(concatBytes(imageData));
  const rowBytes = width * RGBA_CHANNEL_COUNT;
  const pixels = new Uint8ClampedArray(rowBytes * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    const filter = raw[rowStart] ?? -1;

    if (filter !== FILTER_NONE) {
      throw new Error(`Unsupported PNG filter type ${filter}.`);
    }

    pixels.set(
      raw.subarray(rowStart + 1, rowStart + 1 + rowBytes),
      y * rowBytes,
    );
  }

  return { width, height, pixels };
}

/**
 * Joins byte segments into one buffer.
 *
 * @param segments - Segments to join in order.
 * @returns A new buffer holding every segment.
 */
function concatBytes(segments: readonly Uint8Array[]): Uint8Array {
  const merged = new Uint8Array(
    segments.reduce((total, segment) => total + segment.length, 0),
  );
  let offset = 0;

  for (const segment of segments) {
    merged.set(segment, offset);
    offset += segment.length;
  }

  return merged;
}

describe("PNGEncoder", () => {
  it("reports the PNG media type and extension", async () => {
    const encoded = await new PNGEncoder().encode(createBitmap(4, 4));

    expect(encoded.mimeType).toBe("image/png");
    expect(encoded.extension).toBe("png");
    expect(encoded.data).toBeInstanceOf(Uint8Array);
    expect(encoded.data.length).toBeGreaterThan(0);
  });

  it("starts with the standard PNG signature", async () => {
    const encoded = await new PNGEncoder().encode(createBitmap(4, 4));

    expect(Array.from(encoded.data.subarray(0, PNG_SIGNATURE.length))).toEqual(
      PNG_SIGNATURE,
    );
  });

  it("writes a correct CRC for every chunk", async () => {
    const encoded = await new PNGEncoder().encode(createBitmap(8, 8));
    const chunks = readChunks(encoded.data);

    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);

    for (const chunk of chunks) {
      expect({ type: chunk.type, crc: chunk.storedCrc }).toEqual({
        type: chunk.type,
        crc: computeCrc32(chunk.coveredBytes),
      });
    }
  });

  it("ends with the standard IEND chunk", async () => {
    const encoded = await new PNGEncoder().encode(createBitmap(8, 8));
    const chunks = readChunks(encoded.data);
    const trailer = chunks.at(-1);

    expect(trailer?.type).toBe("IEND");
    expect(trailer?.data.length).toBe(0);
    expect(trailer?.storedCrc).toBe(IEND_CHUNK_CRC);
  });

  it("round-trips opaque and semi-transparent pixels exactly", async () => {
    const image = createBitmap(7, 5);
    const encoded = await new PNGEncoder().encode(image);
    const decoded = decodePng(encoded.data);

    expect(decoded.width).toBe(7);
    expect(decoded.height).toBe(5);
    expect(decoded.pixels).toEqual(image.pixels);
  });

  it("preserves transparent pixels without normalizing their color", async () => {
    const image = createBitmapFromChannels([100, 150, 200, 0]);
    const encoded = await new PNGEncoder().encode(image);
    const decoded = decodePng(encoded.data);

    expect(Array.from(decoded.pixels)).toEqual([100, 150, 200, 0]);
  });

  it("preserves partial alpha exactly", async () => {
    const image = createBitmapFromChannels([10, 20, 30, 128]);
    const encoded = await new PNGEncoder().encode(image);
    const decoded = decodePng(encoded.data);

    expect(Array.from(decoded.pixels)).toEqual([10, 20, 30, 128]);
  });

  it("does not mutate the source bitmap", async () => {
    const image = createBitmap(6, 6);
    const before = Array.from(image.pixels);

    await new PNGEncoder().encode(image);

    expect(Array.from(image.pixels)).toEqual(before);
  });

  it("produces the same bytes for the same input", async () => {
    const image = createBitmap(9, 3);
    const first = await new PNGEncoder().encode(image);
    const second = await new PNGEncoder().encode(image);

    expect(Array.from(second.data)).toEqual(Array.from(first.data));
  });

  it("stays lossless at every compression level", async () => {
    const image = createBitmap(16, 16);
    const stored = await new PNGEncoder().encode(image, {
      compressionLevel: 0,
    });
    const maximum = await new PNGEncoder().encode(image, {
      compressionLevel: 9,
    });

    expect(decodePng(stored.data).pixels).toEqual(image.pixels);
    expect(decodePng(maximum.data).pixels).toEqual(image.pixels);
    expect(stored.data.length).toBeGreaterThan(maximum.data.length);
  });

  it("encodes unrelated bitmaps concurrently", async () => {
    const first = createBitmap(8, 8);
    const second = createBitmap(3, 11);
    const encoder = new PNGEncoder();
    const [firstResult, secondResult] = await Promise.all([
      encoder.encode(first),
      encoder.encode(second),
    ]);

    expect(decodePng(firstResult.data).pixels).toEqual(first.pixels);
    expect(decodePng(secondResult.data).pixels).toEqual(second.pixels);
  });

  const invalidCompressionLevels: { label: string; value: unknown }[] = [
    { label: "a negative level", value: -1 },
    { label: "a level above nine", value: 10 },
    { label: "a fractional level", value: 1.5 },
    { label: "NaN", value: Number.NaN },
    { label: "Infinity", value: Number.POSITIVE_INFINITY },
    { label: "a string", value: "6" },
  ];

  it.each(invalidCompressionLevels)(
    "rejects $label as a compression level",
    async ({ value }) => {
      // The public option is limited to `0..9`; invalid values are supplied on
      // purpose so the runtime validator is the thing under test.
      const options = { compressionLevel: value } as PNGEncodeOptions;

      await expect(
        new PNGEncoder().encode(createBitmap(2, 2), options),
      ).rejects.toMatchObject({
        code: ExporterErrorDefinitions.INVALID_ENCODER_COMPRESSION_LEVEL.code,
      });
    },
  );

  it("reports a type error for a non-numeric compression level", async () => {
    const encoder = new PNGEncoder();

    await expect(
      encoder.encode(createBitmap(2, 2), {
        compressionLevel: "6",
      } as unknown as PNGEncodeOptions),
    ).rejects.toBeInstanceOf(ExporterTypeError);
  });

  it("reports a range error for an out-of-range compression level", async () => {
    const encoder = new PNGEncoder();

    await expect(
      encoder.encode(createBitmap(2, 2), {
        compressionLevel: 10,
      } as unknown as PNGEncodeOptions),
    ).rejects.toBeInstanceOf(ExporterRangeError);
  });
});
