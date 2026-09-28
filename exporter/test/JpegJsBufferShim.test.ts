import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ExporterError,
  ExporterErrorDefinitions,
  JPEGEncoder,
  PNGEncoder,
  WebPEncoder,
} from "../index.js";
import type { BufferShim, ExportResult } from "../index.js";

const RGBA_CHANNEL_COUNT = 4;

/** First byte of every JPEG file: the start-of-image marker. */
const START_OF_IMAGE_MARKER = 0xff;

/** Second byte of every JPEG file: the start-of-image code. */
const START_OF_IMAGE_CODE = 0xd8;

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Reads the global `Buffer` without declaring it in this type program.
 *
 * Neither `@reveriejs/exporter` nor this test declares a global `Buffer`, so the
 * property is reached through a structural view of `globalThis`.
 *
 * @returns The installed shim, or `undefined` when the global is absent.
 */
function readGlobalBuffer(): BufferShim | undefined {
  return (globalThis as { Buffer?: BufferShim }).Buffer;
}

/**
 * Removes the global `Buffer` for the remainder of the current test.
 *
 * This reproduces a browser runtime, where the global does not exist, so the
 * shim path is exercised instead of the Node.js one.
 */
function stubMissingBuffer(): void {
  vi.stubGlobal("Buffer", undefined);
}

/**
 * Builds the smallest bitmap the JPEG encoder accepts.
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

describe("JPEGEncoder.installJpegJsBufferShim", () => {
  it("installs a global Buffer when the runtime provides none", () => {
    stubMissingBuffer();

    JPEGEncoder.installJpegJsBufferShim();

    const installed = readGlobalBuffer();

    expect(installed).toBeDefined();
    expect(Array.from(installed?.from([1, 2, 3]) ?? [])).toEqual([1, 2, 3]);
  });

  it("never replaces an existing global Buffer", () => {
    const sentinel: BufferShim = { from: (bytes) => Uint8Array.from(bytes) };

    vi.stubGlobal("Buffer", sentinel);

    JPEGEncoder.installJpegJsBufferShim();

    expect(readGlobalBuffer()).toBe(sentinel);
  });

  it("keeps the same shim across repeated installs", () => {
    stubMissingBuffer();

    JPEGEncoder.installJpegJsBufferShim();
    const first = readGlobalBuffer();

    JPEGEncoder.installJpegJsBufferShim();

    expect(readGlobalBuffer()).toBe(first);
  });
});

describe("JPEGEncoder without a global Buffer", () => {
  it("reports a coded error naming the shim method", async () => {
    stubMissingBuffer();

    const failure = new JPEGEncoder().encode(createBitmap());

    await expect(failure).rejects.toBeInstanceOf(ExporterError);
    await expect(failure).rejects.toMatchObject({
      name: "ExporterError",
      code: ExporterErrorDefinitions.MISSING_JPEG_BACKEND_BUFFER.code,
      message: expect.stringContaining("JPEGEncoder.installJpegJsBufferShim()"),
    });
  });

  it("lets a rejected option win over the missing global", async () => {
    stubMissingBuffer();

    await expect(
      new JPEGEncoder().encode(createBitmap(), { quality: 2 }),
    ).rejects.toMatchObject({
      code: ExporterErrorDefinitions.INVALID_ENCODER_QUALITY.code,
    });
  });

  it("encodes once the shim is installed", async () => {
    stubMissingBuffer();

    JPEGEncoder.installJpegJsBufferShim();

    const encoded = await new JPEGEncoder().encode(createBitmap());

    expect(encoded.extension).toBe("jpg");
    expect(encoded.data[0]).toBe(START_OF_IMAGE_MARKER);
    expect(encoded.data[1]).toBe(START_OF_IMAGE_CODE);
  });
});

describe("encoders that do not need a global Buffer", () => {
  const independentEncoders = [
    { format: "PNG", encode: () => new PNGEncoder().encode(createBitmap()) },
    { format: "WebP", encode: () => new WebPEncoder().encode(createBitmap()) },
  ];

  it.each(independentEncoders)(
    "encodes $format while the global is absent",
    async ({ encode }) => {
      stubMissingBuffer();

      const encoded = await encode();

      expect(encoded.data.length).toBeGreaterThan(0);
    },
  );
});
