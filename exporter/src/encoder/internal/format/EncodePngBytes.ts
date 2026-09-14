import { zlibSync } from "fflate";

import type { PNGCompressionLevel } from "../../../interfaces/encoder/PNGCompressionLevel.js";
import type { ExportResult } from "../../../interfaces/renderer/ExportResult.js";

/** Bytes occupied by one straight-alpha RGBA8 pixel. */
const RGBA_CHANNEL_COUNT = 4;

/** Bytes in a 32-bit big-endian PNG length or CRC field. */
const UINT32_BYTES = 4;

/** Bytes of chunk payload reserved for the image header. */
const IHDR_DATA_BYTES = 13;

/** Number of entries in the CRC-32 lookup table. */
const CRC32_TABLE_LENGTH = 256;

/** Reflected CRC-32 polynomial used by PNG chunks. */
const CRC32_POLYNOMIAL = 0xedb88320;

/** Initial CRC-32 accumulator value. */
const CRC32_INITIAL = 0xffffffff;

/** Final CRC-32 XOR mask. */
const CRC32_FINAL_XOR = 0xffffffff;

/** Mask that isolates one byte. */
const BYTE_MASK = 0xff;

/** PNG magic number that opens every file. */
const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Bit depth of an 8-bit-per-channel export. */
const PNG_BIT_DEPTH = 8;

/** PNG color type of a truecolor image with alpha. */
const PNG_COLOR_TYPE_RGBA = 6;

/** PNG compression method identifier for deflate. */
const PNG_COMPRESSION_METHOD_DEFLATE = 0;

/** PNG filter method identifier for adaptive filtering. */
const PNG_FILTER_METHOD_ADAPTIVE = 0;

/** PNG interlace method identifier for a single pass. */
const PNG_INTERLACE_NONE = 0;

/** PNG scanline filter that passes bytes through unchanged. */
const PNG_FILTER_NONE = 0;

const IHDR = "IHDR";
const IDAT = "IDAT";
const IEND = "IEND";

const CRC32_TABLE: Uint32Array = createCrc32Table();

/**
 * Serializes a dense RGBA8 bitmap as a complete lossless PNG file.
 *
 * The result carries the original color and alpha channels unchanged, including
 * fully transparent pixels that still hold non-zero color values. Scanlines use
 * the `None` filter, which keeps the serializer a single pass over the source
 * while leaving deflate to remove the redundancy.
 *
 * @param image - Validated RGBA8 bitmap to encode.
 * @param compressionLevel - Deflate effort from `0` to `9`.
 * @returns A fresh PNG file as bytes.
 *
 * @example
 * const bytes = encodePngBytes(image, 6);
 * bytes[1]; // => 0x50, the "P" of the PNG signature
 */
export function encodePngBytes(
  image: ExportResult,
  compressionLevel: PNGCompressionLevel,
): Uint8Array {
  const header = createHeaderChunk(image.width, image.height);
  const deflated = zlibSync(createFilteredScanlines(image), {
    level: compressionLevel,
  });
  const imageData = createChunk(IDAT, deflated);
  const trailer = createChunk(IEND, new Uint8Array(0));

  return concatBytes([PNG_SIGNATURE, header, imageData, trailer]);
}

/**
 * Builds the `IHDR` chunk that describes the bitmap geometry.
 *
 * @param width - Validated horizontal extent in pixels.
 * @param height - Validated vertical extent in pixels.
 * @returns The complete `IHDR` chunk, including its CRC.
 */
function createHeaderChunk(width: number, height: number): Uint8Array {
  const data = new Uint8Array(IHDR_DATA_BYTES);
  const view = new DataView(data.buffer);

  view.setUint32(0, width);
  view.setUint32(UINT32_BYTES, height);
  data[8] = PNG_BIT_DEPTH;
  data[9] = PNG_COLOR_TYPE_RGBA;
  data[10] = PNG_COMPRESSION_METHOD_DEFLATE;
  data[11] = PNG_FILTER_METHOD_ADAPTIVE;
  data[12] = PNG_INTERLACE_NONE;

  return createChunk(IHDR, data);
}

/**
 * Prefixes every scanline with its filter byte.
 *
 * @param image - Validated RGBA8 bitmap.
 * @returns Raw filtered scanlines ready for deflate.
 */
function createFilteredScanlines(image: ExportResult): Uint8Array {
  const { width, height, pixels } = image;
  const rowBytes = width * RGBA_CHANNEL_COUNT;
  const filteredRowBytes = rowBytes + 1;
  const filtered = new Uint8Array(filteredRowBytes * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * filteredRowBytes;

    filtered[rowStart] = PNG_FILTER_NONE;
    filtered.set(
      pixels.subarray(y * rowBytes, (y + 1) * rowBytes),
      rowStart + 1,
    );
  }

  return filtered;
}

/**
 * Wraps chunk payload in a length, a type, and a CRC.
 *
 * @param type - Four-character ASCII chunk type.
 * @param data - Chunk payload.
 * @returns The complete chunk as bytes.
 */
function createChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.length + UINT32_BYTES * 3);
  const view = new DataView(chunk.buffer);

  view.setUint32(0, data.length);

  for (let index = 0; index < type.length; index += 1) {
    chunk[UINT32_BYTES + index] = type.charCodeAt(index);
  }

  chunk.set(data, UINT32_BYTES * 2);
  view.setUint32(chunk.length - UINT32_BYTES, computeChunkCrc(type, data));

  return chunk;
}

/**
 * Computes the CRC-32 that PNG requires over a chunk's type and payload.
 *
 * @param type - Four-character ASCII chunk type.
 * @param data - Chunk payload.
 * @returns The unsigned CRC-32 value.
 */
function computeChunkCrc(type: string, data: Uint8Array): number {
  let crc = CRC32_INITIAL;

  for (const character of type) {
    crc = updateCrc32(crc, character.charCodeAt(0));
  }

  for (const byte of data) {
    crc = updateCrc32(crc, byte);
  }

  return (crc ^ CRC32_FINAL_XOR) >>> 0;
}

/**
 * Advances the CRC-32 accumulator by one byte.
 *
 * @param crc - Current accumulator.
 * @param byte - Next byte to fold in.
 * @returns The updated accumulator.
 */
function updateCrc32(crc: number, byte: number): number {
  return (crc >>> 8) ^ readCrc32Table((crc ^ byte) & BYTE_MASK);
}

/**
 * Reads one CRC-32 lookup entry.
 *
 * `noUncheckedIndexedAccess` widens typed-array reads to `number | undefined`
 * even though the table always holds every byte value, so the fallback only
 * satisfies the type checker and is never observable.
 *
 * @param index - Byte value to look up.
 * @returns The table entry for the byte.
 */
function readCrc32Table(index: number): number {
  return CRC32_TABLE[index] ?? 0;
}

/**
 * Builds the reflected CRC-32 lookup table used by PNG chunks.
 *
 * @returns A table with one entry per byte value.
 */
function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(CRC32_TABLE_LENGTH);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value =
        (value & 1) === 1 ? CRC32_POLYNOMIAL ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

/**
 * Concatenates byte segments into one fresh buffer.
 *
 * @param segments - Segments to join in order.
 * @returns A new buffer holding every segment.
 */
function concatBytes(segments: readonly Uint8Array[]): Uint8Array {
  const totalBytes = segments.reduce(
    (total, segment) => total + segment.length,
    0,
  );
  const merged = new Uint8Array(totalBytes);
  let offset = 0;

  for (const segment of segments) {
    merged.set(segment, offset);
    offset += segment.length;
  }

  return merged;
}
