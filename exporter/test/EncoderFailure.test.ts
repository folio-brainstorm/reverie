import { describe, expect, it, vi } from "vitest";

/** Shared failure thrown by every mocked codec backend. */
const backendFailure = vi.hoisted(() => new Error("Simulated codec failure."));

vi.mock("fflate", () => ({
  zlibSync: () => {
    throw backendFailure;
  },
  unzlibSync: () => {
    throw backendFailure;
  },
}));

vi.mock("jpeg-js", () => ({
  encode: () => {
    throw backendFailure;
  },
  decode: () => {
    throw backendFailure;
  },
}));

vi.mock("@stacksjs/ts-webp", () => ({
  encode: () => {
    throw backendFailure;
  },
  decode: () => {
    throw backendFailure;
  },
}));

import {
  ExporterError,
  ExporterErrorDefinitions,
  JPEGEncoder,
  PNGEncoder,
  WebPEncoder,
} from "../index.js";
import type { ExportResult } from "../index.js";

const RGBA_CHANNEL_COUNT = 4;

/**
 * Builds the smallest bitmap every encoder accepts.
 *
 * @returns A fully opaque 2x2 bitmap.
 */
function createBitmap(): ExportResult {
  const pixels = new Uint8ClampedArray(2 * 2 * RGBA_CHANNEL_COUNT);

  for (let offset = 0; offset < pixels.length; offset += RGBA_CHANNEL_COUNT) {
    pixels[offset + 3] = 255;
  }

  return { width: 2, height: 2, pixels };
}

/** Every encoder whose codec backend is mocked to fail. */
const failingEncoders = [
  { format: "PNG", encode: () => new PNGEncoder().encode(createBitmap()) },
  { format: "JPEG", encode: () => new JPEGEncoder().encode(createBitmap()) },
  { format: "WebP", encode: () => new WebPEncoder().encode(createBitmap()) },
];

describe("encoder backend failures", () => {
  it.each(failingEncoders)(
    "reports a coded $format failure instead of the raw backend error",
    async ({ format, encode }) => {
      await expect(encode()).rejects.toMatchObject({
        name: "ExporterError",
        code: ExporterErrorDefinitions.ENCODING_FAILED.code,
        message: expect.stringContaining(`Failed to encode ${format} image.`),
      });
    },
  );

  it.each(failingEncoders)(
    "preserves the $format backend failure as the cause",
    async ({ encode }) => {
      await expect(encode()).rejects.toMatchObject({
        cause: backendFailure,
      });
      await expect(encode()).rejects.toBeInstanceOf(ExporterError);
    },
  );
});
