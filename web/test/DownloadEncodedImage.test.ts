import { afterEach, describe, expect, it, vi } from "vitest";

import type { EncodedImage } from "@reveriejs/exporter";

import {
  WebErrorDefinitions,
  WebRangeError,
  WebTypeError,
  downloadEncodedImage,
} from "../index.js";

import {
  DownloadTestRuntime,
  flushScheduledTimers,
} from "./DownloadTestRuntime.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Formats whose encoded metadata drives the download filename and media type. */
const DOWNLOAD_FORMATS: readonly {
  extension: string;
  mimeType: string;
  expectedFilename: string;
}[] = [
  { extension: "png", mimeType: "image/png", expectedFilename: "drawing.png" },
  { extension: "jpg", mimeType: "image/jpeg", expectedFilename: "drawing.jpg" },
  {
    extension: "webp",
    mimeType: "image/webp",
    expectedFilename: "drawing.webp",
  },
];

/** Values a JavaScript caller could supply in place of an encoded image. */
const INVALID_IMAGES: readonly { label: string; image: unknown }[] = [
  { label: "null", image: null },
  { label: "a number", image: 42 },
  { label: "an array", image: [] },
  {
    label: "an object without data",
    image: { mimeType: "image/png", extension: "png" },
  },
  {
    label: "an object without a media type",
    image: { data: new Uint8Array([1]), extension: "png" },
  },
  {
    label: "an object without an extension",
    image: { data: new Uint8Array([1]), mimeType: "image/png" },
  },
];

/** Values a JavaScript caller could supply in place of a filename. */
const INVALID_FILENAMES: readonly { label: string; filename: unknown }[] = [
  { label: "an empty string", filename: "" },
  { label: "a number", filename: 42 },
  { label: "a boolean", filename: false },
];

describe("downloadEncodedImage", () => {
  it.each(DOWNLOAD_FORMATS)(
    "downloads a $mimeType image as $expectedFilename",
    async ({ extension, mimeType, expectedFilename }) => {
      const runtime = new DownloadTestRuntime();
      runtime.install();
      const image = createEncodedImage(extension, mimeType);

      downloadEncodedImage(image);
      await flushScheduledTimers();

      expect(runtime.blobs).toHaveLength(1);
      expect(runtime.blobs[0]?.type).toBe(mimeType);
      expect(await readBlobBytes(runtime.blobs[0])).toEqual(image.data);

      expect(runtime.anchors).toHaveLength(1);
      expect(runtime.appendedAnchors).toEqual(runtime.anchors);
      expect(runtime.anchors[0]?.download).toBe(expectedFilename);
      expect(runtime.anchors[0]?.href).toBe(runtime.createdObjectUrls[0]);
      expect(runtime.anchors[0]?.rel).toBe("noopener");
      expect(runtime.anchors[0]?.hasClicked).toBe(true);
      expect(runtime.anchors[0]?.isRemoved).toBe(true);

      expect(runtime.revokedObjectUrls).toEqual(runtime.createdObjectUrls);
    },
  );

  it("uses a supplied filename that already carries an extension verbatim", async () => {
    const runtime = new DownloadTestRuntime();
    runtime.install();

    downloadEncodedImage(createEncodedImage("png", "image/png"), {
      filename: "concept-art.png",
    });
    await flushScheduledTimers();

    expect(runtime.anchors[0]?.download).toBe("concept-art.png");
  });

  it("appends the encoded extension when the filename has none", async () => {
    const runtime = new DownloadTestRuntime();
    runtime.install();

    downloadEncodedImage(createEncodedImage("png", "image/png"), {
      filename: "concept-art",
    });
    await flushScheduledTimers();

    expect(runtime.anchors[0]?.download).toBe("concept-art.png");
  });

  it("preserves a filename extension that disagrees with the encoded bytes", async () => {
    const runtime = new DownloadTestRuntime();
    runtime.install();

    downloadEncodedImage(createEncodedImage("png", "image/png"), {
      filename: "image.jpg",
    });
    await flushScheduledTimers();

    expect(runtime.anchors[0]?.download).toBe("image.jpg");
  });

  it("revokes the object URL even when the browser blocks the download", async () => {
    const runtime = new DownloadTestRuntime();
    runtime.install();
    runtime.failNextClick();

    expect(() => {
      downloadEncodedImage(createEncodedImage("png", "image/png"));
    }).toThrow("Download was blocked.");
    await flushScheduledTimers();

    expect(runtime.anchors[0]?.isRemoved).toBe(true);
    expect(runtime.revokedObjectUrls).toEqual(runtime.createdObjectUrls);
  });

  it.each(INVALID_IMAGES)(
    "rejects $label without creating a download",
    ({ image }) => {
      const runtime = new DownloadTestRuntime();
      runtime.install();

      expect(() => downloadUntrustedImage(image)).toThrow(WebTypeError);
      expect(() => downloadUntrustedImage(image)).toThrow(
        `[${WebErrorDefinitions.INVALID_ENCODED_IMAGE.code}]`,
      );

      expect(runtime.blobs).toHaveLength(0);
      expect(runtime.createdObjectUrls).toHaveLength(0);
    },
  );

  it("rejects a data buffer that is not a Uint8Array", () => {
    const runtime = new DownloadTestRuntime();
    runtime.install();

    expect(() =>
      downloadUntrustedImage({
        data: [1, 2, 3],
        mimeType: "image/png",
        extension: "png",
      }),
    ).toThrow(`[${WebErrorDefinitions.INVALID_ENCODED_IMAGE_DATA.code}]`);

    expect(runtime.createdObjectUrls).toHaveLength(0);
  });

  it("rejects empty encoded bytes", () => {
    const runtime = new DownloadTestRuntime();
    runtime.install();

    expect(() =>
      downloadEncodedImage(
        createEncodedImage("png", "image/png", new Uint8Array(0)),
      ),
    ).toThrow(WebRangeError);
    expect(() =>
      downloadEncodedImage(
        createEncodedImage("png", "image/png", new Uint8Array(0)),
      ),
    ).toThrow(`[${WebErrorDefinitions.EMPTY_ENCODED_IMAGE_DATA.code}]`);

    expect(runtime.createdObjectUrls).toHaveLength(0);
  });

  it.each([
    {
      label: "an empty media type",
      image: { data: new Uint8Array([1]), mimeType: "", extension: "png" },
    },
    {
      label: "an empty extension",
      image: {
        data: new Uint8Array([1]),
        mimeType: "image/png",
        extension: "",
      },
    },
  ])("rejects $label", ({ image }) => {
    const runtime = new DownloadTestRuntime();
    runtime.install();

    expect(() => downloadUntrustedImage(image)).toThrow(WebTypeError);
    expect(() => downloadUntrustedImage(image)).toThrow(
      `[${WebErrorDefinitions.INVALID_ENCODED_IMAGE_FIELD.code}]`,
    );

    expect(runtime.createdObjectUrls).toHaveLength(0);
  });

  it.each(INVALID_FILENAMES)("rejects $label as a filename", ({ filename }) => {
    const runtime = new DownloadTestRuntime();
    runtime.install();

    expect(() =>
      downloadEncodedImage(createEncodedImage("png", "image/png"), {
        filename: filename as string,
      }),
    ).toThrow(WebTypeError);
    expect(() =>
      downloadEncodedImage(createEncodedImage("png", "image/png"), {
        filename: filename as string,
      }),
    ).toThrow(`[${WebErrorDefinitions.INVALID_DOWNLOAD_FILENAME.code}]`);

    expect(runtime.blobs).toHaveLength(0);
    expect(runtime.createdObjectUrls).toHaveLength(0);
  });
});

/** Builds an encoded image whose metadata matches the requested format. */
function createEncodedImage(
  extension: string,
  mimeType: string,
  data: Uint8Array = new Uint8Array([1, 2, 3, 4]),
): EncodedImage {
  return { data, mimeType, extension };
}

/**
 * Invokes the helper with an untrusted value.
 *
 * The assertion mirrors a JavaScript caller that bypasses the published types,
 * which is exactly the input the guard must reject.
 */
function downloadUntrustedImage(image: unknown): void {
  downloadEncodedImage(image as EncodedImage);
}

/** Reads a captured Blob's bytes, failing when no Blob was captured. */
async function readBlobBytes(blob: Blob | undefined): Promise<Uint8Array> {
  if (blob === undefined) {
    throw new Error("No Blob was captured.");
  }

  return new Uint8Array(await blob.arrayBuffer());
}
